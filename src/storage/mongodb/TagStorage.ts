import Tag, { ImportedTag } from '../../types/Tag';
import global, { FilterParams, ImportStatus } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';
import moment from 'moment';

const MODULE_NAME = 'TagStorage';

export default class TagStorage {

  public static async saveTag(tenant: Tenant, tag: Tag): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveTag');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    const tagMDB = {
      _id: tag.id,
      userID: DatabaseUtils.convertToObjectID(tag.userID),
      issuer: Utils.convertToBoolean(tag.issuer),
      active: Utils.convertToBoolean(tag.active),
      default: Utils.convertToBoolean(tag.default),
      visualID: tag.visualID ?? new ObjectId().toString(),
      ocpiToken: tag.ocpiToken,
      description: tag.description,
      importedData: tag.importedData
    };
    // Check Created/Last Changed By
    DatabaseUtils.addLastChangedCreatedProps(tagMDB, tag);
    // Save
    await global.database.getCollection<any>(tenant.id, 'tags').findOneAndUpdate(
      { '_id': tag.id },
      { $set: tagMDB },
      { upsert: true, returnDocument: 'after' });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveTag', uniqueTimerID, tagMDB);
  }

  public static async saveImportedTag(tenant: Tenant, importedTagToSave: ImportedTag): Promise<string> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveImportedTag');
    const tagMDB = {
      _id: importedTagToSave.id,
      visualID: importedTagToSave.visualID,
      description: importedTagToSave.description,
      name: importedTagToSave.name,
      firstName: importedTagToSave.firstName,
      email: importedTagToSave.email,
      status: importedTagToSave.status,
      errorDescription: importedTagToSave.errorDescription,
      importedOn: importedTagToSave.importedOn,
      importedBy: importedTagToSave.importedBy,
      siteIDs: importedTagToSave.siteIDs,
      importedData: importedTagToSave.importedData
    };
    await global.database.getCollection<any>(tenant.id, 'importedtags').findOneAndUpdate(
      { _id: tagMDB._id },
      { $set: tagMDB },
      { upsert: true, returnDocument: 'after' }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveImportedTag', uniqueTimerID, tagMDB);
    return tagMDB._id;
  }

  public static async saveImportedTags(tenant: Tenant, importedTagsToSave: ImportedTag[]): Promise<number> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveImportedTags');
    const importedTagsToSaveMDB: any = importedTagsToSave.map((importedTagToSave) => ({
      _id: importedTagToSave.id,
      visualID: importedTagToSave.visualID,
      description: importedTagToSave.description,
      name: importedTagToSave.name,
      firstName: importedTagToSave.firstName,
      email: importedTagToSave.email,
      status: importedTagToSave.status,
      errorDescription: importedTagToSave.errorDescription,
      importedOn: importedTagToSave.importedOn,
      importedBy: importedTagToSave.importedBy,
      siteIDs: importedTagToSave.siteIDs,
      importedData: importedTagToSave.importedData
    }));
    // Insert all at once
    const result = await global.database.getCollection<any>(tenant.id, 'importedtags').insertMany(
      importedTagsToSaveMDB,
      { ordered: false }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveImportedTags', uniqueTimerID, importedTagsToSave);
    return result.insertedCount;
  }

  public static async deleteImportedTag(tenant: Tenant, importedTagID: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteImportedTag');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'importedtags').deleteOne(
      {
        '_id': importedTagID,
      });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteImportedTag', uniqueTimerID, { id: importedTagID });
  }

  public static async deleteImportedTags(tenant: Tenant): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteImportedTags');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'importedtags').deleteMany({});
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteImportedTags', uniqueTimerID);
  }

  public static async getImportedTagsCount(tenant: Tenant): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getImportedTagsCount');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Count documents
    const nbrOfDocuments = await global.database.getCollection<any>(tenant.id, 'importedtags').countDocuments();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getImportedTagsCount', uniqueTimerID);
    return nbrOfDocuments;
  }

  public static async getImportedTags(tenant: Tenant,
      params: { status?: ImportStatus; search?: string },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<ImportedTag>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getImportedTags');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    const filters: FilterParams = {};
    // Create Aggregation
    const aggregation = [];
    // Filter
    if (params.search) {
      filters.$or = [
        { '_id': { $regex: params.search, $options: 'i' } },
        { 'description': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Status
    if (params.status) {
      filters.status = params.status;
    }
    // Add filters
    aggregation.push({
      $match: filters
    });
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const tagsImportCountMDB = await global.database.getCollection<any>(tenant.id, 'importedtags')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getImportedTags', uniqueTimerID, tagsImportCountMDB);
      return {
        count: (tagsImportCountMDB.length > 0 ? tagsImportCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { status: -1, name: 1, firstName: 1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Change ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'importedBy');
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const tagsImportMDB = await global.database.getCollection<any>(tenant.id, 'importedtags')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getTagsImport', uniqueTimerID, tagsImportMDB);
    // Ok
    return {
      count: (tagsImportCountMDB.length > 0 ?
        (tagsImportCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : tagsImportCountMDB[0].count) : 0),
      result: tagsImportMDB
    };
  }

  public static async clearDefaultUserTag(tenant: Tenant, userID: string): Promise<void> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'clearDefaultUserTag');
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'tags').updateMany(
      {
        userID: DatabaseUtils.convertToObjectID(userID),
        default: true
      },
      {
        $set: { default: false }
      });
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'clearDefaultUserTag', uniqueTimerID, { userID });
  }

  public static async deleteTag(tenant: Tenant, tagID: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteTag');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'tags').deleteOne(
      {
        '_id': tagID,
      }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteTag', uniqueTimerID, { id: tagID });
  }

  public static async deleteTagsByUser(tenant: Tenant, userID: string): Promise<number> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteTagsByUser');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    const result = await global.database.getCollection<any>(tenant.id, 'tags').deleteMany(
      {
        'userID': DatabaseUtils.convertToObjectID(userID),
      }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteTagsByUser', uniqueTimerID, { id: userID });
    return result.deletedCount;
  }

  public static async getTag(tenant: Tenant, id: string,
      params: { userIDs?: string[], withUser?: boolean; withNbrTransactions?: boolean; active?: boolean; } = {}, projectFields?: string[]): Promise<Tag> {
    const tagMDB = await TagStorage.getTags(tenant, {
      tagIDs: [id],
      withUser: params.withUser,
      withNbrTransactions: params.withNbrTransactions,
      userIDs: params.userIDs,
      active: params.active,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return tagMDB.count === 1 ? tagMDB.result[0] : null;
  }

  public static async getTagByVisualID(tenant: Tenant, visualID: string,
      params: { withUser?: boolean; withNbrTransactions?: boolean, userIDs?: string[] } = {}, projectFields?: string[]): Promise<Tag> {
    const tagMDB = await TagStorage.getTags(tenant, {
      visualIDs: [visualID],
      withUser: params.withUser,
      withNbrTransactions: params.withNbrTransactions,
      userIDs: params.userIDs
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return tagMDB.count === 1 ? tagMDB.result[0] : null;
  }

  public static async getFirstActiveUserTag(tenant: Tenant, userID: string,
      params: { issuer?: boolean; } = {}, projectFields?: string[]): Promise<Tag> {
    const tagMDB = await TagStorage.getTags(tenant, {
      userIDs: [userID],
      issuer: params.issuer,
      active: true,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return tagMDB.count === 1 ? tagMDB.result[0] : null;
  }

  public static async getDefaultUserTag(tenant: Tenant, userID: string,
      params: { issuer?: boolean; active?: boolean; } = {}, projectFields?: string[]): Promise<Tag> {
    const tagMDB = await TagStorage.getTags(tenant, {
      userIDs: [userID],
      issuer: params.issuer,
      active: params.active,
      defaultTag: true,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return tagMDB.count === 1 ? tagMDB.result[0] : null;
  }

  public static async getTags(tenant: Tenant,
      params: {
        issuer?: boolean; tagIDs?: string[]; visualIDs?: string[]; userIDs?: string[]; siteIDs?: string[]; dateFrom?: Date; dateTo?: Date;
        withUser?: boolean; withUsersOnly?: boolean; withNbrTransactions?: boolean; search?: string, defaultTag?: boolean, active?: boolean;
      },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<Tag>> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getTags');
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
    const filters: FilterParams = {};
    // Filter by other properties
    if (params.search) {
      filters.$or = [
        { '_id': { $regex: params.search, $options: 'i' } },
        { 'description': { $regex: params.search, $options: 'i' } },
        { 'visualID': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Remove deleted
    filters.deleted = { '$ne': true };
    // Tag IDs
    if (!Utils.isEmptyArray(params.tagIDs)) {
      filters._id = { $in: params.tagIDs };
    }
    // Visual Tag IDs
    if (!Utils.isEmptyArray(params.visualIDs)) {
      filters.visualID = { $in: params.visualIDs };
    }
    // Users
    if (!Utils.isEmptyArray(params.userIDs)) {
      filters.userID = { $in: params.userIDs.map((userID) => DatabaseUtils.convertToObjectID(userID)) };
    }
    // Default Tag
    if (params.defaultTag) {
      filters.default = true;
    }
    // Sites
    if (!Utils.isEmptyArray(params.siteIDs)) {
      DatabaseUtils.pushSiteUserLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'userID', foreignField: 'userID', asField: 'siteUsers'
      });
      aggregation.push({
        $match: { 'siteUsers.siteID': { $in: params.siteIDs.map((site) => DatabaseUtils.convertToObjectID(site)) } }
      });
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    // With Users only
    if (params.withUsersOnly) {
      filters.userID = { $exists: true, $ne: null };
    }
    // Active
    if (Utils.objectHasProperty(params, 'active') && Utils.isBoolean(params.active)) {
      filters.active = params.active;
    }
    // Dates
    if (params.dateFrom && moment(params.dateFrom).isValid()) {
      filters.lastChangedOn = { $gte: new Date(params.dateFrom) };
    }
    if (params.dateTo && moment(params.dateTo).isValid()) {
      filters.lastChangedOn = { $lte: new Date(params.dateTo) };
    }
    if (!Utils.isEmptyJSon(filters)) {
      aggregation.push({ $match: filters });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const tagsCountMDB = await global.database.getCollection<any>(tenant.id, 'tags')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getTags', uniqueTimerID, tagsCountMDB);
      return {
        count: (tagsCountMDB.length > 0 ? tagsCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    if (!dbParams.sort) {
      dbParams.sort = { createdOn: -1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Transactions
    if (params.withNbrTransactions) {
      let additionalPipeline: Record<string, any>[] = [];
      if (params.withUser) {
        additionalPipeline = [{
          '$match': { 'userID': { $exists: true, $ne: null } }
        }];
      }
      DatabaseUtils.pushTransactionsLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: '_id', foreignField: 'tagID',
        count: true, asField: 'transactionsCount', oneToOneCardinality: false,
        objectIDFields: ['createdBy', 'lastChangedBy']
      }, additionalPipeline);
    }
    // Users
    if (params.withUser) {
      DatabaseUtils.pushUserLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, asField: 'user', localField: 'userID',
        foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
    }
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const tagsMDB = await global.database.getCollection<Tag>(tenant.id, 'tags')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getTags', uniqueTimerID, tagsMDB);
    // Ok
    return {
      count: (tagsCountMDB.length > 0 ?
        (tagsCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : tagsCountMDB[0].count) : 0),
      result: tagsMDB,
      projectedFields: projectFields
    };
  }
}
