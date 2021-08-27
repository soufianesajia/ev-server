import AddCompanyIDToChargingStationsTask from './tasks/AddCompanyIDToChargingStationsTask';
import AddCompanyIDToTransactionsTask from './tasks/AddCompanyIDToTransactionsTask';
import AddUserIDToCarsTask from './tasks/AddUserIDToCarsTask';
import Constants from '../utils/Constants';
import { LockEntity } from '../types/Locking';
import LockingManager from '../locking/LockingManager';
import Logging from '../utils/Logging';
import MigrationStorage from '../storage/mongodb/MigrationStorage';
import MigrationTask from './MigrationTask';
import RemoveDuplicateTagVisualIDsTask from './tasks/RemoveDuplicateTagVisualIDsTask';
import RestoreDataIntegrityInSiteUsersTask from './tasks/RestoreDataIntegrityInSiteUsersTask';
import { ServerAction } from '../types/Server';
import chalk from 'chalk';
import cluster from 'cluster';
import moment from 'moment';

const MODULE_NAME = 'MigrationHandler';

export default class MigrationHandler {
  public static async migrate(processAsyncTasksOnly = false): Promise<void> {
    // Check we're on the master nodejs process
    if (!cluster.isMaster) {
      return;
    }
    // Create a Lock for migration
    const migrationLock = LockingManager.createExclusiveLock(Constants.DEFAULT_TENANT, LockEntity.DATABASE, 'migration', 3600);
    if (await LockingManager.acquire(migrationLock)) {
      try {
        const startMigrationTime = moment();
        // Log
        await Logging.logInfo({
          tenantID: Constants.DEFAULT_TENANT,
          action: ServerAction.MIGRATION,
          module: MODULE_NAME, method: 'migrate',
          message: `Running ${processAsyncTasksOnly ? 'asynchronous' : 'synchronous'} migration tasks...`
        });
        // Create tasks
        const migrationTasks = MigrationHandler.createMigrationTasks();
        // Get the already done migrations from the DB
        const migrationTasksCompleted = await MigrationStorage.getMigrations();
        // Check
        for (const migrationTask of migrationTasks) {
          // Check if not already done
          const foundMigrationTaskCompleted = migrationTasksCompleted.find((migrationTaskCompleted) =>
            // Same name and version
            (migrationTask.getName() === migrationTaskCompleted.name &&
             migrationTask.getVersion() === migrationTaskCompleted.version)
          );
          // Already processed?
          if (foundMigrationTaskCompleted) {
            continue;
          }
          // Check
          if (migrationTask.isAsynchronous() && processAsyncTasksOnly) {
            // Execute Async
            await MigrationHandler.executeTask(migrationTask);
          } else if (!migrationTask.isAsynchronous() && !processAsyncTasksOnly) {
            // Execute Sync
            await MigrationHandler.executeTask(migrationTask);
          }
        }
        // Log Total Processing Time
        const totalMigrationTimeSecs = moment.duration(moment().diff(startMigrationTime)).asSeconds();
        await Logging.logInfo({
          tenantID: Constants.DEFAULT_TENANT,
          action: ServerAction.MIGRATION,
          module: MODULE_NAME, method: 'migrate',
          message: `The ${processAsyncTasksOnly ? 'asynchronous' : 'synchronous'} migration has been run in ${totalMigrationTimeSecs} secs`
        });
      } catch (error) {
        await Logging.logError({
          tenantID: Constants.DEFAULT_TENANT,
          action: ServerAction.MIGRATION,
          module: MODULE_NAME, method: 'migrate',
          message: error.message,
          detailedMessages: { error: error.stack }
        });
      } finally {
        // Release lock
        await LockingManager.release(migrationLock);
      }
    }
    // Process async tasks one by one
    if (!processAsyncTasksOnly) {
      setTimeout(() => {
        MigrationHandler.migrate(true).catch(() => { });
      }, 5000);
    }
  }

  private static createMigrationTasks(): MigrationTask[] {
    const currentMigrationTasks: MigrationTask[] = [];
    currentMigrationTasks.push(new RemoveDuplicateTagVisualIDsTask());
    currentMigrationTasks.push(new AddCompanyIDToTransactionsTask());
    currentMigrationTasks.push(new AddCompanyIDToChargingStationsTask());
    currentMigrationTasks.push(new RestoreDataIntegrityInSiteUsersTask());
    currentMigrationTasks.push(new AddUserIDToCarsTask());
    return currentMigrationTasks;
  }

  private static async executeTask(currentMigrationTask: MigrationTask): Promise<void> {
    try {
      // Log Start Task
      let logMsg = `${currentMigrationTask.isAsynchronous() ? 'Asynchronous' : 'Synchronous'} Migration Task '${currentMigrationTask.getName()}' Version '${currentMigrationTask.getVersion()}' is running ${cluster.isWorker ? 'in worker ' + cluster.worker.id.toString() : 'in master'}...`;
      await Logging.logInfo({
        tenantID: Constants.DEFAULT_TENANT,
        action: ServerAction.MIGRATION,
        module: MODULE_NAME, method: 'executeTask',
        message: logMsg
      });
      // Log in the console also
      console.log(logMsg);
      // Start time and date
      const startTaskTime = moment();
      const startDate = new Date();
      // Execute Migration
      await currentMigrationTask.migrate();
      // End time
      const totalTaskTimeSecs = moment.duration(moment().diff(startTaskTime)).asSeconds();
      // End
      // Save to the DB
      await MigrationStorage.saveMigration({
        name: currentMigrationTask.getName(),
        version: currentMigrationTask.getVersion(),
        timestamp: startDate,
        durationSecs: totalTaskTimeSecs
      });
      logMsg = `${currentMigrationTask.isAsynchronous() ? 'Asynchronous' : 'Synchronous'} Migration Task '${currentMigrationTask.getName()}' Version '${currentMigrationTask.getVersion()}' has run with success in ${totalTaskTimeSecs} secs ${cluster.isWorker ? 'in worker ' + cluster.worker.id.toString() : 'in master'}`;
      await Logging.logInfo({
        tenantID: Constants.DEFAULT_TENANT,
        action: ServerAction.MIGRATION,
        module: MODULE_NAME, method: 'executeTask',
        message: logMsg
      });
      // Log in the console also
      console.log(logMsg);
    } catch (error) {
      const logMsg = `${currentMigrationTask.isAsynchronous() ? 'Asynchronous' : 'Synchronous'} Migration Task '${currentMigrationTask.getName()}' Version '${currentMigrationTask.getVersion()}' has failed with error: ${error.toString()} ${cluster.isWorker ? 'in worker ' + cluster.worker.id.toString() : 'in master'}`;
      await Logging.logError({
        tenantID: Constants.DEFAULT_TENANT,
        action: ServerAction.MIGRATION,
        module: MODULE_NAME, method: 'executeTask',
        message: logMsg,
        detailedMessages: { error: error.stack }
      });
      console.error(chalk.red(logMsg));
    }
  }
}
