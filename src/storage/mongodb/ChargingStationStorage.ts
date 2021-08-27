import { ChargePointStatus, OCPPFirmwareStatus } from '../../types/ocpp/OCPPServer';
import { ChargingProfile, ChargingProfilePurposeType, ChargingRateUnitType } from '../../types/ChargingProfile';
import ChargingStation, { ChargePoint, ChargingStationOcpiData, ChargingStationOcppParameters, ChargingStationOicpData, ChargingStationTemplate, Connector, ConnectorType, CurrentType, OcppParameter, PhaseAssignmentToGrid, RemoteAuthorization, Voltage } from '../../types/ChargingStation';
import { ChargingStationInError, ChargingStationInErrorType } from '../../types/InError';
import { GridFSBucket, GridFSBucketReadStream, GridFSBucketWriteStream, ObjectId } from 'mongodb';
import global, { FilterParams } from '../../types/GlobalType';

import BackendError from '../../exception/BackendError';
import Configuration from '../../utils/Configuration';
import Constants from '../../utils/Constants';
import Cypher from '../../utils/Cypher';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import { InactivityStatus } from '../../types/Transaction';
import Logging from '../../utils/Logging';
import { ServerAction } from '../../types/Server';
import Tenant from '../../types/Tenant';
import TenantComponents from '../../types/TenantComponents';
import TenantStorage from './TenantStorage';
import Utils from '../../utils/Utils';
import fs from 'fs';
import moment from 'moment';

const MODULE_NAME = 'ChargingStationStorage';

export interface ConnectorMDB {
  id?: string; // Needed for the roaming component
  connectorId: number;
  currentInstantWatts: number;
  currentStateOfCharge: number;
  currentTotalConsumptionWh: number;
  currentTotalInactivitySecs: number;
  currentInactivityStatus: InactivityStatus;
  currentTransactionID: number;
  currentTransactionDate: Date;
  currentTagID: string;
  status: ChargePointStatus;
  errorCode: string;
  info: string;
  vendorErrorCode: string;
  power: number;
  type: ConnectorType;
  voltage: Voltage;
  amperage: number;
  amperageLimit: number;
  currentUserID: ObjectId;
  statusLastChangedOn: Date;
  numberOfConnectedPhase: number;
  currentType: CurrentType;
  chargePointID: number;
  phaseAssignmentToGrid: PhaseAssignmentToGrid;
}

export default class ChargingStationStorage {

  public static async updateChargingStationTemplatesFromFile(): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'updateChargingStationTemplatesFromFile');
    // Read File
    let chargingStationTemplates: ChargingStationTemplate[];
    try {
      chargingStationTemplates = JSON.parse(fs.readFileSync(Configuration.getChargingStationTemplatesConfig().templatesFilePath, 'utf8'));
    } catch (error) {
      await Logging.logActionExceptionMessage(Constants.DEFAULT_TENANT, ServerAction.UPDATE_CHARGING_STATION_TEMPLATES, error);
      return;
    }
    // Delete all previous templates
    await ChargingStationStorage.deleteChargingStationTemplates();
    // Update Templates
    for (const chargingStationTemplate of chargingStationTemplates) {
      try {
        // Set the hashes
        chargingStationTemplate.hash = Cypher.hash(JSON.stringify(chargingStationTemplate));
        chargingStationTemplate.hashTechnical = Cypher.hash(JSON.stringify(chargingStationTemplate.technical));
        chargingStationTemplate.hashCapabilities = Cypher.hash(JSON.stringify(chargingStationTemplate.capabilities));
        chargingStationTemplate.hashOcppStandard = Cypher.hash(JSON.stringify(chargingStationTemplate.ocppStandardParameters));
        chargingStationTemplate.hashOcppVendor = Cypher.hash(JSON.stringify(chargingStationTemplate.ocppVendorParameters));
        // Save
        await ChargingStationStorage.saveChargingStationTemplate(chargingStationTemplate);
      } catch (error) {
        await Logging.logActionExceptionMessage(Constants.DEFAULT_TENANT, ServerAction.UPDATE_CHARGING_STATION_TEMPLATES, error);
      }
    }
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'updateChargingStationTemplatesFromFile', uniqueTimerID, chargingStationTemplates);
  }

  public static async getChargingStationTemplates(chargePointVendor?: string): Promise<ChargingStationTemplate[]> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'getChargingStationTemplates');
    // Create Aggregation
    const aggregation = [];
    // Change ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Query Templates
    const chargingStationTemplatesMDB: ChargingStationTemplate[] =
      await global.database.getCollection<ChargingStationTemplate>(Constants.DEFAULT_TENANT, 'chargingstationtemplates')
        .aggregate(aggregation).toArray();
    const chargingStationTemplates: ChargingStationTemplate[] = [];
    // Reverse match the regexp in JSON template records against the charging station vendor string
    for (const chargingStationTemplateMDB of chargingStationTemplatesMDB) {
      const regExp = new RegExp(chargingStationTemplateMDB.chargePointVendor);
      if (regExp.test(chargePointVendor)) {
        chargingStationTemplates.push(chargingStationTemplateMDB);
      }
    }
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'getChargingStationTemplates', uniqueTimerID, chargingStationTemplatesMDB);
    return chargingStationTemplates;
  }

  public static async deleteChargingStationTemplates(): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteChargingStationTemplates');
    // Delete all records
    await global.database.getCollection<ChargingStationTemplate>(Constants.DEFAULT_TENANT, 'chargingstationtemplates').deleteMany(
      { qa: { $not: { $eq: true } } }
    );
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'deleteChargingStationTemplates', uniqueTimerID);
  }

  public static async saveChargingStationTemplate(chargingStationTemplate: ChargingStationTemplate): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'saveChargingStationTemplate');
    // Modify and return the modified document
    await global.database.getCollection<ChargingStationTemplate>(Constants.DEFAULT_TENANT, 'chargingstationtemplates').findOneAndReplace(
      { '_id': chargingStationTemplate.id },
      chargingStationTemplate,
      { upsert: true });
    // Debug
    await Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'saveChargingStationTemplate', uniqueTimerID, chargingStationTemplate);
  }

  public static async getChargingStation(tenant: Tenant, id: string = Constants.UNKNOWN_STRING_ID,
      params: { includeDeleted?: boolean, issuer?: boolean; siteIDs?: string[]; withSiteArea?: boolean; withSite?: boolean; } = {},
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      chargingStationIDs: [id],
      withSite: params.withSite,
      withSiteArea: params.withSiteArea,
      includeDeleted: params.includeDeleted,
      issuer: params.issuer,
      siteIDs: params.siteIDs,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingStationByOcpiEvseID(tenant: Tenant, ocpiEvseID: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      ocpiEvseID,
      withSiteArea: true,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingStationByOcpiLocationUid(tenant: Tenant, ocpiLocationID: string = Constants.UNKNOWN_STRING_ID,
      ocpiEvseUid: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      ocpiLocationID,
      ocpiEvseUid,
      withSiteArea: true
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingStationByOicpEvseID(tenant: Tenant, oicpEvseID: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      oicpEvseID: oicpEvseID,
      withSiteArea: true
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingStations(tenant: Tenant,
      params: {
        search?: string; chargingStationIDs?: string[]; chargingStationSerialNumbers?: string[]; siteAreaIDs?: string[]; withNoSiteArea?: boolean;
        connectorStatuses?: string[]; connectorTypes?: string[]; statusChangedBefore?: Date; withSiteArea?: boolean;
        ocpiEvseUid?: string; ocpiEvseID?: string; ocpiLocationID?: string; oicpEvseID?: string;
        siteIDs?: string[]; companyIDs?: string[]; withSite?: boolean; includeDeleted?: boolean; offlineSince?: Date; issuer?: boolean;
        locCoordinates?: number[]; locMaxDistanceMeters?: number; public?: boolean;
      },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<ChargingStation>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getChargingStations');
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
    // Position coordinates
    if (Utils.containsGPSCoordinates(params.locCoordinates)) {
      aggregation.push({
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: params.locCoordinates
          },
          distanceField: 'distanceMeters',
          maxDistance: params.locMaxDistanceMeters > 0 ? params.locMaxDistanceMeters : Constants.MAX_GPS_DISTANCE_METERS,
          spherical: true
        }
      });
    }
    // Set the filters
    const filters: FilterParams = {};
    // Filter
    if (params.search) {
      filters.$or = [
        { _id: { $regex: params.search, $options: 'im' } },
        { chargePointModel: { $regex: params.search, $options: 'im' } },
        { chargePointVendor: { $regex: params.search, $options: 'im' } }
      ];
    }
    // Remove deleted
    if (!params.includeDeleted) {
      filters.deleted = { '$ne': true };
    }
    // Public Charging Stations
    if (Utils.objectHasProperty(params, 'public')) {
      filters.public = params.public;
    }
    // Charging Stations
    if (!Utils.isEmptyArray(params.chargingStationIDs)) {
      filters._id = {
        $in: params.chargingStationIDs
      };
    }
    // Charging Stations
    if (!Utils.isEmptyArray(params.chargingStationSerialNumbers)) {
      filters.chargeBoxSerialNumber = {
        $in: params.chargingStationSerialNumbers
      };
    }
    // OCPI Evse Uids
    if (params.ocpiEvseUid) {
      filters['ocpiData.evses.uid'] = params.ocpiEvseUid;
    }
    // OCPI Location ID
    if (params.ocpiLocationID) {
      filters['ocpiData.evses.location_id'] = params.ocpiLocationID;
    }
    // OCPI Evse ID
    if (params.ocpiEvseID) {
      filters['ocpiData.evses.evse_id'] = params.ocpiEvseID;
    }
    // OICP Evse ID
    if (params.oicpEvseID) {
      filters['oicpData.evses.EvseID'] = params.oicpEvseID;
    }
    // Filter on lastSeen
    if (params.offlineSince && moment(params.offlineSince).isValid()) {
      filters.lastSeen = { $lte: params.offlineSince };
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    // Add Charging Station inactive flag
    DatabaseUtils.pushChargingStationInactiveFlag(aggregation);
    // Add in aggregation
    aggregation.push({
      $match: filters
    });
    // Connector Status
    if (params.connectorStatuses) {
      filters['connectors.status'] = { $in: params.connectorStatuses };
      filters.inactive = false;
      // Filter connectors array
      aggregation.push({
        '$addFields': {
          'connectors': {
            '$filter': {
              input: '$connectors',
              as: 'connector',
              cond: {
                $in: ['$$connector.status', params.connectorStatuses]
              }
            }
          }
        }
      });
    }
    // Connector Type
    if (params.connectorTypes) {
      filters['connectors.type'] = { $in: params.connectorTypes };
      // Filter connectors array
      aggregation.push({
        '$addFields': {
          'connectors': {
            '$filter': {
              input: '$connectors',
              as: 'connector',
              cond: {
                $in: ['$$connector.type', params.connectorTypes]
              }
            }
          }
        }
      });
    }
    // With no Site Area
    if (params.withNoSiteArea) {
      filters.siteAreaID = null;
    } else if (!Utils.isEmptyArray(params.siteAreaIDs)) {
      // Query by siteAreaID
      filters.siteAreaID = { $in: params.siteAreaIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    // Check Site ID
    if (!Utils.isEmptyArray(params.siteIDs)) {
      // Query by siteID
      filters.siteID = { $in: params.siteIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    // Check Company ID
    if (!Utils.isEmptyArray(params.companyIDs)) {
      // Query by siteID
      filters.companyID = { $in: params.companyIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    // Date before provided
    if (params.statusChangedBefore && moment(params.statusChangedBefore).isValid()) {
      aggregation.push({
        $match: { 'connectors.statusLastChangedOn': { $lte: params.statusChangedBefore } }
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const chargingStationsCountMDB = await global.database.getCollection<any>(tenant.id, 'chargingstations')
      .aggregate([...aggregation, { $count: 'count' }])
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getChargingStations', uniqueTimerID, chargingStationsCountMDB);
      return {
        count: (chargingStationsCountMDB.length > 0 ? chargingStationsCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { _id: 1 };
    }
    // Position coordinates
    if (Utils.containsGPSCoordinates(params.locCoordinates)) {
      // Override (can have only one sort)
      dbParams.sort = { distanceMeters: 1 };
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
    // Users on connectors
    DatabaseUtils.pushArrayLookupInAggregation('connectors', DatabaseUtils.pushUserLookupInAggregation.bind(this), {
      tenantID: tenant.id, aggregation: aggregation, localField: 'connectors.currentUserID', foreignField: '_id',
      asField: 'connectors.user', oneToOneCardinality: true, objectIDFields: ['createdBy', 'lastChangedBy']
    }, { sort: dbParams.sort });
    // Site Area
    if (params.withSiteArea) {
      DatabaseUtils.pushSiteAreaLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: 'siteAreaID', foreignField: '_id',
        asField: 'siteArea', oneToOneCardinality: true
      });
    }
    // Site
    if (params.withSite) {
      DatabaseUtils.pushSiteLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: 'siteID', foreignField: '_id',
        asField: 'site', oneToOneCardinality: true
      });
    }
    // Change ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert siteID back to string after having queried the site
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteArea.siteID');
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Reorder connector ID
    if (!Utils.containsGPSCoordinates(params.locCoordinates)) {
      aggregation.push({
        $sort: dbParams.sort
      });
    }
    // Read DB
    const chargingStationsMDB = await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getChargingStations', uniqueTimerID, chargingStationsMDB);
    return {
      count: (chargingStationsCountMDB.length > 0 ?
        (chargingStationsCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : chargingStationsCountMDB[0].count) : 0),
      result: chargingStationsMDB
    };
  }

  public static async getChargingStationsInError(tenant: Tenant,
      params: { search?: string; siteIDs?: string[]; siteAreaIDs: string[]; errorType?: string[] },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<ChargingStationInError>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getChargingStations');
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
    // Add Charging Station inactive flag
    DatabaseUtils.pushChargingStationInactiveFlag(aggregation);
    // Set the filters
    const filters: FilterParams = {};
    // Search filters
    if (params.search) {
      filters.$or = [
        { _id: { $regex: params.search, $options: 'im' } },
        { chargePointModel: { $regex: params.search, $options: 'im' } },
        { chargePointVendor: { $regex: params.search, $options: 'im' } }
      ];
    }
    // Remove deleted
    filters.deleted = { '$ne': true };
    // Issuer
    filters.issuer = true;
    // Site Areas
    if (!Utils.isEmptyArray(params.siteAreaIDs)) {
      filters.siteAreaID = { $in: params.siteAreaIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    // Add in aggregation
    aggregation.push({
      $match: filters
    });
    // Build lookups to fetch sites from chargers
    aggregation.push({
      $lookup: {
        from: DatabaseUtils.getCollectionName(tenant.id, 'siteareas'),
        localField: 'siteAreaID',
        foreignField: '_id',
        as: 'sitearea'
      }
    });
    // Single Record
    aggregation.push({
      $unwind: { 'path': '$sitearea', 'preserveNullAndEmptyArrays': true }
    });
    // Check Site ID
    if (!Utils.isEmptyArray(params.siteIDs)) {
      aggregation.push({
        $match: {
          'sitearea.siteID': {
            $in: params.siteIDs.map((id) => DatabaseUtils.convertToObjectID(id))
          }
        }
      });
    }
    // Build facets for each type of error if any
    const facets: any = { $facet: {} };
    if (!Utils.isEmptyArray(params.errorType)) {
      // Check allowed
      if (!Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION)
        && params.errorType.includes(ChargingStationInErrorType.MISSING_SITE_AREA)) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME,
          method: 'getChargingStationsInError',
          message: 'Organization is not active whereas filter is on missing site.'
        });
      }
      // Build facet only for one error type
      const array = [];
      for (const type of params.errorType) {
        array.push(`$${type}`);
        facets.$facet[type] = ChargingStationStorage.getChargerInErrorFacet(type);
      }
      aggregation.push(facets);
      // Manipulate the results to convert it to an array of document on root level
      aggregation.push({ $project: { chargersInError: { $setUnion: array } } });
      aggregation.push({ $unwind: '$chargersInError' });
      aggregation.push({ $replaceRoot: { newRoot: '$chargersInError' } });
      // Add a unique identifier as we may have the same Charging Station several time
      aggregation.push({ $addFields: { 'uniqueId': { $concat: ['$_id', '#', '$errorCode'] } } });
    }
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { _id: 1 };
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
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const chargingStationsMDB = await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getChargingStations', uniqueTimerID, chargingStationsMDB);
    return {
      count: chargingStationsMDB.length,
      result: chargingStationsMDB
    };
  }

  public static async saveChargingStation(tenant: Tenant, chargingStationToSave: ChargingStation): Promise<string> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStation');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Build Request
    const chargingStationMDB = {
      _id: chargingStationToSave.id,
      templateHash: chargingStationToSave.templateHash,
      templateHashTechnical: chargingStationToSave.templateHashTechnical,
      templateHashCapabilities: chargingStationToSave.templateHashCapabilities,
      templateHashOcppStandard: chargingStationToSave.templateHashOcppStandard,
      templateHashOcppVendor: chargingStationToSave.templateHashOcppVendor,
      issuer: Utils.convertToBoolean(chargingStationToSave.issuer),
      public: Utils.convertToBoolean(chargingStationToSave.public),
      companyID: DatabaseUtils.convertToObjectID(chargingStationToSave.companyID),
      siteID: DatabaseUtils.convertToObjectID(chargingStationToSave.siteID),
      siteAreaID: DatabaseUtils.convertToObjectID(chargingStationToSave.siteAreaID),
      chargePointSerialNumber: chargingStationToSave.chargePointSerialNumber,
      chargePointModel: chargingStationToSave.chargePointModel,
      chargeBoxSerialNumber: chargingStationToSave.chargeBoxSerialNumber,
      chargePointVendor: chargingStationToSave.chargePointVendor,
      registrationStatus: chargingStationToSave.registrationStatus,
      iccid: chargingStationToSave.iccid,
      imsi: chargingStationToSave.imsi,
      meterType: chargingStationToSave.meterType,
      firmwareVersion: chargingStationToSave.firmwareVersion,
      meterSerialNumber: chargingStationToSave.meterSerialNumber,
      endpoint: chargingStationToSave.endpoint,
      ocppVersion: chargingStationToSave.ocppVersion,
      ocppProtocol: chargingStationToSave.ocppProtocol,
      cfApplicationIDAndInstanceIndex: chargingStationToSave.cfApplicationIDAndInstanceIndex,
      lastSeen: Utils.convertToDate(chargingStationToSave.lastSeen),
      deleted: Utils.convertToBoolean(chargingStationToSave.deleted),
      lastReboot: Utils.convertToDate(chargingStationToSave.lastReboot),
      chargingStationURL: chargingStationToSave.chargingStationURL,
      maximumPower: Utils.convertToInt(chargingStationToSave.maximumPower),
      excludeFromSmartCharging: Utils.convertToBoolean(chargingStationToSave.excludeFromSmartCharging),
      forceInactive: Utils.convertToBoolean(chargingStationToSave.forceInactive),
      manualConfiguration: Utils.convertToBoolean(chargingStationToSave.manualConfiguration),
      powerLimitUnit: chargingStationToSave.powerLimitUnit,
      voltage: Utils.convertToInt(chargingStationToSave.voltage),
      connectors: chargingStationToSave.connectors ? chargingStationToSave.connectors.map(
        (connector) => ChargingStationStorage.filterConnectorMDB(connector)) : [],
      backupConnectors: chargingStationToSave.backupConnectors ? chargingStationToSave.backupConnectors.map(
        (backupConnector) => ChargingStationStorage.filterConnectorMDB(backupConnector)) : [],
      chargePoints: chargingStationToSave.chargePoints ? chargingStationToSave.chargePoints.map(
        (chargePoint) => ChargingStationStorage.filterChargePointMDB(chargePoint)) : [],
      coordinates: Utils.containsGPSCoordinates(chargingStationToSave.coordinates) ? chargingStationToSave.coordinates.map(
        (coordinate) => Utils.convertToFloat(coordinate)) : [],
      currentIPAddress: chargingStationToSave.currentIPAddress,
      capabilities: chargingStationToSave.capabilities,
      ocppStandardParameters: chargingStationToSave.ocppStandardParameters,
      ocppVendorParameters: chargingStationToSave.ocppVendorParameters,
    };
    // Add Created/LastChanged By
    DatabaseUtils.addLastChangedCreatedProps(chargingStationMDB, chargingStationToSave);
    // Modify and return the modified document
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { _id: chargingStationToSave.id },
      { $set: chargingStationMDB },
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStation', uniqueTimerID, chargingStationMDB);
    return chargingStationMDB._id;
  }

  public static async saveChargingStationConnectors(tenant: Tenant, id: string, connectors: Connector[], backupConnectors?: Connector[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationConnectors');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    const updatedProps: any = {};
    // Set connectors
    updatedProps.connectors = connectors.map((connector) =>
      ChargingStationStorage.filterConnectorMDB(connector));
    // Set backup connector
    if (backupConnectors) {
      updatedProps.backupConnectors = backupConnectors.map((backupConnector) =>
        ChargingStationStorage.filterConnectorMDB(backupConnector));
    }
    // Modify document
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      {
        $set: updatedProps
      },
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationConnectors', uniqueTimerID, connectors);
  }

  public static async saveChargingStationCFApplicationIDAndInstanceIndex(tenant: Tenant, id: string,
      cfApplicationIDAndInstanceIndex: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationCFApplicationIDAndInstanceIndex');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          cfApplicationIDAndInstanceIndex
        }
      },
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationCFApplicationIDAndInstanceIndex', uniqueTimerID, cfApplicationIDAndInstanceIndex);
  }

  public static async saveChargingStationOicpData(tenant: Tenant, id: string,
      oicpData: ChargingStationOicpData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationOicpData');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          oicpData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationOicpData', uniqueTimerID, oicpData);
  }

  public static async saveChargingStationLastSeen(tenant: Tenant, id: string,
      params: { lastSeen: Date; currentIPAddress?: string | string[] }): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationLastSeen');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Set data
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: params },
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationLastSeen', uniqueTimerID, params);
  }

  public static async saveChargingStationOcpiData(tenant: Tenant, id: string,
      ocpiData: ChargingStationOcpiData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationOcpiData');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          ocpiData
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationOcpiData', uniqueTimerID, ocpiData);
  }

  public static async saveChargingStationRemoteAuthorizations(tenant: Tenant, id: string,
      remoteAuthorizations: RemoteAuthorization[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationRemoteAuthorizations');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      {
        $set: {
          remoteAuthorizations
        }
      },
      { upsert: false });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationRemoteAuthorizations', uniqueTimerID, remoteAuthorizations);
  }

  public static async saveChargingStationFirmwareStatus(tenant: Tenant, id: string, firmwareUpdateStatus: OCPPFirmwareStatus): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingStationFirmwareStatus');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify document
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: { firmwareUpdateStatus } },
      { upsert: true });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingStationFirmwareStatus', uniqueTimerID, firmwareUpdateStatus);
  }

  public static async deleteChargingStation(tenant: Tenant, id: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteChargingStation');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete Configuration
    await global.database.getCollection<any>(tenant.id, 'configurations')
      .findOneAndDelete({ '_id': id });
    // Delete Charging Profiles
    await ChargingStationStorage.deleteChargingProfiles(tenant, id);
    // Delete Charging Station
    await global.database.getCollection<ChargingStation>(tenant.id, 'chargingstations')
      .findOneAndDelete({ '_id': id });
    // Keep the rest (boot notification, authorize...)
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteChargingStation', uniqueTimerID, { id });
  }

  public static async getOcppParameterValue(tenant: Tenant, chargeBoxID: string, paramName: string): Promise<string> {
    const configuration = await ChargingStationStorage.getOcppParameters(tenant, chargeBoxID);
    let value: string = null;
    if (configuration) {
      // Get the value
      configuration.result.every((param) => {
        // Check
        if (param.key === paramName) {
          value = param.value;
          return false;
        }
        return true;
      });
    }
    return value;
  }

  static async saveOcppParameters(tenant: Tenant, parameters: ChargingStationOcppParameters): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveOcppParameters');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify
    await global.database.getCollection<any>(tenant.id, 'configurations').findOneAndUpdate({
      '_id': parameters.id
    }, {
      $set: {
        configuration: parameters.configuration,
        timestamp: Utils.convertToDate(parameters.timestamp)
      }
    }, {
      upsert: true,
      returnDocument: 'after'
    });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveOcppParameters', uniqueTimerID, parameters);
  }

  public static async getOcppParameters(tenant: Tenant, id: string): Promise<DataResult<OcppParameter>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getOcppParameters');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Read DB
    const parametersMDB = await global.database.getCollection<ChargingStationOcppParameters>(tenant.id, 'configurations')
      .findOne({ '_id': id });
    if (parametersMDB) {
      // Sort
      if (parametersMDB.configuration) {
        parametersMDB.configuration.sort((param1, param2) => {
          if (param1.key.toLocaleLowerCase() < param2.key.toLocaleLowerCase()) {
            return -1;
          }
          if (param1.key.toLocaleLowerCase() > param2.key.toLocaleLowerCase()) {
            return 1;
          }
          return 0;
        });
      }
      // Debug
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getOcppParameters', uniqueTimerID, parametersMDB);
      return {
        count: parametersMDB.configuration.length,
        result: parametersMDB.configuration
      };
    }
    // No conf
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getOcppParameters', uniqueTimerID, parametersMDB);
    return {
      count: 0,
      result: []
    };
  }

  public static async getChargingProfile(tenant: Tenant, id: string): Promise<ChargingProfile> {
    const chargingProfilesMDB = await ChargingStationStorage.getChargingProfiles(tenant, {
      chargingProfileID: id
    }, Constants.DB_PARAMS_SINGLE_RECORD);
    return chargingProfilesMDB.count === 1 ? chargingProfilesMDB.result[0] : null;
  }

  public static async getChargingProfiles(tenant: Tenant,
      params: {
        search?: string; chargingStationIDs?: string[]; connectorID?: number; chargingProfileID?: string;
        profilePurposeType?: ChargingProfilePurposeType; transactionId?: number; withChargingStation?: boolean;
        withSiteArea?: boolean; siteIDs?: string[];
      } = {},
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<ChargingProfile>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getChargingProfiles');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Query by chargingStationID
    const filters: FilterParams = {};
    // Build filter
    if (params.search) {
      filters.$or = [
        { 'chargingStationID': { $regex: params.search, $options: 'i' } },
        { 'profile.transactionId': Utils.convertToInt(params.search) },
      ];
    }
    if (params.chargingProfileID) {
      filters._id = params.chargingProfileID;
    } else {
      // Charger
      if (params.chargingStationIDs) {
        filters.chargingStationID = { $in: params.chargingStationIDs };
      }
      // Connector
      if (params.connectorID) {
        filters.connectorID = params.connectorID;
      }
      // Purpose Type
      if (params.profilePurposeType) {
        filters['profile.chargingProfilePurpose'] = params.profilePurposeType;
      }
      // Transaction ID
      if (params.transactionId) {
        filters['profile.transactionId'] = params.transactionId;
      }
    }
    // Create Aggregation
    const aggregation = [];
    // Filters
    if (filters) {
      aggregation.push({
        $match: filters
      });
    }
    if (params.withChargingStation || params.withSiteArea || !Utils.isEmptyArray(params.siteIDs)) {
      // Charging Stations
      DatabaseUtils.pushChargingStationLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'chargingStationID', foreignField: '_id',
        asField: 'chargingStation', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
      // Site Areas
      if (params.withSiteArea || !Utils.isEmptyArray(params.siteIDs)) {
        DatabaseUtils.pushSiteAreaLookupInAggregation({
          tenantID: tenant.id, aggregation, localField: 'chargingStation.siteAreaID', foreignField: '_id',
          asField: 'chargingStation.siteArea', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
        });
        // Convert
        DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteArea.siteID');
      }
      // Convert
      DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteAreaID');
      // TODO: Optimization: add the Site ID to the Charging Profile
      // Site ID
      if (!Utils.isEmptyArray(params.siteIDs)) {
        // Build filter
        aggregation.push({
          $match: {
            'chargingStation.siteArea.siteID': {
              $in: params.siteIDs
            }
          }
        });
      }
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const chargingProfilesCountMDB = await global.database.getCollection<DataResult<ChargingProfile>>(tenant.id, 'chargingprofiles')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getChargingProfiles', uniqueTimerID, chargingProfilesCountMDB);
      return {
        count: (chargingProfilesCountMDB.length > 0 ? chargingProfilesCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Rename ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = {
        'chargingStationID': 1,
        'connectorID': 1,
        'profile.chargingProfilePurpose': 1,
        'profile.stackLevel': 1,
      };
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
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const chargingProfilesMDB = await global.database.getCollection<ChargingProfile>(tenant.id, 'chargingprofiles')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getChargingProfiles', uniqueTimerID, chargingProfilesMDB);
    return {
      count: (chargingProfilesCountMDB.length > 0 ?
        (chargingProfilesCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : chargingProfilesCountMDB[0].count) : 0),
      result: chargingProfilesMDB
    };
  }

  public static async saveChargingProfile(tenant: Tenant, chargingProfileToSave: ChargingProfile): Promise<string> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveChargingProfile');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    const chargingProfileFilter: any = {};
    // Build Request
    if (chargingProfileToSave.id) {
      chargingProfileFilter._id = chargingProfileToSave.id;
    } else {
      chargingProfileFilter._id =
        Cypher.hash(`${chargingProfileToSave.chargingStationID}~${chargingProfileToSave.connectorID}~${chargingProfileToSave.profile.chargingProfileId}`);
    }
    // Properties to save
    const chargingProfileMDB: any = {
      _id: chargingProfileFilter._id,
      chargingStationID: chargingProfileToSave.chargingStationID,
      connectorID: Utils.convertToInt(chargingProfileToSave.connectorID),
      chargePointID: Utils.convertToInt(chargingProfileToSave.chargePointID),
      profile: chargingProfileToSave.profile
    };
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles').findOneAndUpdate(
      chargingProfileFilter,
      { $set: chargingProfileMDB },
      { upsert: true });
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveChargingProfile', uniqueTimerID, chargingProfileMDB);
    return chargingProfileFilter._id as string;
  }

  public static async deleteChargingProfile(tenant: Tenant, id: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteChargingProfile');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete Charging Profile
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles')
      .findOneAndDelete({ '_id': id });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteChargingProfile', uniqueTimerID, { id });
  }

  public static async deleteChargingProfiles(tenant: Tenant, chargingStationID: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteChargingProfile');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete Charging Profiles
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles')
      .findOneAndDelete({ 'chargingStationID': chargingStationID });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteChargingProfile', uniqueTimerID, { chargingStationID });
  }

  public static getChargingStationFirmware(filename: string): GridFSBucketReadStream {
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'getChargingStationFirmware');
    // Get the bucket
    const bucket: GridFSBucket = global.database.getGridFSBucket('default.firmwares');
    // Get the file
    const firmware = bucket.openDownloadStreamByName(filename);
    void Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'getChargingStationFirmware', uniqueTimerID, firmware);
    return firmware;
  }

  public static putChargingStationFirmware(filename: string): GridFSBucketWriteStream {
    const uniqueTimerID = Logging.traceStart(Constants.DEFAULT_TENANT, MODULE_NAME, 'putChargingStationFirmware');
    // Get the bucket
    const bucket: GridFSBucket = global.database.getGridFSBucket('default.firmwares');
    // Put the file
    const firmware = bucket.openUploadStream(filename);
    void Logging.traceEnd(Constants.DEFAULT_TENANT, MODULE_NAME, 'putChargingStationFirmware', uniqueTimerID, firmware);
    return firmware;
  }

  private static getChargerInErrorFacet(errorType: string) {
    switch (errorType) {
      case ChargingStationInErrorType.MISSING_SETTINGS:
        return [{
          $match: {
            $or: [
              { 'maximumPower': { $exists: false } }, { 'maximumPower': { $lte: 0 } }, { 'maximumPower': null },
              { 'chargePointModel': { $exists: false } }, { 'chargePointModel': { $eq: '' } },
              { 'chargePointVendor': { $exists: false } }, { 'chargePointVendor': { $eq: '' } },
              { 'powerLimitUnit': { $exists: false } }, { 'powerLimitUnit': null },
              { 'powerLimitUnit': { $nin: [ChargingRateUnitType.AMPERE, ChargingRateUnitType.WATT] } },
              { 'chargingStationURL': { $exists: false } }, { 'chargingStationURL': null }, { 'chargingStationURL': { $eq: '' } },
              { 'connectors.type': { $exists: false } }, { 'connectors.type': null }, { 'connectors.type': { $eq: '' } },
              { 'connectors.type': { $nin: [ConnectorType.CHADEMO, ConnectorType.COMBO_CCS, ConnectorType.DOMESTIC, ConnectorType.TYPE_1, ConnectorType.TYPE_1_CCS, ConnectorType.TYPE_2, ConnectorType.TYPE_3C] } },
            ]
          }
        },
        { $addFields: { 'errorCode': ChargingStationInErrorType.MISSING_SETTINGS } }
        ];
      case ChargingStationInErrorType.CONNECTION_BROKEN: {
        const inactiveDate = new Date(new Date().getTime() - Configuration.getChargingStationConfig().maxLastSeenIntervalSecs * 1000);
        return [
          { $match: { 'lastSeen': { $lte: inactiveDate } } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.CONNECTION_BROKEN } }
        ];
      }
      case ChargingStationInErrorType.CONNECTOR_ERROR:
        return [
          { $match: { $or: [{ 'connectors.errorCode': { $ne: 'NoError' } }, { 'connectors.status': { $eq: ChargePointStatus.FAULTED } }] } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.CONNECTOR_ERROR } }
        ];
      case ChargingStationInErrorType.MISSING_SITE_AREA:
        return [
          { $match: { $or: [{ 'siteAreaID': { $exists: false } }, { 'siteAreaID': null }] } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.MISSING_SITE_AREA } }
        ];
      default:
        return [];
    }
  }

  private static filterConnectorMDB(connector: Connector): ConnectorMDB {
    if (connector) {
      const filteredConnector: ConnectorMDB = {
        id: connector.id,
        connectorId: Utils.convertToInt(connector.connectorId),
        currentInstantWatts: Utils.convertToFloat(connector.currentInstantWatts),
        currentStateOfCharge: connector.currentStateOfCharge,
        currentTotalInactivitySecs: Utils.convertToInt(connector.currentTotalInactivitySecs),
        currentTotalConsumptionWh: Utils.convertToFloat(connector.currentTotalConsumptionWh),
        currentTransactionDate: Utils.convertToDate(connector.currentTransactionDate),
        currentTagID: connector.currentTagID,
        currentTransactionID: Utils.convertToInt(connector.currentTransactionID),
        currentUserID: DatabaseUtils.convertToObjectID(connector.currentUserID),
        status: connector.status,
        errorCode: connector.errorCode,
        info: connector.info,
        vendorErrorCode: connector.vendorErrorCode,
        power: Utils.convertToInt(connector.power),
        type: connector.type,
        voltage: Utils.convertToInt(connector.voltage),
        amperage: Utils.convertToInt(connector.amperage),
        amperageLimit: Utils.convertToInt(connector.amperageLimit),
        statusLastChangedOn: Utils.convertToDate(connector.statusLastChangedOn),
        currentInactivityStatus: connector.currentInactivityStatus,
        numberOfConnectedPhase: connector.numberOfConnectedPhase,
        currentType: connector.currentType,
        chargePointID: connector.chargePointID,
        phaseAssignmentToGrid: connector.phaseAssignmentToGrid &&
          {
            csPhaseL1: connector.phaseAssignmentToGrid.csPhaseL1,
            csPhaseL2: connector.phaseAssignmentToGrid.csPhaseL2,
            csPhaseL3: connector.phaseAssignmentToGrid.csPhaseL3,
          },
      };
      return filteredConnector;
    }
    return null;
  }

  private static filterChargePointMDB(chargePoint: ChargePoint): ChargePoint {
    if (chargePoint) {
      return {
        chargePointID: Utils.convertToInt(chargePoint.chargePointID),
        currentType: chargePoint.currentType,
        voltage: chargePoint.voltage ? Utils.convertToInt(chargePoint.voltage) : null,
        amperage: chargePoint.amperage ? Utils.convertToInt(chargePoint.amperage) : null,
        numberOfConnectedPhase: chargePoint.numberOfConnectedPhase ? Utils.convertToInt(chargePoint.numberOfConnectedPhase) : null,
        cannotChargeInParallel: Utils.convertToBoolean(chargePoint.cannotChargeInParallel),
        sharePowerToAllConnectors: Utils.convertToBoolean(chargePoint.sharePowerToAllConnectors),
        excludeFromPowerLimitation: Utils.convertToBoolean(chargePoint.excludeFromPowerLimitation),
        ocppParamForPowerLimitation: chargePoint.ocppParamForPowerLimitation,
        power: chargePoint.power ? Utils.convertToInt(chargePoint.power) : null,
        efficiency: chargePoint.efficiency ? Utils.convertToInt(chargePoint.efficiency) : null,
        connectorIDs: chargePoint.connectorIDs.map((connectorID) => Utils.convertToInt(connectorID)),
      };
    }
    return null;
  }
}
