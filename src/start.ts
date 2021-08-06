import CentralSystemConfiguration, { CentralSystemImplementation } from './types/configuration/CentralSystemConfiguration';

import AsyncTaskManager from './async-task/AsyncTaskManager';
import CentralRestServer from './server/rest/CentralRestServer';
import CentralSystemRestServiceConfiguration from './types/configuration/CentralSystemRestServiceConfiguration';
import ChargingStationConfiguration from './types/configuration/ChargingStationConfiguration';
import ChargingStationStorage from './storage/mongodb/ChargingStationStorage';
import Configuration from './utils/Configuration';
import Constants from './utils/Constants';
import I18nManager from './utils/I18nManager';
import JsonCentralSystemServer from './server/ocpp/json/JsonCentralSystemServer';
import LockingManager from './locking/LockingManager';
import Logging from './utils/Logging';
import MigrationConfiguration from './types/configuration/MigrationConfiguration';
import MigrationHandler from './migration/MigrationHandler';
import MongoDBStorage from './storage/mongodb/MongoDBStorage';
import MongoDBStorageNotification from './storage/mongodb/MongoDBStorageNotification';
import OCPIServer from './server/ocpi/OCPIServer';
import OCPIServiceConfiguration from './types/configuration/OCPIServiceConfiguration';
import ODataServer from './server/odata/ODataServer';
import ODataServiceConfiguration from './types/configuration/ODataServiceConfiguration';
import OICPServer from './server/oicp/OICPServer';
import OICPServiceConfiguration from './types/configuration/OICPServiceConfiguration';
import SchedulerManager from './scheduler/SchedulerManager';
import { ServerAction } from './types/Server';
import SoapCentralSystemServer from './server/ocpp/soap/SoapCentralSystemServer';
import StorageConfiguration from './types/configuration/StorageConfiguration';
import Utils from './utils/Utils';
import chalk from 'chalk';
import cluster from 'cluster';
import global from './types/GlobalType';

const MODULE_NAME = 'Bootstrap';

export default class Bootstrap {
  private static numWorkers: number;
  private static isClusterEnabled: boolean;
  private static centralSystemRestConfig: CentralSystemRestServiceConfiguration;
  private static centralRestServer: CentralRestServer;
  private static chargingStationConfig: ChargingStationConfiguration;
  // FIXME: Add a database agnostic storage notification type definition
  private static storageNotification: MongoDBStorageNotification;
  private static storageConfig: StorageConfiguration;
  private static centralSystemsConfig: CentralSystemConfiguration[];
  private static SoapCentralSystemServer: SoapCentralSystemServer;
  private static JsonCentralSystemServer: JsonCentralSystemServer;
  private static ocpiConfig: OCPIServiceConfiguration;
  private static ocpiServer: OCPIServer;
  private static oicpConfig: OICPServiceConfiguration;
  private static oicpServer: OICPServer;
  private static oDataServerConfig: ODataServiceConfiguration;
  private static oDataServer: ODataServer;
  private static databaseDone: boolean;
  private static database: MongoDBStorage;
  private static migrationConfig: MigrationConfiguration;
  private static migrationDone: boolean;

  public static async start(): Promise<void> {
    try {
      // Setup i18n
      await I18nManager.initialize();
      // Master?
      if (cluster.isMaster) {
        const nodejsEnv = process.env.NODE_ENV || 'development';
        // eslint-disable-next-line no-console
        console.log(`NodeJS is started in '${nodejsEnv}' mode`);
      }
      // Get all configs
      Bootstrap.storageConfig = Configuration.getStorageConfig();
      Bootstrap.centralSystemRestConfig = Configuration.getCentralSystemRestServiceConfig();
      Bootstrap.centralSystemsConfig = Configuration.getCentralSystemsConfig();
      Bootstrap.chargingStationConfig = Configuration.getChargingStationConfig();
      Bootstrap.ocpiConfig = Configuration.getOCPIServiceConfig();
      Bootstrap.oicpConfig = Configuration.getOICPServiceConfig();
      Bootstrap.oDataServerConfig = Configuration.getODataServiceConfig();
      Bootstrap.isClusterEnabled = Configuration.getClusterConfig().enabled;
      Bootstrap.migrationConfig = Configuration.getMigrationConfig();
      // Start the connection to the Database
      if (!Bootstrap.databaseDone) {
        // Check database implementation
        switch (Bootstrap.storageConfig.implementation) {
          // MongoDB?
          case 'mongodb':
            // Create MongoDB
            Bootstrap.database = new MongoDBStorage(Bootstrap.storageConfig);
            // Keep a global reference
            global.database = Bootstrap.database;
            break;
          default:
            // eslint-disable-next-line no-console
            console.log(`Storage Server implementation '${Bootstrap.storageConfig.implementation}' not supported!`);
        }
        // Connect to the Database
        await Bootstrap.database.start();
        let logMsg: string;
        if (cluster.isMaster) {
          logMsg = `Database connected to '${Bootstrap.storageConfig.implementation}' successfully in master`;
        } else {
          logMsg = `Database connected to '${Bootstrap.storageConfig.implementation}' successfully in worker ${cluster.worker.id}`;
        }
        // Log
        await Logging.logInfo({
          tenant: Constants.DEFAULT_TENANT_OBJECT,
          action: ServerAction.STARTUP,
          module: MODULE_NAME, method: 'start',
          message: logMsg
        });
        Bootstrap.databaseDone = true;
      }
      if (cluster.isMaster && !Bootstrap.migrationDone && Bootstrap.migrationConfig.active) {
        // Check and trigger migration (only master process can run the migration)
        await MigrationHandler.migrate();
        Bootstrap.migrationDone = true;
      }
      // Listen to promise failure
      process.on('unhandledRejection', (reason: any, p): void => {
        // eslint-disable-next-line no-console
        console.log('Unhandled Rejection: ', p, ' reason: ', reason);
        void Logging.logError({
          tenant: Constants.DEFAULT_TENANT_OBJECT,
          action: ServerAction.STARTUP,
          module: MODULE_NAME, method: 'start',
          message: `Reason: ${(reason ? reason.message : 'Not provided')}`,
          detailedMessages: (reason ? reason.stack : null)
        });
      });
      if (cluster.isMaster && Bootstrap.isClusterEnabled) {
        Bootstrap.startMaster();
      } else {
        await Bootstrap.startServersListening();
      }
      if (cluster.isMaster) {
        // -------------------------------------------------------------------------
        // Init the Scheduler
        // -------------------------------------------------------------------------
        await SchedulerManager.init();
        // -------------------------------------------------------------------------
        // Init the Async Task
        // -------------------------------------------------------------------------
        await AsyncTaskManager.init();
        // -------------------------------------------------------------------------
        // Locks remain in storage if server crashes
        // Delete acquired database locks with same hostname
        // -------------------------------------------------------------------------
        await LockingManager.cleanupLocks(Configuration.isCloudFoundry() || Utils.isDevelopmentEnv());
        // -------------------------------------------------------------------------
        // Populate at startup the DB with shared data
        // -------------------------------------------------------------------------
        // 1 - Charging station templates
        await ChargingStationStorage.updateChargingStationTemplatesFromFile();
      }
    } catch (error) {
      // Log
      // eslint-disable-next-line no-console
      console.error(chalk.red(error));
      await Logging.logError({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'start',
        message: 'Unexpected exception',
        detailedMessages: { error: error.stack }
      });
    }
  }

  private static startServerWorkers(serverName: string): void {
    Bootstrap.numWorkers = Configuration.getClusterConfig().numWorkers;
    /**
     * @param worker
     */
    function onlineCb(worker: cluster.Worker): void {
      // Log
      const logMsg = `${serverName} server worker ${worker.id} is online`;
      void Logging.logInfo({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'startServerWorkers',
        message: logMsg
      });
      // eslint-disable-next-line no-console
      console.log(logMsg);
    }
    /**
     * @param worker
     * @param code
     * @param signal
     */
    function exitCb(worker: cluster.Worker, code, signal?): void {
      // Log
      const logMsg = serverName + ' server worker ' + worker.id.toString() + ' died with code: ' + code + ', and signal: ' + signal +
        '.\n Starting new ' + serverName + ' server worker';
      void Logging.logInfo({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'startServerWorkers',
        message: logMsg
      });
      // eslint-disable-next-line no-console
      console.log(logMsg);
      cluster.fork();
    }
    // Log
    // eslint-disable-next-line no-console
    console.log(`Starting ${serverName} server master process: setting up ${Bootstrap.numWorkers} workers...`);
    // Create cluster worker processes
    for (let i = 1; i <= Bootstrap.numWorkers; i++) {
      // Invoke cluster fork method to create a cluster worker
      cluster.fork();
      // Log
      const logMsg = `Starting ${serverName} server worker ${i} of ${Bootstrap.numWorkers}...`;
      void Logging.logInfo({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'startServerWorkers',
        message: logMsg
      });
      // eslint-disable-next-line no-console
      console.log(logMsg);
    }
    cluster.on('online', onlineCb);
    cluster.on('exit', exitCb);
  }

  private static async startMaster(): Promise<void> {
    try {
      if (Bootstrap.isClusterEnabled && Utils.isEmptyObject(cluster.workers)) {
        Bootstrap.startServerWorkers('Main');
      }
    } catch (error) {
      // Log
      // eslint-disable-next-line no-console
      console.error(chalk.red(error));
      await Logging.logError({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'startMasters',
        message: `Unexpected exception ${cluster.isWorker ? 'in worker ' + cluster.worker.id.toString() : 'in master'}: ${error.toString()}`,
        detailedMessages: { error: error.stack }
      });
    }
  }

  private static async startServersListening(): Promise<void> {
    try {
      // -------------------------------------------------------------------------
      // REST Server (Front-End)
      // -------------------------------------------------------------------------
      if (Bootstrap.centralSystemRestConfig) {
        // Create the server
        if (!Bootstrap.centralRestServer) {
          Bootstrap.centralRestServer = new CentralRestServer(Bootstrap.centralSystemRestConfig);
        }
        // Start it
        await Bootstrap.centralRestServer.start();
        if (this.centralSystemRestConfig.socketIO) {
          // Start database Socket IO notifications
          await this.centralRestServer.startSocketIO();
        }
      }
      // -------------------------------------------------------------------------
      // Listen to DB changes
      // -------------------------------------------------------------------------
      // Create database notifications
      if (!Bootstrap.storageNotification) {
        Bootstrap.storageNotification = new MongoDBStorageNotification(Bootstrap.storageConfig, Bootstrap.centralRestServer);
      }
      await Bootstrap.storageNotification.start();
      // -------------------------------------------------------------------------
      // Central Server (Charging Stations)
      // -------------------------------------------------------------------------
      if (Bootstrap.centralSystemsConfig) {
        // Start
        for (const centralSystemConfig of Bootstrap.centralSystemsConfig) {
          // Check implementation
          switch (centralSystemConfig.implementation) {
            // SOAP
            case CentralSystemImplementation.SOAP:
              // Create implementation
              Bootstrap.SoapCentralSystemServer = new SoapCentralSystemServer(centralSystemConfig, Bootstrap.chargingStationConfig);
              // Start
              await Bootstrap.SoapCentralSystemServer.start();
              break;
            case CentralSystemImplementation.JSON:
              // Create implementation
              Bootstrap.JsonCentralSystemServer = new JsonCentralSystemServer(centralSystemConfig, Bootstrap.chargingStationConfig);
              // Start
              // FIXME: Issue with cluster, see https://github.com/sap-labs-france/ev-server/issues/1097
              await Bootstrap.JsonCentralSystemServer.start();
              break;
            // Not Found
            default:
              // eslint-disable-next-line no-console
              console.log(`Central System Server implementation '${centralSystemConfig.implementation}' not found!`);
          }
        }
      }
      // -------------------------------------------------------------------------
      // OCPI Server
      // -------------------------------------------------------------------------
      if (Bootstrap.ocpiConfig) {
        // Create server instance
        Bootstrap.ocpiServer = new OCPIServer(Bootstrap.ocpiConfig);
        // Start server instance
        await Bootstrap.ocpiServer.start();
      }
      // -------------------------------------------------------------------------
      // OICP Server
      // -------------------------------------------------------------------------
      if (Bootstrap.oicpConfig) {
        // Create server instance
        Bootstrap.oicpServer = new OICPServer(Bootstrap.oicpConfig);
        // Start server instance
        await Bootstrap.oicpServer.start();
      }
      // -------------------------------------------------------------------------
      // OData Server
      // -------------------------------------------------------------------------
      if (Bootstrap.oDataServerConfig) {
        // Create server instance
        Bootstrap.oDataServer = new ODataServer(Bootstrap.oDataServerConfig);
        // Start server instance
        await Bootstrap.oDataServer.start();
      }
    } catch (error) {
      // Log
      // eslint-disable-next-line no-console
      console.error(chalk.red(error));
      await Logging.logError({
        tenant: Constants.DEFAULT_TENANT_OBJECT,
        action: ServerAction.STARTUP,
        module: MODULE_NAME, method: 'startServersListening',
        message: `Unexpected exception ${cluster.isWorker ? 'in worker ' + cluster.worker.id.toString() : 'in master'}: ${error.toString()}`,
        detailedMessages: { error: error.stack }
      });
    }
  }
}

// Start
Bootstrap.start().catch(
  (error) => {
    console.error(chalk.red(error));
  }
);
