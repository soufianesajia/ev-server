import { BillingAdditionalData, BillingInvoice, BillingInvoiceStatus, BillingSessionData } from '../../types/Billing';
import global, { FilterParams } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'BillingStorage';

export default class BillingStorage {
  public static async getInvoice(tenant: Tenant, id: string = Constants.UNKNOWN_OBJECT_ID, projectFields?: string[]): Promise<BillingInvoice> {
    const invoicesMDB = await BillingStorage.getInvoices(tenant, {
      invoiceIDs: [id]
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return invoicesMDB.count === 1 ? invoicesMDB.result[0] : null;
  }

  public static async getInvoiceByInvoiceID(tenant: Tenant, id: string): Promise<BillingInvoice> {
    const invoicesMDB = await BillingStorage.getInvoices(tenant, {
      billingInvoiceID: id
    }, Constants.DB_PARAMS_SINGLE_RECORD);
    return invoicesMDB.count === 1 ? invoicesMDB.result[0] : null;
  }

  public static async getInvoices(tenant: Tenant,
      params: {
        invoiceIDs?: string[]; billingInvoiceID?: string; search?: string; userIDs?: string[]; invoiceStatus?: BillingInvoiceStatus[];
        startDateTime?: Date; endDateTime?: Date; liveMode?: boolean
      } = {},
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<BillingInvoice>> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'getInvoices');
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
    // Search filters
    const filters: FilterParams = {};
    // Search
    // Filter by other properties
    if (params.search) {
      filters.$or = [
        { 'number': { $regex: params.search, $options: 'i' } }
      ];
    }
    if (!Utils.isEmptyArray(params.invoiceIDs)) {
      filters._id = {
        $in: params.invoiceIDs.map((invoiceID) => DatabaseUtils.convertToObjectID(invoiceID))
      };
    }
    if (!Utils.isEmptyArray(params.userIDs)) {
      filters.userID = {
        $in: params.userIDs.map((userID) => DatabaseUtils.convertToObjectID(userID))
      };
    }
    if (params.billingInvoiceID) {
      filters.invoiceID = { $eq: params.billingInvoiceID };
    }
    // liveMode (to clear test data)
    if (params.liveMode) {
      filters.liveMode = { $eq: params.liveMode };
    }
    // Status
    if (!Utils.isEmptyArray(params.invoiceStatus)) {
      filters.status = {
        $in: params.invoiceStatus
      };
    }
    if (params.startDateTime || params.endDateTime) {
      filters.createdOn = {};
    }
    // Start date
    if (params.startDateTime) {
      filters.createdOn.$gte = Utils.convertToDate(params.startDateTime);
    }
    // End date
    if (params.endDateTime) {
      filters.createdOn.$lte = Utils.convertToDate(params.endDateTime);
    }
    // Set filters
    if (!Utils.isEmptyJSon(filters)) {
      aggregation.push({
        $match: filters
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const invoicesCountMDB = await global.database.getCollection<any>(tenant.id, 'invoices')
      .aggregate([...aggregation, { $count: 'count' }], { allowDiskUse: true })
      .toArray();
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      await Logging.traceEnd(tenant.id, MODULE_NAME, 'getInvoices', uniqueTimerID, invoicesCountMDB);
      return {
        count: (invoicesCountMDB.length > 0 ? invoicesCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
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
    // Add Users
    DatabaseUtils.pushUserLookupInAggregation({
      tenantID: tenant.id, aggregation: aggregation, asField: 'user', localField: 'userID',
      foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    // Add Last Changed / Created
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const invoicesMDB = await global.database.getCollection<BillingInvoice>(tenant.id, 'invoices')
      .aggregate(aggregation, {
        allowDiskUse: true
      })
      .toArray();
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'getInvoices', uniqueTimerID, invoicesMDB);
    return {
      count: (invoicesCountMDB.length > 0 ?
        (invoicesCountMDB[0].count === Constants.DB_RECORD_COUNT_CEIL ? -1 : invoicesCountMDB[0].count) : 0),
      result: invoicesMDB
    };
  }

  public static async saveInvoice(tenant: Tenant, invoiceToSave: BillingInvoice): Promise<string> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveInvoice');
    // Build Request
    // Properties to save
    const invoiceMDB: any = {
      _id: invoiceToSave.id ? DatabaseUtils.convertToObjectID(invoiceToSave.id) : new ObjectId(),
      invoiceID: invoiceToSave.invoiceID,
      // eslint-disable-next-line id-blacklist
      number: invoiceToSave.number,
      liveMode: Utils.convertToBoolean(invoiceToSave.liveMode),
      userID: invoiceToSave.userID ? DatabaseUtils.convertToObjectID(invoiceToSave.userID) : null,
      customerID: invoiceToSave.customerID,
      amount: Utils.convertToFloat(invoiceToSave.amount),
      amountPaid: Utils.convertToFloat(invoiceToSave.amountPaid),
      status: invoiceToSave.status,
      currency: invoiceToSave.currency,
      createdOn: Utils.convertToDate(invoiceToSave.createdOn),
      downloadable: Utils.convertToBoolean(invoiceToSave.downloadable),
      downloadUrl: invoiceToSave.downloadUrl,
      payInvoiceUrl: invoiceToSave.payInvoiceUrl
    };
    // Modify and return the modified document
    await global.database.getCollection<BillingInvoice>(tenant.id, 'invoices').findOneAndUpdate(
      { _id: invoiceMDB._id },
      { $set: invoiceMDB },
      { upsert: true, returnDocument: 'after' }
    );
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveInvoice', uniqueTimerID, invoiceMDB);
    return invoiceMDB._id.toString();
  }

  public static async updateInvoiceAdditionalData(tenant: Tenant, invoiceToUpdate: BillingInvoice, additionalData: BillingAdditionalData): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'saveInvoiceAdditionalData');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Preserve the previous list of sessions
    const sessions: BillingSessionData[] = invoiceToUpdate.sessions || [];
    if (additionalData.session) {
      sessions.push(additionalData.session);
    }
    // Set data
    const updatedInvoiceMDB: any = {
      sessions,
      lastError: additionalData.lastError
    };
    await global.database.getCollection(tenant.id, 'invoices').findOneAndUpdate(
      { '_id': DatabaseUtils.convertToObjectID(invoiceToUpdate.id) },
      { $set: updatedInvoiceMDB });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'saveInvoiceAdditionalData', uniqueTimerID, updatedInvoiceMDB);
  }

  public static async deleteInvoice(tenant: Tenant, id: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteInvoice');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete the Invoice
    await global.database.getCollection<BillingInvoice>(tenant.id, 'invoices')
      .findOneAndDelete({ '_id': DatabaseUtils.convertToObjectID(id) });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteInvoice', uniqueTimerID, { id });
  }

  public static async deleteInvoiceByInvoiceID(tenant: Tenant, id: string): Promise<void> {
    // Debug
    const uniqueTimerID = Logging.traceStart(tenant.id, MODULE_NAME, 'deleteInvoice');
    // Check Tenant
    DatabaseUtils.checkTenantObject(tenant);
    // Delete the Invoice
    await global.database.getCollection<BillingInvoice>(tenant.id, 'invoices')
      .findOneAndDelete({ 'invoiceID': id });
    // Debug
    await Logging.traceEnd(tenant.id, MODULE_NAME, 'deleteInvoice', uniqueTimerID, { id });
  }
}
