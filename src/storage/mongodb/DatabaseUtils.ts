import BackendError from '../../exception/BackendError';
import Configuration from '../../utils/Configuration';
import Constants from '../../utils/Constants';
import DbLookup from '../../types/database/DbLookup';
import { OCPPFirmwareStatus } from '../../types/ocpp/OCPPServer';
import { ObjectId } from 'mongodb';
import Tenant from '../../types/Tenant';
import TenantStorage from './TenantStorage';
import User from '../../types/User';
import UserToken from '../../types/UserToken';
import Utils from '../../utils/Utils';

const FIXED_COLLECTIONS: string[] = ['tenants', 'migrations'];

const MODULE_NAME = 'DatabaseUtils';

export default class DatabaseUtils {

  public static getFixedCollections(): string[] {
    return FIXED_COLLECTIONS;
  }

  public static pushCreatedLastChangedInAggregation(tenantID: string, aggregation: any[]): void {
    // Add Created By
    DatabaseUtils._pushUserInAggregation(tenantID, aggregation, 'createdBy');
    // Add Last Changed By
    DatabaseUtils._pushUserInAggregation(tenantID, aggregation, 'lastChangedBy');
  }

  public static getCollectionName(tenantID: string, collectionNameSuffix: string): string {
    let prefix = Constants.DEFAULT_TENANT;
    if (!FIXED_COLLECTIONS.includes(collectionNameSuffix) && ObjectId.isValid(tenantID)) {
      prefix = tenantID;
    }
    return `${prefix}.${collectionNameSuffix}`;
  }

  public static pushSiteLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('sites', {
      objectIDFields: ['companyID', 'createdBy', 'lastChangedBy'],
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushCarCatalogLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('carcatalogs', {
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushCarLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('cars', {
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushSiteUserLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('siteusers', {
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushTransactionsLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('transactions', {
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushUserLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('users', {
      objectIDFields: ['createdBy', 'lastChangedBy'],
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushCompanyLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('companies', {
      objectIDFields: ['createdBy', 'lastChangedBy'],
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushSiteAreaLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('siteareas', {
      objectIDFields: ['createdBy', 'lastChangedBy'],
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushChargingStationLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('chargingstations', {
      objectIDFields: ['createdBy', 'lastChangedBy'],
      ...lookupParams
    }, [DatabaseUtils.buildChargingStationInactiveFlagQuery(), ...additionalPipeline]);
  }

  public static pushTagLookupInAggregation(lookupParams: DbLookup, additionalPipeline: Record<string, any>[] = []): void {
    DatabaseUtils.pushCollectionLookupInAggregation('tags', {
      objectIDFields: ['createdBy', 'lastChangedBy'],
      ...lookupParams
    }, additionalPipeline);
  }

  public static pushArrayLookupInAggregation(arrayName: string,
      lookupMethod: (lookupParams: DbLookup, additionalPipeline?: Record<string, any>[]) => void,
      lookupParams: DbLookup, additionalParams: { pipeline?: Record<string, any>[], sort?: any } = {}): void {
    // Unwind the source
    lookupParams.aggregation.push({ '$unwind': { path: `$${arrayName}`, preserveNullAndEmptyArrays: true } });
    // Call the lookup
    lookupMethod(lookupParams);
    // Add external pipeline
    if (!Utils.isEmptyArray(additionalParams.pipeline)) {
      lookupParams.aggregation.push(...additionalParams.pipeline);
    }
    // Sort (for unwinded array props)
    if (additionalParams.sort) {
      lookupParams.aggregation.push({
        $sort: additionalParams.sort
      });
    }
    // Group back to arrays
    lookupParams.aggregation.push(
      JSON.parse(`{
        "$group": {
          "_id": {
            "ïd": "$id",
            "_ïd": "$_id"
          },
          "root": { "$first": "$$ROOT" },
          "${arrayName}": { "$push": "$${arrayName}" }
        }
      }`)
    );
    // Replace array
    lookupParams.aggregation.push(JSON.parse(`{
      "$addFields": {
        "root.${arrayName}": {
          "$cond": {
            "if": {
              "$or": [
                { "$eq": [ "$${arrayName}", [{}] ] },
                { "$eq": [ "$${arrayName}", [null] ] }
              ]
            },
            "then": [],
            "else": "$${arrayName}"
          }
        }
      }
    }`));
    // Replace root
    lookupParams.aggregation.push({ $replaceRoot: { newRoot: '$root' } });
    // Sort again (after grouping, sort is lost)
    if (additionalParams.sort) {
      lookupParams.aggregation.push({
        $sort: additionalParams.sort
      });
    }
  }

  public static pushCollectionLookupInAggregation(collection: string, lookupParams: DbLookup, additionalPipeline?: Record<string, any>[]): void {
    // Build Lookup's pipeline
    if (!lookupParams.pipelineMatch) {
      lookupParams.pipelineMatch = {};
    }
    lookupParams.pipelineMatch['$expr'] = { '$eq': [`$${lookupParams.foreignField}`, '$$fieldVar'] };
    const pipeline: any[] = [
      { '$match': lookupParams.pipelineMatch }
    ];
    if (!Utils.isEmptyArray(additionalPipeline)) {
      pipeline.push(...additionalPipeline);
    }
    if (lookupParams.count) {
      pipeline.push({
        '$group': {
          '_id': `$${lookupParams.asField}`,
          'count': { '$sum': 1 }
        }
      });
    }
    // Replace ID field
    DatabaseUtils.pushRenameDatabaseID(pipeline);
    // Convert ObjectId fields to String
    if (lookupParams.objectIDFields) {
      for (const foreignField of lookupParams.objectIDFields) {
        DatabaseUtils.pushConvertObjectIDToString(pipeline, foreignField);
      }
    }
    // Add Projected fields
    DatabaseUtils.projectFields(pipeline, lookupParams.projectedFields);
    // Create Lookup
    lookupParams.aggregation.push({
      $lookup: {
        from: DatabaseUtils.getCollectionName(lookupParams.tenantID, collection),
        'let': { 'fieldVar': `$${lookupParams.localField}` },
        pipeline,
        'as': lookupParams.asField
      }
    });
    // One record?
    if (lookupParams.oneToOneCardinality) {
      lookupParams.aggregation.push({
        $unwind: {
          path: `$${lookupParams.asField}`,
          preserveNullAndEmptyArrays: !lookupParams.oneToOneCardinalityNotNull
        }
      });
    }
    // Check if the target field is a composed property: empty root document must be null ({} = null)
    const splitAsField = lookupParams.asField.split('.');
    if (splitAsField.length > 1) {
      lookupParams.aggregation.push(JSON.parse(`{
        "$addFields": {
          "${splitAsField[0]}": {
            "$cond": {
              "if": { "$eq": [ "$${splitAsField[0]}", ${lookupParams.oneToOneCardinality ? '{}' : '[]'} ] },
              "then": null, "else": "$${splitAsField[0]}" }
          }
        }
      }`));
    }
    // Set only the count
    if (lookupParams.count) {
      lookupParams.aggregation.push({
        $unwind: {
          path: `$${lookupParams.asField}`,
          preserveNullAndEmptyArrays: true
        }
      });
      lookupParams.aggregation.push(JSON.parse(`{
        "$addFields": {
          "${lookupParams.asField}": "$${lookupParams.asField}.count"
        }
      }`));
    }
  }

  public static pushChargingStationInactiveFlag(aggregation: any[]): void {
    // Add inactive field
    aggregation.push(DatabaseUtils.buildChargingStationInactiveFlagQuery());
  }

  public static projectFields(aggregation: any[], projectedFields: string[], removedFields: string[] = []): void {
    if (!Utils.isEmptyArray(projectedFields)) {
      const project = {
        $project: {}
      };
      for (const projectedField of projectedFields) {
        project.$project[projectedField] = 1;
      }
      for (const removedField of removedFields) {
        project.$project[removedField] = 0;
      }
      aggregation.push(project);
    }
  }

  public static pushConvertObjectIDToString(aggregation: any[], fieldName: string, renamedFieldName?: string): void {
    if (!renamedFieldName) {
      renamedFieldName = fieldName;
    }
    // Make sure the field exists so it can be operated on
    aggregation.push(JSON.parse(`{
      "$addFields": {
        "${renamedFieldName}": {
          "$ifNull": ["$${fieldName}", null]
        }
      }
    }`));
    // Convert to string (or null)
    aggregation.push(JSON.parse(`{
      "$addFields": {
        "${renamedFieldName}": {
          "$cond": { "if": { "$gt": ["$${fieldName}", null] }, "then": { "$toString": "$${fieldName}" }, "else": null }
        }
      }
    }`));
    // Check if the field is a composed property: empty root document must be null ({} = null)
    const splitFieldName = renamedFieldName.split('.');
    if (splitFieldName.length === 2) {
      aggregation.push(JSON.parse(`{
        "$addFields": {
          "${splitFieldName[0]}": {
            "$cond": {
              "if": { "$eq": [ "$${splitFieldName[0]}", { "${splitFieldName[1]}": null } ] },
              "then": null, "else": "$${splitFieldName[0]}" }
          }
        }
      }`));
    }
  }

  public static clearFieldValueIfSubFieldIsNull(aggregation: any[], fieldName: string, subFieldName: string): void {
    // Remove if null
    const addNullFields: any = {};
    addNullFields[`${fieldName}`] = {
      $cond: {
        if: { $gt: [`$${fieldName}.${subFieldName}`, null] },
        then: `$${fieldName}`,
        else: null
      }
    };
    aggregation.push({ $addFields: addNullFields });
  }

  public static pushRenameField(aggregation: any[], fieldName: string, renamedFieldName: string): void {
    // Rename
    aggregation.push(JSON.parse(`{
      "$addFields": {
        "${renamedFieldName}": "$${fieldName}"
      }
    }`));
    // Delete
    aggregation.push(JSON.parse(`{
      "$project": {
        "${fieldName}": 0
      }
    }`));
  }

  public static pushRenameDatabaseIDToNumber(aggregation: any[]): void {
    // Rename ID
    DatabaseUtils.pushRenameField(aggregation, '_id', 'id');
  }

  public static addLastChangedCreatedProps(dest: any, entity: any): void {
    dest.createdBy = null;
    dest.lastChangedBy = null;
    if (entity.createdBy || entity.createdOn) {
      dest.createdBy = DatabaseUtils._mongoConvertUserID(entity, 'createdBy');
      dest.createdOn = Utils.convertToDate(entity.createdOn);
    }
    if (entity.lastChangedBy || entity.lastChangedOn) {
      dest.lastChangedBy = DatabaseUtils._mongoConvertUserID(entity, 'lastChangedBy');
      dest.lastChangedOn = Utils.convertToDate(entity.lastChangedOn);
    }
  }

  public static pushRenameDatabaseID(aggregation: any[], nestedField?: string): void {
    // Root document?
    if (!nestedField) {
      // Convert ID to string
      DatabaseUtils.pushConvertObjectIDToString(aggregation, '_id', 'id');
      // Remove IDs
      aggregation.push({
        $project: {
          '_id': 0,
          '__v': 0
        }
      });
    } else {
      // Convert ID to string
      DatabaseUtils.pushConvertObjectIDToString(
        aggregation, `${nestedField}._id`, `${nestedField}.id`);
      // Remove IDs
      const project = {
        $project: {}
      };
      project.$project[nestedField] = {
        '__v': 0,
        '_id': 0
      };
      aggregation.push(project);
    }
  }

  public static convertToObjectID(id: any): ObjectId {
    let changedID: ObjectId = id;
    // Check
    if (typeof id === 'string') {
      // Create Object
      changedID = new ObjectId(id);
    }
    return changedID;
  }

  public static convertUserToObjectID(user: User | UserToken | string): ObjectId | null {
    let userID: ObjectId | null = null;
    // Check Created By
    if (user) {
      // Check User Model
      if (typeof user === 'object' &&
        user.constructor.name !== 'ObjectId') {
        // This is the User Model
        userID = DatabaseUtils.convertToObjectID(user.id);
      }
      // Check String
      if (typeof user === 'string') {
        // This is a String
        userID = DatabaseUtils.convertToObjectID(user);
      }
    }
    return userID;
  }

  public static async checkTenant(tenantID: string): Promise<Tenant> {
    if (!tenantID) {
      throw new BackendError({
        source: Constants.CENTRAL_SERVER,
        module: MODULE_NAME,
        method: 'checkTenant',
        message: 'The Tenant ID is mandatory'
      });
    }
    if (tenantID !== Constants.DEFAULT_TENANT) {
      // Valid Object ID?
      if (!ObjectId.isValid(tenantID)) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME,
          method: 'checkTenant',
          message: `Invalid Tenant ID '${tenantID}'`
        });
      }
      // Get the Tenant
      const tenant = await TenantStorage.getTenant(tenantID);
      if (!tenant) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME,
          method: 'checkTenant',
          message: `Invalid Tenant ID '${tenantID}'`
        });
      }
      return tenant;
    }
  }

  public static checkTenantObject(tenant: Tenant): void {
    if (!tenant) {
      throw new BackendError({
        source: Constants.CENTRAL_SERVER,
        module: MODULE_NAME,
        method: 'checkTenantObject',
        message: 'Invalid Tenant'
      });
    }
  }

  private static buildChargingStationInactiveFlagQuery(): Record<string, any> {
    // Add inactive field
    return {
      $addFields: {
        inactive: {
          $or: [
            { $eq: ['$firmwareUpdateStatus', OCPPFirmwareStatus.INSTALLING] },
            {
              $gte: [
                { $divide: [{ $subtract: [new Date(), '$lastSeen'] }, 1000] },
                Configuration.getChargingStationConfig().heartbeatIntervalOCPPSSecs * 2
              ]
            }
          ]
        }
      }
    };
  }

  // Temporary hack to fix user Id saving. fix all this when user is typed...
  private static _mongoConvertUserID(obj: any, prop: string): ObjectId | null {
    if (!obj || !obj[prop]) {
      return null;
    }
    if (ObjectId.isValid(obj[prop])) {
      return obj[prop] as ObjectId;
    }
    if (obj[prop].id) {
      return DatabaseUtils.convertToObjectID(obj[prop].id);
    }
    return null;
  }

  private static _pushUserInAggregation(tenantID: string, aggregation: any[], fieldName: string) {
    // Created By Lookup
    aggregation.push({
      $lookup: {
        from: DatabaseUtils.getCollectionName(tenantID, 'users'),
        localField: fieldName,
        foreignField: '_id',
        as: fieldName
      }
    });
    // Single Record
    aggregation.push({
      $unwind: { 'path': `$${fieldName}`, 'preserveNullAndEmptyArrays': true }
    });
    // Replace nested ID field
    DatabaseUtils.pushRenameDatabaseID(aggregation, fieldName);
    // Handle null
    const addNullFields: any = {};
    addNullFields[`${fieldName}`] = {
      $cond: {
        if: { $gt: [`$${fieldName}.id`, null] },
        then: `$${fieldName}`,
        else: null
      }
    };
    aggregation.push({ $addFields: addNullFields });
    // Project
    const projectFields: any = {};
    projectFields[`${fieldName}`] = Constants.MONGO_USER_MASK;
    aggregation.push({
      $project: projectFields
    });
  }
}
