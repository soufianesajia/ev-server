import global, { FilterParams } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import RegistrationToken from '../../types/RegistrationToken';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'RegistrationTokenStorage';

export default class RegistrationTokenStorage {
  static async saveRegistrationToken(tenant: Tenant, registrationToken: RegistrationToken): Promise<string> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveRegistrationToken');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Set
    const registrationTokenMDB = {
      _id: registrationToken.id ? DatabaseUtils.convertToObjectID(registrationToken.id) : new ObjectId(),
      description: registrationToken.description,
      siteAreaID: DatabaseUtils.convertToObjectID(registrationToken.siteAreaID),
      expirationDate: Utils.convertToDate(registrationToken.expirationDate),
      revocationDate: Utils.convertToDate(registrationToken.revocationDate)
    };
    // Add Last Changed/Created props
    DatabaseUtils.addLastChangedCreatedProps(registrationTokenMDB, registrationToken);
    // Modify
    await global.database.getCollection(tenant.id, 'registrationtokens').findOneAndUpdate(
      { _id: registrationTokenMDB._id },
      { $set: registrationTokenMDB },
      { upsert: true, returnDocument: 'after' }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveRegistrationToken', uniqueTimerID, registrationTokenMDB);
    return registrationTokenMDB._id.toString();
  }

  static async getRegistrationTokens(tenant: Tenant,
      params: { tokenIDs?: string[]; siteIDs?: string[]; siteAreaID?: string } = {}, dbParams: DbParams, projectFields?: string[]):
      Promise<DataResult<RegistrationToken>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getRegistrationTokens');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Create Aggregation
    const aggregation = [];
    // Add Site Area
    DatabaseUtils.pushSiteAreaLookupInAggregation({
      tenantID: tenant.id, aggregation, localField: 'siteAreaID', foreignField: '_id',
      asField: 'siteArea', oneToOneCardinality: true
    });
    // Set the filters
    const filters: FilterParams = {};
    // Build filter
    if (params.siteAreaID) {
      filters.siteAreaID = DatabaseUtils.convertToObjectID(params.siteAreaID);
    }
    // Build filter
    if (!Utils.isEmptyArray(params.tokenIDs)) {
      filters._id = {
        $in: params.tokenIDs.map((tokenID) => DatabaseUtils.convertToObjectID(tokenID))
      };
    }
    // Sites
    if (!Utils.isEmptyArray(params.siteIDs)) {
      filters['siteArea.siteID'] = {
        $in: params.siteIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
      };
    }
    // Filters
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
    const registrationTokensCountMDB = await global.database.getCollection<DataResult<RegistrationToken>>(tenant.id, 'registrationtokens')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getRegistrationTokens', uniqueTimerID, registrationTokensCountMDB);
      return {
        count: (registrationTokensCountMDB.length > 0 ? registrationTokensCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { expirationDate: -1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    if (dbParams.skip > 0) {
      aggregation.push({ $skip: dbParams.skip });
    }
    // Limit
    aggregation.push({
      $limit: (dbParams.limit > 0 && dbParams.limit < Constants.DB_RECORD_COUNT_CEIL) ? dbParams.limit : Constants.DB_RECORD_COUNT_CEIL
    });
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const registrationTokens = await global.database.getCollection<any>(tenant.id, 'registrationtokens')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getRegistrationTokens', uniqueTimerID, registrationTokens);
    // Ok
    return {
      count: (registrationTokensCountMDB.length > 0 ?
        (registrationTokensCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : registrationTokensCountMDB[0].count) : 0),
      result: registrationTokens
    };
  }

  static async getRegistrationToken(tenant: Tenant, id: string = Constants.UNKNOWN_OBJECT_ID,
      projectFields?: string[]): Promise<RegistrationToken> {
    const registrationTokensMDB = await RegistrationTokenStorage.getRegistrationTokens(tenant, {
      tokenIDs: [id]
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return registrationTokensMDB.count === 1 ? registrationTokensMDB.result[0] : null;
  }

  static async deleteRegistrationToken(tenant: Tenant, id: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteRegistrationToken');
    await global.database.getCollection<any>(tenant.id, 'registrationtokens')
      .findOneAndDelete({ '_id': DatabaseUtils.convertToObjectID(id) });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteRegistrationToken', uniqueTimerID, { id });
  }
}
