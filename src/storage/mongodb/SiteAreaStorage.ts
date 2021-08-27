import global, { FilterParams, Image } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import SiteArea from '../../types/SiteArea';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'SiteAreaStorage';

export default class SiteAreaStorage {
  public static async addAssetsToSiteArea(tenant: Tenant, siteArea: SiteArea, assetIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'addAssetsToSiteArea');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site Area provided?
    if (siteArea) {
      // At least one Asset
      if (assetIDs && assetIDs.length > 0) {
        // Update all assets
        await global.database.getCollection<any>(tenant.id, 'assets').updateMany(
          { '_id': { $in: assetIDs.map((assetID) => DatabaseUtils.convertToObjectID(assetID)) } },
          {
            $set: {
              siteAreaID: DatabaseUtils.convertToObjectID(siteArea.id),
              siteID: DatabaseUtils.convertToObjectID(siteArea.siteID)
            }
          });
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'addAssetsToSiteArea', uniqueTimerID, assetIDs);
  }

  public static async removeAssetsFromSiteArea(tenant: Tenant, siteAreaID: string, assetIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'removeAssetsFromSiteArea');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site Area provided?
    if (siteAreaID) {
      // At least one Asset
      if (assetIDs && assetIDs.length > 0) {
        // Update all assets
        await global.database.getCollection<any>(tenant.id, 'assets').updateMany(
          { '_id': { $in: assetIDs.map((assetID) => DatabaseUtils.convertToObjectID(assetID)) } },
          {
            $set: {
              siteAreaID: null,
              siteID: null
            }
          });
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'removeAssetsFromSiteArea', uniqueTimerID, assetIDs);
  }

  public static async getSiteAreaImage(tenant: Tenant, id: string): Promise<Image> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getSiteAreaImage');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Read DB
    const siteAreaImageMDB = await global.database.getCollection<{ _id: ObjectId; image: string }>(tenant.id, 'siteareaimages')
      .findOne({ _id: DatabaseUtils.convertToObjectID(id) });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSiteAreaImage', uniqueTimerID, siteAreaImageMDB);
    return {
      id: id, image: siteAreaImageMDB ? siteAreaImageMDB.image : null
    };
  }

  public static async getSiteArea(tenant: Tenant, id: string = Constants.UNKNOWN_OBJECT_ID,
      params: { withSite?: boolean; withChargingStations?: boolean, withAvailableChargingStations?: boolean; withImage?: boolean } = {},
      projectFields?: string[]): Promise<SiteArea> {
    const siteAreasMDB = await SiteAreaStorage.getSiteAreas(tenant, {
      siteAreaIDs: [id],
      withSite: params.withSite,
      withChargingStations: params.withChargingStations,
      withAvailableChargingStations: params.withAvailableChargingStations,
      withImage: params.withImage,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return siteAreasMDB.count === 1 ? siteAreasMDB.result[0] : null;
  }

  public static async saveSiteArea(tenant: Tenant, siteAreaToSave: SiteArea, saveImage = false): Promise<string> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveSiteArea');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Set
    const siteAreaMDB: any = {
      _id: !siteAreaToSave.id ? new ObjectId() : DatabaseUtils.convertToObjectID(siteAreaToSave.id),
      name: siteAreaToSave.name,
      issuer: siteAreaToSave.issuer,
      accessControl: Utils.convertToBoolean(siteAreaToSave.accessControl),
      smartCharging: Utils.convertToBoolean(siteAreaToSave.smartCharging),
      siteID: DatabaseUtils.convertToObjectID(siteAreaToSave.siteID),
      maximumPower: Utils.convertToFloat(siteAreaToSave.maximumPower),
      voltage: Utils.convertToInt(siteAreaToSave.voltage),
      numberOfPhases: Utils.convertToInt(siteAreaToSave.numberOfPhases),
    };
    if (siteAreaToSave.address) {
      siteAreaMDB.address = {
        address1: siteAreaToSave.address.address1,
        address2: siteAreaToSave.address.address2,
        postalCode: siteAreaToSave.address.postalCode,
        city: siteAreaToSave.address.city,
        department: siteAreaToSave.address.department,
        region: siteAreaToSave.address.region,
        country: siteAreaToSave.address.country,
        coordinates: Utils.containsGPSCoordinates(siteAreaToSave.address.coordinates) ? siteAreaToSave.address.coordinates.map(
          (coordinate) => Utils.convertToFloat(coordinate)) : [],
      };
    }
    // Add Last Changed/Created props
    DatabaseUtils.addLastChangedCreatedProps(siteAreaMDB, siteAreaToSave);
    // Modify
    await global.database.getCollection<SiteArea>(tenant.id, 'siteareas').findOneAndUpdate(
      { _id: siteAreaMDB._id },
      { $set: siteAreaMDB },
      { upsert: true, returnDocument: 'after' }
    );
    if (saveImage) {
      await SiteAreaStorage.saveSiteAreaImage(tenant, siteAreaMDB._id.toString(), siteAreaToSave.image);
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveSiteArea', uniqueTimerID, siteAreaMDB);
    return siteAreaMDB._id.toString();
  }

  public static async getSiteAreas(tenant: Tenant,
      params: {
        siteAreaIDs?: string[]; search?: string; siteIDs?: string[]; companyIDs?: string[]; withSite?: boolean; issuer?: boolean; name?: string;
        withChargingStations?: boolean; withOnlyChargingStations?: boolean; withAvailableChargingStations?: boolean;
        locCoordinates?: number[]; locMaxDistanceMeters?: number; smartCharging?: boolean; withImage?: boolean;
      } = {},
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<SiteArea>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getSiteAreas');
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
    // Otherwise check if search is present
    if (params.search) {
      filters.$or = [
        { 'name': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Site Area
    if (!Utils.isEmptyArray(params.siteAreaIDs)) {
      filters._id = {
        $in: params.siteAreaIDs.map((siteAreaID) => DatabaseUtils.convertToObjectID(siteAreaID))
      };
    }
    // Site
    if (!Utils.isEmptyArray(params.siteIDs)) {
      filters.siteID = {
        $in: params.siteIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
      };
    }
    // Company
    if (!Utils.isEmptyArray(params.companyIDs)) {
      DatabaseUtils.pushSiteLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'siteID', foreignField: '_id',
        asField: 'site', oneToOneCardinality: true
      });
      filters['site.companyID'] = {
        $in: params.companyIDs.map((companyID) => companyID)
      };
      params.withSite = false;
    }
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    if (Utils.objectHasProperty(params, 'smartCharging') && Utils.isBoolean(params.smartCharging)) {
      filters.smartCharging = params.smartCharging;
    }
    if (params.name) {
      filters.name = params.name;
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
    const siteAreasCountMDB = await global.database.getCollection<DataResult<SiteArea>>(tenant.id, 'siteareas')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSiteAreas', uniqueTimerID, siteAreasCountMDB);
      return {
        count: (siteAreasCountMDB.length > 0 ? siteAreasCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Add Sort
    if (!dbParams.sort) {
      dbParams.sort = { name: 1 };
    }
    // Position coordinates
    if (Utils.containsGPSCoordinates(params.locCoordinates)) {
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
    // Sites
    if (params.withSite) {
      DatabaseUtils.pushSiteLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'siteID', foreignField: '_id',
        asField: 'site', oneToOneCardinality: true
      });
    }
    // Charging Stations
    if (params.withChargingStations || params.withOnlyChargingStations || params.withAvailableChargingStations) {
      DatabaseUtils.pushChargingStationLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: '_id', foreignField: 'siteAreaID',
        asField: 'chargingStations'
      });
    }
    // Site Area Image
    if (params.withImage) {
      aggregation.push({
        $addFields: {
          image: {
            $concat: [
              `${Utils.buildRestServerURL()}/client/util/SiteAreaImage?ID=`,
              { $toString: '$_id' },
              `&TenantID=${tenant.id}&LastChangedOn=`,
              { $toString: '$lastChangedOn' }
            ]
          }
        }
      });
    }
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    // Add Last Changed / Created
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Project
    if (projectFields) {
      DatabaseUtils.projectFields(aggregation,
        [...projectFields, 'chargingStations.id', 'chargingStations.connectors', 'chargingStations.lastSeen',
          'chargingStations.deleted', 'chargingStations.cannotChargeInParallel', 'chargingStations.public', 'chargingStations.inactive']);
    }
    // Read DB
    const siteAreasMDB = await global.database.getCollection<SiteArea>(tenant.id, 'siteareas')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    const siteAreas: SiteArea[] = [];
    // TODO: Handle this coding into the MongoDB request
    if (siteAreasMDB && siteAreasMDB.length > 0) {
      // Create
      for (const siteAreaMDB of siteAreasMDB) {
        if (siteAreaMDB.issuer) {
          // Skip site area with no charging stations if asked
          if (params.withOnlyChargingStations && Utils.isEmptyArray(siteAreaMDB.chargingStations)) {
            continue;
          }
          // Add counts of Available/Occupied Chargers/Connectors
          if (params.withAvailableChargingStations) {
            // Set the Charging Stations' Connector statuses
            siteAreaMDB.connectorStats = Utils.getConnectorStatusesFromChargingStations(siteAreaMDB.chargingStations);
          }
          // Charging stations
          if (!params.withChargingStations && siteAreaMDB.chargingStations) {
            delete siteAreaMDB.chargingStations;
          }
        }
        // Add
        siteAreas.push(siteAreaMDB);
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSiteAreas', uniqueTimerID, siteAreasMDB);
    // Ok
    return {
      projectedFields: projectFields,
      count: (siteAreasCountMDB.length > 0 ?
        (siteAreasCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : siteAreasCountMDB[0].count) : 0),
      result: siteAreas
    };
  }

  public static async addChargingStationsToSiteArea(tenant: Tenant, siteArea: SiteArea, chargingStationIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'addChargingStationsToSiteArea');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site provided?
    if (siteArea) {
      // At least one ChargingStation
      if (chargingStationIDs && chargingStationIDs.length > 0) {
        // Update all chargers
        await global.database.getCollection<any>(tenant.id, 'chargingstations').updateMany(
          { '_id': { $in: chargingStationIDs } },
          {
            $set: {
              companyID: DatabaseUtils.convertToObjectID(siteArea.site?.companyID),
              siteID: DatabaseUtils.convertToObjectID(siteArea.siteID),
              siteAreaID: DatabaseUtils.convertToObjectID(siteArea.id),
            }
          });
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'addChargingStationsToSiteArea', uniqueTimerID, chargingStationIDs);
  }

  public static async removeChargingStationsFromSiteArea(tenant: Tenant, siteAreaID: string, chargingStationIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'removeChargingStationsFromSiteArea');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site provided?
    if (siteAreaID) {
      // At least one ChargingStation
      if (chargingStationIDs && chargingStationIDs.length > 0) {
        // Update all chargers
        await global.database.getCollection<any>(tenant.id, 'chargingstations').updateMany(
          { '_id': { $in: chargingStationIDs } },
          {
            $set: {
              companyID: null,
              siteID: null,
              siteAreaID: null,
            }
          });
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'removeChargingStationsFromSiteArea', uniqueTimerID, chargingStationIDs);
  }

  public static async deleteSiteArea(tenant: Tenant, id: string): Promise<void> {
    await SiteAreaStorage.deleteSiteAreas(tenant, [id]);
  }

  public static async deleteSiteAreas(tenant: Tenant, siteAreaIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteSiteAreas');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Remove Charging Station's Site Area
    await global.database.getCollection<any>(tenant.id, 'chargingstations').updateMany(
      { siteAreaID: { $in: siteAreaIDs.map((ID) => DatabaseUtils.convertToObjectID(ID)) } },
      { $set: { siteAreaID: null } }
    );
    // Remove Asset's Site Area
    await global.database.getCollection<any>(tenant.id, 'assets').updateMany(
      { siteAreaID: { $in: siteAreaIDs.map((ID) => DatabaseUtils.convertToObjectID(ID)) } },
      { $set: { siteAreaID: null } }
    );
    // Delete SiteArea
    await global.database.getCollection<any>(tenant.id, 'siteareas').deleteMany(
      { '_id': { $in: siteAreaIDs.map((ID) => DatabaseUtils.convertToObjectID(ID)) } }
    );
    // Delete Image
    await global.database.getCollection<any>(tenant.id, 'sitesareaimages').deleteMany(
      { '_id': { $in: siteAreaIDs.map((ID) => DatabaseUtils.convertToObjectID(ID)) } }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteSiteAreas', uniqueTimerID, siteAreaIDs);
  }

  public static async deleteSiteAreasFromSites(tenant: Tenant, siteIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteSiteAreasFromSites');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Find site areas to delete
    const siteareas: string[] = (await global.database.getCollection<any>(tenant.id, 'siteareas')
      .find({ siteID: { $in: siteIDs.map((id) => DatabaseUtils.convertToObjectID(id)) } })
      .project({ _id: 1 }).toArray()).map((idWrapper): string => idWrapper._id.toString());
    // Delete site areas
    await SiteAreaStorage.deleteSiteAreas(tenant, siteareas);
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteSiteAreasFromSites', uniqueTimerID, siteIDs);
  }

  private static async saveSiteAreaImage(tenant: Tenant, siteAreaID: string, siteAreaImageToSave: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveSiteAreaImage');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify
    await global.database.getCollection<any>(tenant.id, 'siteareaimages').findOneAndUpdate(
      { '_id': DatabaseUtils.convertToObjectID(siteAreaID) },
      { $set: { image: siteAreaImageToSave } },
      { upsert: true, returnDocument: 'after' }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveSiteAreaImage', uniqueTimerID, siteAreaImageToSave);
  }
}
