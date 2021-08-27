import { Action, Entity } from '../../types/Authorization';

import AsyncTaskManager from '../../async-task/AsyncTaskManager';
import CentralRestServer from '../../server/rest/CentralRestServer';
import { ChangeStreamOptions } from 'mongodb';
import Constants from '../../utils/Constants';
import Logging from '../../utils/Logging';
import { ServerAction } from '../../types/Server';
import StorageConfiguration from '../../types/configuration/StorageConfiguration';
import { TransactionNotificationData } from '../../types/SingleChangeNotification';
import Utils from '../../utils/Utils';
import chalk from 'chalk';
import global from '../../types/GlobalType';

const MODULE_NAME = 'MongoDBStorageNotification';

export default class MongoDBStorageNotification {
  private defaultWatchPipeline: Record<string, unknown>[] = [];
  private defaultWatchOptions: ChangeStreamOptions = {
    fullDocument: 'default'
  };

  private dbConfig: StorageConfiguration;
  private centralRestServer: CentralRestServer;

  constructor(dbConfig: StorageConfiguration, centralRestServer: CentralRestServer) {
    this.dbConfig = dbConfig;
    this.centralRestServer = centralRestServer;
  }

  static getActionFromOperation(operation: string): Action {
    if (operation) {
      switch (operation) {
        case 'insert':
          return Action.CREATE;
        case 'update':
          return Action.UPDATE;
        case 'replace':
          return Action.REPLACE;
        case 'delete':
          return Action.DELETE;
      }
    }
    return null;
  }

  static handleDBInvalidChange(tenantID: string, collection: string, change: Event): void {
    const message = `Invalid change received from DB on collection '${tenantID}.${collection}'`;
    void Logging.logError({
      tenantID: Constants.DEFAULT_TENANT,
      action: ServerAction.DB_WATCH,
      module: MODULE_NAME, method: 'handleDBInvalidChange',
      message,
      detailedMessages: { change }
    });
    Utils.isDevelopmentEnv() && console.error(chalk.red(message));
  }

  static handleDBChangeStreamError(error: Error): void {
    const message = `Error occurred in watching database: ${error}`;
    void Logging.logError({
      tenantID: Constants.DEFAULT_TENANT,
      action: ServerAction.DB_WATCH,
      module: MODULE_NAME, method: 'handleDBChangeStreamError',
      message,
      detailedMessages: { error: error.stack }
    });
    Utils.isDevelopmentEnv() && console.error(chalk.red(message));
  }

  async start(): Promise<void> {
    if (this.dbConfig.monitorDBChange) {
      // Register to listen to DB Changes
      const dbChangeStream = global.database.watch(this.defaultWatchPipeline, this.defaultWatchOptions);
      // Handle DB Changes
      dbChangeStream.on('change', (change: { [key: string]: any }) => {
        // Get Action (create, uodate...)
        const action = MongoDBStorageNotification.getActionFromOperation(change.operationType);
        // Get Tenant ID and Collection Name
        let tenantID, collection, documentID;
        if (change.ns && change.ns.coll) {
          const namespaces = change.ns.coll.split('.');
          if (namespaces && namespaces.length === 2) {
            tenantID = namespaces[0];
            collection = namespaces[1];
          }
        }
        // Get Document Key
        if (change.documentKey && change.documentKey._id) {
          documentID = change.documentKey._id.toString();
        }
        this.handleCollectionChange(tenantID, collection, documentID, action, change);
      });
      // Handle DB Errors
      dbChangeStream.on('error', (error: Error) => {
        MongoDBStorageNotification.handleDBChangeStreamError(error);
      });
      const message = `The monitoring on database '${global.database.getDatabase().databaseName}' is enabled`;
      await Logging.logInfo({
        tenantID: Constants.DEFAULT_TENANT,
        module: MODULE_NAME, method: 'start',
        action: ServerAction.STARTUP,
        message: message
      });
      Utils.isDevelopmentEnv() && console.debug(chalk.green(message));
    } else {
      const message = `The monitoring on database '${this.dbConfig.implementation}' is disabled`;
      await Logging.logWarning({
        tenantID: Constants.DEFAULT_TENANT,
        module: MODULE_NAME, method: 'start',
        action: ServerAction.STARTUP,
        message: message
      });
      Utils.isDevelopmentEnv() && console.warn(chalk.yellow(message));
    }
  }

  private handleCollectionChange(tenantID: string, collection: string, documentID: string, action: Action, changeEvent) {
    switch (collection) {
      case 'tags':
        this.centralRestServer?.notifyTag(tenantID, action, { id: documentID });
        break;
      case 'users':
      case 'userimages':
        this.centralRestServer?.notifyUser(tenantID, action, { id: documentID });
        break;
      case 'chargingstations':
        this.centralRestServer?.notifyChargingStation(tenantID, action, { id: documentID });
        break;
      case 'companies':
      case 'companylogos':
        this.centralRestServer?.notifyCompany(tenantID, action, { id: documentID });
        break;
      case 'assets':
      case 'assetimages':
        this.centralRestServer?.notifyAsset(tenantID, action, { id: documentID });
        break;
      case 'siteareas':
      case 'siteareaimages':
        this.centralRestServer?.notifySiteArea(tenantID, action, { id: documentID });
        break;
      case 'sites':
      case 'siteimages':
        this.centralRestServer?.notifySite(tenantID, action, { id: documentID });
        break;
      case 'tenants':
        this.centralRestServer?.notifyTenant(tenantID, action, { id: documentID });
        break;
      case 'transactions':
        this.handleTransactionChange(tenantID, documentID, action, changeEvent);
        break;
      case 'metervalues':
        this.handleMeterValuesChange(tenantID, documentID, action, changeEvent);
        break;
      case 'configurations':
        this.handleConfigurationChange(tenantID, documentID, action, changeEvent);
        break;
      case 'logs':
        this.centralRestServer?.notifyLogging(tenantID, action);
        break;
      case 'registrationtokens':
        this.centralRestServer?.notifyRegistrationToken(tenantID, action, { id: documentID });
        break;
      case 'invoices':
        this.centralRestServer?.notifyInvoice(tenantID, action, { id: documentID });
        break;
      case 'carcatalogimages':
      case 'carcatalogs':
        this.centralRestServer?.notifyCarCatalog(tenantID, action, { id: documentID });
        break;
      case 'cars':
        this.centralRestServer?.notifyCar(tenantID, action, { id: documentID });
        break;
      case 'chargingprofiles':
        this.centralRestServer?.notifyChargingProfile(tenantID, action, { id: documentID });
        break;
      case 'ocpiendpoints':
        this.centralRestServer?.notifyOcpiEndpoint(tenantID, action, { id: documentID });
        break;
      case 'asynctasks':
        this.centralRestServer?.notifyAsyncTaskEndpoint(tenantID, action, { id: documentID });
        if (action === Action.CREATE) {
          void AsyncTaskManager.handleAsyncTasks();
        }
        break;
    }
  }

  private handleTransactionChange(tenantID: string, transactionID: string, action: Action, changeEvent) {
    if (transactionID) {
      const notification: TransactionNotificationData = {
        'id': transactionID
      };
      // Operation
      switch (action) {
        case Action.CREATE: // Insert/Create
          notification.connectorId = Utils.convertToInt(changeEvent.fullDocument.connectorId);
          notification.chargeBoxID = changeEvent.fullDocument.chargeBoxID as string;
          break;
        case Action.UPDATE: // Update
          if (changeEvent.updateDescription && changeEvent.updateDescription.updatedFields && changeEvent.updateDescription.updatedFields.stop) {
            notification.type = Entity.TRANSACTION_STOP;
          }
          break;
        case Action.REPLACE: // Replace
          if (changeEvent.fullDocument && changeEvent.fullDocument.stop) {
            notification.type = Entity.TRANSACTION_STOP;
          }
          break;
      }
      // Notify
      this.centralRestServer?.notifyTransaction(tenantID, action, notification);
    } else {
      MongoDBStorageNotification.handleDBInvalidChange(tenantID, 'transactions', changeEvent);
    }
  }

  private handleMeterValuesChange(tenantID: string, metervaluesID: string, action: Action, changeEvent) {
    if (metervaluesID) {
      const notification = {} as TransactionNotificationData;
      // Insert/Create?
      if (action === Action.CREATE) {
        notification.id = changeEvent.fullDocument.transactionId;
        notification.type = Entity.TRANSACTION_METER_VALUES;
        notification.chargeBoxID = changeEvent.fullDocument.chargeBoxID as string;
        notification.connectorId = Utils.convertToInt(changeEvent.fullDocument.connectorId);
        // Notify, Force Transaction Update
        this.centralRestServer?.notifyTransaction(tenantID, Action.UPDATE, notification);
      }
    } else {
      MongoDBStorageNotification.handleDBInvalidChange(tenantID, 'meterValues', changeEvent);
    }
  }

  private handleConfigurationChange(tenantID: string, configurationID: string, action: Action, changeEvent) {
    if (configurationID) {
      this.centralRestServer?.notifyChargingStation(tenantID, action, {
        'type': Constants.CHARGING_STATION_CONFIGURATION,
        'id': configurationID
      });
    } else {
      MongoDBStorageNotification.handleDBInvalidChange(tenantID, 'configurations', changeEvent);
    }
  }
}
