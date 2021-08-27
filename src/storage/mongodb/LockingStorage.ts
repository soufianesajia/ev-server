import global, { FilterParams } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Lock from '../../types/Locking';
import Logging from '../../utils/Logging';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'LockingStorage';

export default class LockingStorage {
  public static async getLocks(params: { lockIDs?: string[]; }, dbParams: DbParams): Promise<DataResult<Lock>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'getLocks');
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Query by Lock id
    const filters: FilterParams = {};
    if (params.lockIDs) {
      filters._id = { $in: params.lockIDs };
    }
    const aggregation = [];
    if (filters) {
      aggregation.push({
        $match: filters
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const locksCountMDB = await global.database.getCollection<any>(Constants.DEFAULT_TENANT, 'locks')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'getLocks', uniqueTimerID, locksCountMDB);
      return {
        count: (locksCountMDB.length > 0 ? locksCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'tenantID');
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Read DB
    const locksMDB = await global.database.getCollection<Lock>(Constants.DEFAULT_TENANT, 'locks')
      .aggregate(aggregation)
      .toArray();
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'getLocks', uniqueTimerID, locksMDB);
    // Ok
    return {
      count: (locksCountMDB.length > 0 ?
        (locksCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : locksCountMDB[0].count) : 0),
      result: locksMDB
    };
  }

  public static async getLock(lockID: string): Promise<Lock> {
    const locksMDB = await LockingStorage.getLocks(
      { lockIDs: [lockID] },
      Constants.DB_PARAMS_SINGLE_RECORD
    );
    return locksMDB.count === 1 ? locksMDB.result[0] : null;
  }

  public static async insertLock(lockToSave: Lock): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'insertLock');
    // Transfer
    const lockMDB = {
      _id: lockToSave.id,
      tenantID: lockToSave.tenantID !== Constants.DEFAULT_TENANT ? DatabaseUtils.convertToObjectID(lockToSave.tenantID) : null,
      entity: lockToSave.entity,
      key: lockToSave.key,
      type: lockToSave.type,
      timestamp: Utils.convertToDate(lockToSave.timestamp),
      expirationDate: lockToSave.expirationDate,
      hostname: lockToSave.hostname
    };
    // Create
    await global.database.getCollection<any>(Constants.DEFAULT_TENANT, 'locks')
      .insertOne(lockMDB);
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'insertLock', uniqueTimerID, lockToSave);
  }

  public static async deleteLock(lockToDelete: Lock): Promise<boolean> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteLock');
    // Delete
    const result = await global.database.getCollection<any>(Constants.DEFAULT_TENANT, 'locks')
      .findOneAndDelete({ '_id': lockToDelete.id });
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteLock', uniqueTimerID, result);
    return result.value !== null;
  }

  public static async deleteLockByHostname(hostname:string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteLockByHostname');
    // Delete
    const result = await global.database.getCollection<any>(Constants.DEFAULT_TENANT, 'locks')
      .deleteMany({ 'hostname': hostname });
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteLockByHostname', uniqueTimerID, result.deletedCount);
  }
}
