import Site, { SiteUser } from '../../types/Site';
import User, { UserSite } from '../../types/User';
import global, { FilterParams, Image } from '../../types/GlobalType';

import ChargingStationStorage from './ChargingStationStorage';
import Constants from '../../utils/Constants';
import Cypher from '../../utils/Cypher';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import SiteAreaStorage from './SiteAreaStorage';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'SiteStorage';

export default class SiteStorage {
  public static async getSite(tenant: Tenant, id: string = Constants.UNKNOWN_OBJECT_ID,
      params: { withCompany?: boolean, withImage?: boolean; } = {}, projectFields?: string[]): Promise<Site> {
    const sitesMDB = await SiteStorage.getSites(tenant, {
      siteIDs: [id],
      withCompany: params.withCompany,
      withImage: params.withImage,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return sitesMDB.count === 1 ? sitesMDB.result[0] : null;
  }

  public static async getSiteImage(tenant: Tenant, id: string): Promise<Image> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getSiteImage');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Read DB
    const siteImageMDB = await global.database.getCollection<{ _id: ObjectId; image: string }>(tenant.id, 'siteimages')
      .findOne({ _id: DatabaseUtils.convertToObjectID(id) });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSiteImage', uniqueTimerID, siteImageMDB);
    return {
      id: id,
      image: siteImageMDB ? siteImageMDB.image : null
    };
  }

  public static async removeUsersFromSite(tenant: Tenant, siteID: string, userIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'removeUsersFromSite');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site provided?
    if (siteID) {
      // At least one User
      if (userIDs && userIDs.length > 0) {
        // Execute
        await global.database.getCollection<any>(tenant.id, 'siteusers').deleteMany({
          'userID': { $in: userIDs.map((userID) => DatabaseUtils.convertToObjectID(userID)) },
          'siteID': DatabaseUtils.convertToObjectID(siteID)
        });
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'removeUsersFromSite', uniqueTimerID, userIDs);
  }

  public static async addUsersToSite(tenant: Tenant, siteID: string, userIDs: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'addUsersToSite');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Site provided?
    if (siteID) {
      // At least one User
      if (userIDs && userIDs.length > 0) {
        const siteUsers = [];
        // Create the list
        for (const userID of userIDs) {
          // Add
          siteUsers.push({
            '_id': Cypher.hash(`${siteID}~${userID}`),
            'userID': DatabaseUtils.convertToObjectID(userID),
            'siteID': DatabaseUtils.convertToObjectID(siteID),
            'siteAdmin': false
          });
        }
        // Execute
        await global.database.getCollection<any>(tenant.id, 'siteusers').insertMany(siteUsers);
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'addUsersToSite', uniqueTimerID, userIDs);
  }

  public static async getSiteUsers(tenant: Tenant,
      params: { search?: string; siteIDs: string[]; siteOwnerOnly?: boolean },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<UserSite>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getSitesUsers');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Create Aggregation
    const aggregation: any[] = [];
    // Filter
    if (!Utils.isEmptyArray(params.siteIDs)) {
      aggregation.push({
        $match: {
          siteID: {
            $in: params.siteIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
          }
        }
      });
    }
    if (params.siteOwnerOnly) {
      aggregation.push({
        $match: {
          siteOwner: true
        }
      });
    }
    // Users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID: tenant.id, aggregation, localField: 'userID', foreignField: '_id',
      asField: 'user', oneToOneCardinality: true, oneToOneCardinalityNotNull: true
    });
    // Filter deleted users
    aggregation.push({
      $match: {
        'user.deleted': { $ne: true }
      }
    });
    // Another match for searching on Users
    if (params.search) {
      aggregation.push({
        $match: {
          $or: [
            { 'user.name': { $regex: params.search, $options: 'i' } },
            { 'user.firstName': { $regex: params.search, $options: 'i' } },
            { 'user.email': { $regex: params.search, $options: 'i' } }
          ]
        }
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const usersCountMDB = await global.database.getCollection<DataResult<SiteUser>>(tenant.id, 'siteusers')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSitesUsers', uniqueTimerID, usersCountMDB);
      return {
        count: (usersCountMDB.length > 0 ? usersCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { 'user.name': 1, 'user.firstName': 1 };
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
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert IDs to String
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const siteUsersMDB = await global.database.getCollection<{ user: User; siteID: string; siteAdmin: boolean; siteOwner: boolean }>(tenant.id, 'siteusers')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSitesUsers', uniqueTimerID, siteUsersMDB);
    return {
      count: (usersCountMDB.length > 0 ?
        (usersCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : usersCountMDB[0].count) : 0),
      result: siteUsersMDB
    };
  }

  public static async updateSiteOwner(tenant: Tenant, siteID: string, userID: string, siteOwner: boolean): Promise<void> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'updateSiteOwner');
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'siteusers').updateMany(
      {
        siteID: DatabaseUtils.convertToObjectID(siteID),
        siteOwner: true
      },
      {
        $set: { siteOwner: false }
      });
    await global.database.getCollection<any>(tenant.id, 'siteusers').updateOne(
      {
        siteID: DatabaseUtils.convertToObjectID(siteID),
        userID: DatabaseUtils.convertToObjectID(userID)
      },
      {
        $set: { siteOwner: siteOwner }
      });
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'updateSiteOwner', uniqueTimerID, { siteID, userID });
  }

  public static async updateSiteUserAdmin(tenant: Tenant, siteID: string, userID: string, siteAdmin: boolean): Promise<void> {
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'updateSiteUserAdmin');
    DatabaseUtils.checkTenantObject(tenant);

    await global.database.getCollection<any>(tenant.id, 'siteusers').updateOne(
      {
        siteID: DatabaseUtils.convertToObjectID(siteID),
        userID: DatabaseUtils.convertToObjectID(userID)
      },
      {
        $set: { siteAdmin }
      });
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'updateSiteUserAdmin', uniqueTimerID, { siteID, userID, siteAdmin });
  }

  public static async saveSite(tenant: Tenant, siteToSave: Site, saveImage = true): Promise<string> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveSite');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    const siteFilter: any = {};
    // Build Request
    if (siteToSave.id) {
      siteFilter._id = DatabaseUtils.convertToObjectID(siteToSave.id);
    } else {
      siteFilter._id = new ObjectId();
    }
    // Properties to save
    const siteMDB: any = {
      _id: siteFilter._id,
      issuer: Utils.convertToBoolean(siteToSave.issuer),
      public: Utils.convertToBoolean(siteToSave.public),
      companyID: DatabaseUtils.convertToObjectID(siteToSave.companyID),
      autoUserSiteAssignment: Utils.convertToBoolean(siteToSave.autoUserSiteAssignment),
      name: siteToSave.name,
    };
    if (siteToSave.address) {
      siteMDB.address = {
        address1: siteToSave.address.address1,
        address2: siteToSave.address.address2,
        postalCode: siteToSave.address.postalCode,
        city: siteToSave.address.city,
        department: siteToSave.address.department,
        region: siteToSave.address.region,
        country: siteToSave.address.country,
        coordinates: Utils.containsGPSCoordinates(siteToSave.address.coordinates) ? siteToSave.address.coordinates.map(
          (coordinate) => Utils.convertToFloat(coordinate)) : [],
      };
    }
    // Add Last Changed/Created props
    DatabaseUtils.addLastChangedCreatedProps(siteMDB, siteToSave);
    // Modify and return the modified document
    await global.database.getCollection<any>(tenant.id, 'sites').findOneAndUpdate(
      siteFilter,
      { $set: siteMDB },
      { upsert: true }
    );
    if (saveImage) {
      await SiteStorage.saveSiteImage(tenant, siteFilter._id.toString(), siteToSave.image);
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveSite', uniqueTimerID, siteMDB);
    return siteFilter._id.toString();
  }

  public static async saveSiteImage(tenant: Tenant, siteID: string, siteImageToSave: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveSiteImage');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Modify
    await global.database.getCollection(tenant.id, 'siteimages').findOneAndUpdate(
      { _id: DatabaseUtils.convertToObjectID(siteID) },
      { $set: { image: siteImageToSave } },
      { upsert: true, returnDocument: 'after' }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveSiteImage', uniqueTimerID, siteImageToSave);
  }

  public static async getSites(tenant: Tenant,
      params: {
        search?: string; companyIDs?: string[]; withAutoUserAssignment?: boolean; siteIDs?: string[];
        userID?: string; excludeSitesOfUserID?: boolean; issuer?: boolean; public?: boolean; name?: string;
        withAvailableChargingStations?: boolean; withOnlyChargingStations?: boolean; withCompany?: boolean;
        locCoordinates?: number[]; locMaxDistanceMeters?: number; withImage?: boolean;
      } = {},
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<Site>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getSites');
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
    // Search filters
    const filters: FilterParams = {};
    if (params.search) {
      filters.$or = [
        { 'name': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Site Name
    if (params.name) {
      filters.name = params.name;
    }
    // Site
    if (!Utils.isEmptyArray(params.siteIDs)) {
      filters._id = {
        $in: params.siteIDs.map((siteID) => DatabaseUtils.convertToObjectID(siteID))
      };
    }
    // Company
    if (!Utils.isEmptyArray(params.companyIDs)) {
      filters.companyID = {
        $in: params.companyIDs.map((company) => DatabaseUtils.convertToObjectID(company))
      };
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    // Public Site
    if (params.public) {
      filters.public = params.public;
    }
    // Auto User Site Assignment
    if (params.withAutoUserAssignment) {
      filters.autoUserSiteAssignment = true;
    }
    // Get users
    if (params.userID || params.excludeSitesOfUserID) {
      DatabaseUtils.pushCollectionLookupInAggregation('siteusers',
        { tenantID: tenant.id, aggregation, localField: '_id', foreignField: 'siteID', asField: 'siteusers' }
      );
      if (params.userID) {
        filters['siteusers.userID'] = DatabaseUtils.convertToObjectID(params.userID);
      }
      if (params.excludeSitesOfUserID) {
        filters['siteusers.userID'] = { $ne: DatabaseUtils.convertToObjectID(params.excludeSitesOfUserID) };
      }
    }
    // Set filters
    aggregation.push({
      $match: filters
    });
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const sitesCountMDB = await global.database.getCollection<any>(tenant.id, 'sites')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSites', uniqueTimerID, sitesCountMDB);
      return {
        count: (sitesCountMDB.length > 0 ? sitesCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
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
    // Add Company
    if (params.withCompany) {
      DatabaseUtils.pushCompanyLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'companyID', foreignField: '_id',
        asField: 'company', oneToOneCardinality: true
      });
    }
    // Site Image
    if (params.withImage) {
      aggregation.push({
        $addFields: {
          image: {
            $concat: [
              `${Utils.buildRestServerURL()}/client/util/SiteImage?ID=`,
              { $toString: '$_id' },
              `&TenantID=${tenant.id}&LastChangedOn=`,
              { $toString: '$lastChangedOn' }
            ]
          }
        }
      });
    }
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'companyID');
    // Add Last Changed / Created
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const sitesMDB = await global.database.getCollection<Site>(tenant.id, 'sites')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    const sites = [];
    // TODO: Handle this coding into the MongoDB request
    if (sitesMDB && sitesMDB.length > 0) {
      // Create
      for (const siteMDB of sitesMDB) {
        if (params.withOnlyChargingStations || params.withAvailableChargingStations) {
        // Get the chargers
          const chargingStations = await ChargingStationStorage.getChargingStations(tenant,
            { siteIDs: [siteMDB.id], includeDeleted: false, withSiteArea: true }, Constants.DB_PARAMS_MAX_LIMIT);
          // Skip site with no charging stations if asked
          if (params.withOnlyChargingStations && chargingStations.count === 0) {
            continue;
          }
          // Add counts of Available/Occupied Chargers/Connectors
          if (params.withAvailableChargingStations) {
          // Set the Charging Stations' Connector statuses
            siteMDB.connectorStats = Utils.getConnectorStatusesFromChargingStations(chargingStations.result);
          }
        }
        if (!siteMDB.autoUserSiteAssignment) {
          siteMDB.autoUserSiteAssignment = false;
        }
        // Add
        sites.push(siteMDB);
      }
    }
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getSites', uniqueTimerID, sites);
    return {
      projectedFields: projectFields,
      count: (sitesCountMDB.length > 0 ?
        (sitesCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : sitesCountMDB[0].count) : 0),
      result: sites
    };
  }

  public static async deleteSite(tenant: Tenant, id: string): Promise<void> {
    await SiteStorage.deleteSites(tenant, [id]);
  }

  public static async deleteSites(tenant: Tenant, ids: string[]): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteSites');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete all Site Areas
    await SiteAreaStorage.deleteSiteAreasFromSites(tenant, ids);
    // Convert
    const cids: ObjectId[] = ids.map((id) => DatabaseUtils.convertToObjectID(id));
    // Delete Site
    await global.database.getCollection<any>(tenant.id, 'sites')
      .deleteMany({ '_id': { $in: cids } });
    // Delete Image
    await global.database.getCollection<any>(tenant.id, 'siteimages')
      .deleteMany({ '_id': { $in: cids } });
    // Delete Site's Users
    await global.database.getCollection<any>(tenant.id, 'siteusers')
      .deleteMany({ 'siteID': { $in: cids } });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteSites', uniqueTimerID, { ids });
  }

  public static async deleteCompanySites(tenant: Tenant, companyID: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteCompanySites');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Get Sites of Company
    const siteIDs: string[] = (await global.database.getCollection<{ _id: ObjectId }>(tenant.id, 'sites')
      .find({ companyID: DatabaseUtils.convertToObjectID(companyID) })
      .project({ _id: 1 })
      .toArray())
      .map((site): string => site._id.toString());
    // Delete all Site Areas
    await SiteAreaStorage.deleteSiteAreasFromSites(tenant, siteIDs);
    // Delete Sites
    await SiteStorage.deleteSites(tenant, siteIDs);
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteCompanySites', uniqueTimerID, { companyID });
  }

  public static async siteHasUser(tenant: Tenant, siteID: string, userID: string): Promise<boolean> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'siteHasUser');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Exec
    const result = await global.database.getCollection<any>(tenant.id, 'siteusers').findOne(
      { siteID: DatabaseUtils.convertToObjectID(siteID), userID: DatabaseUtils.convertToObjectID(userID) });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteCompanySites', uniqueTimerID, { siteID });
    // Check
    if (!result) {
      return false;
    }
    return true;
  }
}
