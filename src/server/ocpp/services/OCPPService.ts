import { ChargePointErrorCode, ChargePointStatus, OCPPAttribute, OCPPAuthorizationStatus, OCPPAuthorizeRequestExtended, OCPPAuthorizeResponse, OCPPBootNotificationRequestExtended, OCPPBootNotificationResponse, OCPPDataTransferRequestExtended, OCPPDataTransferResponse, OCPPDataTransferStatus, OCPPDiagnosticsStatusNotificationRequestExtended, OCPPDiagnosticsStatusNotificationResponse, OCPPFirmwareStatusNotificationRequestExtended, OCPPFirmwareStatusNotificationResponse, OCPPHeartbeatRequestExtended, OCPPHeartbeatResponse, OCPPLocation, OCPPMeasurand, OCPPMeterValue, OCPPMeterValuesRequest, OCPPMeterValuesRequestExtended, OCPPMeterValuesResponse, OCPPNormalizedMeterValue, OCPPNormalizedMeterValues, OCPPPhase, OCPPProtocol, OCPPReadingContext, OCPPSampledValue, OCPPStartTransactionRequestExtended, OCPPStartTransactionResponse, OCPPStatusNotificationRequestExtended, OCPPStatusNotificationResponse, OCPPStopTransactionRequestExtended, OCPPStopTransactionResponse, OCPPUnitOfMeasure, OCPPValueFormat, OCPPVersion, RegistrationStatus } from '../../../types/ocpp/OCPPServer';
import { ChargingProfilePurposeType, ChargingRateUnitType } from '../../../types/ChargingProfile';
import ChargingStation, { ChargerVendor, Connector, ConnectorCurrentLimitSource, ConnectorType, CurrentType, StaticLimitAmps, TemplateUpdateResult } from '../../../types/ChargingStation';
import { OCPPChangeConfigurationCommandResult, OCPPConfigurationStatus, OCPPRemoteStartStopStatus } from '../../../types/ocpp/OCPPClient';
import Transaction, { InactivityStatus, TransactionAction } from '../../../types/Transaction';

import { Action } from '../../../types/Authorization';
import Authorizations from '../../../authorization/Authorizations';
import BackendError from '../../../exception/BackendError';
import CarStorage from '../../../storage/mongodb/CarStorage';
import ChargingStationClientFactory from '../../../client/ocpp/ChargingStationClientFactory';
import ChargingStationConfiguration from '../../../types/configuration/ChargingStationConfiguration';
import ChargingStationStorage from '../../../storage/mongodb/ChargingStationStorage';
import Configuration from '../../../utils/Configuration';
import Constants from '../../../utils/Constants';
import ConsumptionStorage from '../../../storage/mongodb/ConsumptionStorage';
import CpoOCPIClient from '../../../client/ocpi/CpoOCPIClient';
import CpoOICPClient from '../../../client/oicp/CpoOICPClient';
import I18nManager from '../../../utils/I18nManager';
import LockingHelper from '../../../locking/LockingHelper';
import LockingManager from '../../../locking/LockingManager';
import Logging from '../../../utils/Logging';
import NotificationHandler from '../../../notification/NotificationHandler';
import OCPIClientFactory from '../../../client/ocpi/OCPIClientFactory';
import { OCPIRole } from '../../../types/ocpi/OCPIRole';
import { OCPPHeader } from '../../../types/ocpp/OCPPHeader';
import OCPPStorage from '../../../storage/mongodb/OCPPStorage';
import OCPPUtils from '../utils/OCPPUtils';
import OCPPValidation from '../validation/OCPPValidation';
import OICPClientFactory from '../../../client/oicp/OICPClientFactory';
import { OICPRole } from '../../../types/oicp/OICPRole';
import { ServerAction } from '../../../types/Server';
import SiteAreaStorage from '../../../storage/mongodb/SiteAreaStorage';
import SmartChargingFactory from '../../../integration/smart-charging/SmartChargingFactory';
import Tag from '../../../types/Tag';
import Tenant from '../../../types/Tenant';
import TenantComponents from '../../../types/TenantComponents';
import TenantStorage from '../../../storage/mongodb/TenantStorage';
import TransactionStorage from '../../../storage/mongodb/TransactionStorage';
import User from '../../../types/User';
import UserStorage from '../../../storage/mongodb/UserStorage';
import Utils from '../../../utils/Utils';
import moment from 'moment';
import momentDurationFormatSetup from 'moment-duration-format';

momentDurationFormatSetup(moment as any);

const MODULE_NAME = 'OCPPService';

export default class OCPPService {
  private chargingStationConfig: ChargingStationConfiguration;

  public constructor(chargingStationConfig: ChargingStationConfiguration) {
    this.chargingStationConfig = chargingStationConfig;
  }

  public async handleBootNotification(headers: OCPPHeader, bootNotification: OCPPBootNotificationRequestExtended): Promise<OCPPBootNotificationResponse> {
    try {
      // Check
      OCPPValidation.getInstance().validateBootNotification(bootNotification);
      // Enrich Boot Notification
      this.enrichBootNotification(headers, bootNotification);
      // Get heartbeat interval
      const heartbeatIntervalSecs = this.getHeartbeatInterval(headers.ocppProtocol);
      // Check Charging Station
      if (!headers.chargeBoxIdentity) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          action: ServerAction.BOOT_NOTIFICATION,
          module: MODULE_NAME, method: 'handleBootNotification',
          message: 'Should have the required property \'chargeBoxIdentity\'!',
          detailedMessages: { headers, bootNotification }
        });
      }
      // Check Tenant
      const tenant = await TenantStorage.getTenant(headers.tenantID);
      if (!tenant) {
        throw new BackendError({
          source: Constants.CENTRAL_SERVER,
          module: MODULE_NAME, method: 'handleBootNotification',
          message: `Tenant ID '${headers.tenantID}' does not exist!`
        });
      }
      // Get Charging Station
      let chargingStation = await ChargingStationStorage.getChargingStation(tenant, headers.chargeBoxIdentity, { issuer: true });
      if (!chargingStation) {
        // Create Charging Station
        chargingStation = await this.checkAndCreateChargingStation(tenant, bootNotification, headers);
      } else {
        // Check Charging Station
        await this.checkExistingChargingStation(headers, chargingStation, bootNotification);
      }
      // Enrich Charging Station
      this.enrichChargingStation(chargingStation, headers, bootNotification);
      // Clear Firmware Status
      if (chargingStation.firmwareUpdateStatus) {
        await ChargingStationStorage.saveChargingStationFirmwareStatus(tenant, chargingStation.id, null);
      }
      // Apply Charging Station Template
      const templateUpdateResult = await this.applyChargingStationTemplate(tenant, chargingStation);
      // Save Charging Station
      await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
      // Save Boot Notification
      await OCPPStorage.saveBootNotification(tenant, bootNotification);
      // Send Notification (Async)
      this.notifyBootNotification(tenant, chargingStation);
      // Request OCPP configuration
      this.requestOCPPConfigurationDelayed(tenant, chargingStation, templateUpdateResult, heartbeatIntervalSecs);
      // Log
      await Logging.logInfo({
        tenant,
        source: chargingStation.id,
        action: ServerAction.BOOT_NOTIFICATION,
        module: MODULE_NAME, method: 'handleBootNotification',
        message: 'Boot Notification has been accepted',
        detailedMessages: { headers, bootNotification }
      });
      // Accept
      return {
        currentTime: bootNotification.timestamp.toISOString(),
        status: RegistrationStatus.ACCEPTED,
        interval: heartbeatIntervalSecs
      };
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.BOOT_NOTIFICATION, error, { bootNotification });
      // Reject
      return {
        status: RegistrationStatus.REJECTED,
        currentTime: bootNotification.timestamp ? bootNotification.timestamp.toISOString() : new Date().toISOString(),
        interval: Constants.BOOT_NOTIFICATION_WAIT_TIME
      };
    }
  }

  public async handleHeartbeat(headers: OCPPHeader, heartbeat: OCPPHeartbeatRequestExtended): Promise<OCPPHeartbeatResponse> {
    try {
      // Get Charging Station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check
        OCPPValidation.getInstance().validateHeartbeat(heartbeat);
        // Replace IPs
        chargingStation.currentIPAddress = headers.currentIPAddress;
        // Set lastSeen
        chargingStation.lastSeen = new Date();
        // Set Heart Beat Object
        heartbeat = {
          chargeBoxID: chargingStation.id,
          timestamp: new Date(),
          timezone: Utils.getTimezone(chargingStation.coordinates)
        };
        // Save Charging Station lastSeen date
        await ChargingStationStorage.saveChargingStationLastSeen(tenant, chargingStation.id, {
          lastSeen: chargingStation.lastSeen,
          currentIPAddress: chargingStation.currentIPAddress,
        });
        // Save Heart Beat
        await OCPPStorage.saveHeartbeat(tenant, heartbeat);
        // Log
        await Logging.logDebug({
          tenant: tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleHeartbeat',
          action: ServerAction.HEARTBEAT,
          message: `Heartbeat saved with IP '${chargingStation.currentIPAddress.toString()}'`,
          detailedMessages: { headers, heartbeat }
        });
        return {
          currentTime: chargingStation.lastSeen.toISOString()
        };
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.HEARTBEAT, error, { heartbeat });
      return {
        currentTime: new Date().toISOString()
      };
    }
  }

  public async handleStatusNotification(headers: OCPPHeader, statusNotification: OCPPStatusNotificationRequestExtended): Promise<OCPPStatusNotificationResponse> {
    try {
      // Get charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateStatusNotification(statusNotification);
        // Set Header
        this.enrichOCPPRequest(chargingStation, statusNotification, false);
        // Skip connectorId = 0 case
        if (statusNotification.connectorId <= 0) {
          await Logging.logInfo({
            tenant,
            source: chargingStation.id,
            action: ServerAction.STATUS_NOTIFICATION,
            module: MODULE_NAME, method: 'handleStatusNotification',
            message: `Connector ID '0' > ${this.buildStatusNotification(statusNotification)}, will be ignored (Connector ID = '0')`,
            detailedMessages: { headers, statusNotification }
          });
          return {};
        }
        // Update only the given Connector ID
        await this.processConnectorStatusNotification(tenant, chargingStation, statusNotification);
        return {};
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.STATUS_NOTIFICATION, error, { statusNotification });
      return {};
    }
  }

  public async handleMeterValues(headers: OCPPHeader, meterValues: OCPPMeterValuesRequestExtended): Promise<OCPPMeterValuesResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check
        await OCPPValidation.getInstance().validateMeterValues(tenant.id, chargingStation, meterValues);
        // Normalize Meter Values
        const normalizedMeterValues = this.normalizeMeterValues(chargingStation, meterValues);
        // Handle Charging Station's specificities
        this.filterMeterValuesOnSpecificChargingStations(tenant, chargingStation, normalizedMeterValues);
        if (Utils.isEmptyArray(normalizedMeterValues.values)) {
          await Logging.logDebug({
            tenant: tenant,
            source: chargingStation.id,
            module: MODULE_NAME, method: 'handleMeterValues',
            action: ServerAction.METER_VALUES,
            message: 'No relevant Meter Values to save',
            detailedMessages: { headers, meterValues }
          });
          return {};
        }
        // Get Transaction
        const transaction = await this.getTransactionFromMeterValues(tenant, chargingStation, headers, meterValues);
        // Save Meter Values
        await OCPPStorage.saveMeterValues(tenant, normalizedMeterValues);
        // Update Transaction
        this.updateTransactionWithMeterValues(chargingStation, transaction, normalizedMeterValues.values);
        // Create Consumptions
        const consumptions = await OCPPUtils.createConsumptionsFromMeterValues(tenant, chargingStation, transaction, normalizedMeterValues.values);
        // Price/Bill Transaction and Save them
        for (const consumption of consumptions) {
          // Update Transaction with Consumption
          OCPPUtils.updateTransactionWithConsumption(chargingStation, transaction, consumption);
          if (consumption.toPrice) {
            // Pricing
            await OCPPUtils.processTransactionPricing(tenant, transaction, chargingStation, consumption, TransactionAction.UPDATE);
            // Billing
            await OCPPUtils.processTransactionBilling(tenant, transaction, TransactionAction.UPDATE);
          }
          // Save
          await ConsumptionStorage.saveConsumption(tenant, consumption);
        }
        // Get the phases really used from Meter Values (for AC single phase charger/car)
        if (!transaction.phasesUsed &&
            Utils.checkIfPhasesProvidedInTransactionInProgress(transaction) &&
            transaction.numberOfMeterValues >= 1) {
          transaction.phasesUsed = Utils.getUsedPhasesInTransactionInProgress(chargingStation, transaction);
        }
        // Roaming
        await OCPPUtils.processTransactionRoaming(tenant, transaction, chargingStation, transaction.tag, TransactionAction.UPDATE);
        // Save Transaction
        await TransactionStorage.saveTransaction(tenant, transaction);
        // Update Charging Station
        await this.updateChargingStationWithTransaction(tenant, chargingStation, transaction);
        // Handle End Of charge
        await this.checkNotificationEndOfCharge(tenant, chargingStation, transaction);
        // Save Charging Station
        await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
        // First Meter Value -> Trigger Smart Charging to adjust the limit
        if (transaction.numberOfMeterValues === 1 && transaction.phasesUsed) {
          // Yes: Trigger Smart Charging
          await this.triggerSmartCharging(tenant, chargingStation);
        }
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          action: ServerAction.METER_VALUES,
          user: transaction.userID,
          module: MODULE_NAME, method: 'handleMeterValues',
          message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)}  MeterValue have been saved`,
          detailedMessages: { headers, normalizedMeterValues }
        });
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.METER_VALUES, error, { meterValues });
    }
    return {};
  }

  public async handleAuthorize(headers: OCPPHeader, authorize: OCPPAuthorizeRequestExtended): Promise<OCPPAuthorizeResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateAuthorize(authorize);
        // Check
        const { user } = await Authorizations.isAuthorizedOnChargingStation(tenant, chargingStation,
          authorize.idTag, ServerAction.AUTHORIZE, Action.AUTHORIZE);
        // Check Billing Prerequisites
        await OCPPUtils.checkBillingPrerequisites(tenant, ServerAction.AUTHORIZE, chargingStation, user);
        // Enrich
        this.enrichAuthorize(user, chargingStation, headers, authorize);
        // Save
        await OCPPStorage.saveAuthorize(tenant, authorize);
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleAuthorize',
          action: ServerAction.AUTHORIZE, user: (authorize.user ? authorize.user : null),
          message: `User has been authorized with Badge ID '${authorize.idTag}'`,
          detailedMessages: { headers, authorize }
        });
        // Accepted
        return {
          idTagInfo: {
            status: OCPPAuthorizationStatus.ACCEPTED
          }
        };
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.AUTHORIZE, error, { authorize });
      // Rejected
      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID
        }
      };
    }
  }

  public async handleDiagnosticsStatusNotification(headers: OCPPHeader,
      diagnosticsStatusNotification: OCPPDiagnosticsStatusNotificationRequestExtended): Promise<OCPPDiagnosticsStatusNotificationResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateDiagnosticsStatusNotification(chargingStation, diagnosticsStatusNotification);
        // Enrich
        this.enrichOCPPRequest(chargingStation, diagnosticsStatusNotification);
        // Save it
        await OCPPStorage.saveDiagnosticsStatusNotification(tenant, diagnosticsStatusNotification);
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          action: ServerAction.DIAGNOSTICS_STATUS_NOTIFICATION,
          module: MODULE_NAME, method: 'handleDiagnosticsStatusNotification',
          message: 'Diagnostics Status Notification has been saved',
          detailedMessages: { headers, diagnosticsStatusNotification }
        });
        return {};
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.DIAGNOSTICS_STATUS_NOTIFICATION, error, { diagnosticsStatusNotification });
      return {};
    }
  }

  public async handleFirmwareStatusNotification(headers: OCPPHeader,
      firmwareStatusNotification: OCPPFirmwareStatusNotificationRequestExtended): Promise<OCPPFirmwareStatusNotificationResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateFirmwareStatusNotification(chargingStation, firmwareStatusNotification);
        // Enrich
        this.enrichOCPPRequest(chargingStation, firmwareStatusNotification);
        // Save the status to Charging Station
        await ChargingStationStorage.saveChargingStationFirmwareStatus(tenant, chargingStation.id, firmwareStatusNotification.status);
        // Save it
        await OCPPStorage.saveFirmwareStatusNotification(tenant, firmwareStatusNotification);
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleFirmwareStatusNotification',
          action: ServerAction.FIRMWARE_STATUS_NOTIFICATION,
          message: `Firmware Status Notification '${firmwareStatusNotification.status}' has been saved`,
          detailedMessages: { headers, firmwareStatusNotification }
        });
        return {};
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.FIRMWARE_STATUS_NOTIFICATION, error, { firmwareStatusNotification });
      return {};
    }
  }

  public async handleStartTransaction(headers: OCPPHeader, startTransaction: OCPPStartTransactionRequestExtended): Promise<OCPPStartTransactionResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateStartTransaction(chargingStation, startTransaction);
        // Enrich
        this.enrichStartTransaction(tenant, startTransaction, chargingStation);
        // Create Transaction
        const newTransaction = await this.createTransaction(tenant, startTransaction);
        // Check User
        const { user, tag } = await Authorizations.isAuthorizedToStartTransaction(
          tenant, chargingStation, startTransaction.tagID, newTransaction, ServerAction.START_TRANSACTION, Action.START_TRANSACTION);
        if (user) {
          startTransaction.userID = user.id;
          newTransaction.userID = user.id;
          newTransaction.user = user;
          newTransaction.authorizationID = user.authorizationID;
        }
        // Cleanup ongoing Transaction
        await this.stopOrDeleteActiveTransaction(tenant, chargingStation, startTransaction.connectorId);
        // Car
        await this.processCarTransaction(tenant, newTransaction, user);
        // Pricing
        await OCPPUtils.processTransactionPricing(tenant, newTransaction, chargingStation, null, TransactionAction.START);
        // Billing
        await OCPPUtils.processTransactionBilling(tenant, newTransaction, TransactionAction.START);
        // Roaming
        await OCPPUtils.processTransactionRoaming(tenant, newTransaction, chargingStation, tag, TransactionAction.START);
        // Save it
        await TransactionStorage.saveTransaction(tenant, newTransaction);
        // Clean up
        await this.updateChargingStationConnectorWithTransaction(tenant, newTransaction, chargingStation, user);
        // Save
        await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
        // Notify
        this.notifyStartTransaction(tenant, newTransaction, chargingStation, user);
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleStartTransaction',
          action: ServerAction.START_TRANSACTION, user: user,
          message: `${Utils.buildConnectorInfo(newTransaction.connectorId, newTransaction.id)} Transaction has been started successfully`,
          detailedMessages: { transaction: newTransaction, startTransaction }
        });
        // Accepted
        return {
          transactionId: newTransaction.id,
          idTagInfo: {
            status: OCPPAuthorizationStatus.ACCEPTED
          }
        };
      } catch (error) {
        // Cleanup ongoing Transaction
        await this.stopOrDeleteActiveTransaction(tenant, chargingStation, startTransaction.connectorId);
        // Save
        await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
        throw error;
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.START_TRANSACTION, error, { startTransaction });
      // Invalid
      return {
        transactionId: 0,
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID
        }
      };
    }
  }

  public async handleDataTransfer(headers: OCPPHeader, dataTransfer: OCPPDataTransferRequestExtended): Promise<OCPPDataTransferResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateDataTransfer(chargingStation, dataTransfer);
        // Enrich
        this.enrichOCPPRequest(chargingStation, dataTransfer);
        // Save it
        await OCPPStorage.saveDataTransfer(tenant, dataTransfer);
        // Log
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleDataTransfer',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER, message: 'Data Transfer has been saved',
          detailedMessages: { headers, dataTransfer }
        });
        // Accepted
        return {
          status: OCPPDataTransferStatus.ACCEPTED
        };
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.CHARGING_STATION_DATA_TRANSFER, error, { dataTransfer });
      // Rejected
      return {
        status: OCPPDataTransferStatus.REJECTED
      };
    }
  }

  public async handleStopTransaction(headers: OCPPHeader, stopTransaction: OCPPStopTransactionRequestExtended,
      isSoftStop = false, isStoppedByCentralSystem = false): Promise<OCPPStopTransactionResponse> {
    try {
      // Get the charging station
      const { chargingStation, tenant, chargingStationLock } = await OCPPUtils.checkAndGetTenantAndChargingStation(headers);
      try {
        // Check props
        OCPPValidation.getInstance().validateStopTransaction(chargingStation, stopTransaction);
        // Set header
        this.enrichOCPPRequest(chargingStation, stopTransaction, false);
        // Bypass Stop Transaction?
        if (await this.bypassStopTransaction(tenant, chargingStation, headers, stopTransaction)) {
          return {
            idTagInfo: {
              status: OCPPAuthorizationStatus.ACCEPTED
            }
          };
        }
        // Get Transaction
        const transaction = await this.getTransactionFromStopTransaction(tenant, chargingStation, headers, stopTransaction);
        // Get Tag ID that stopped the Transaction
        const tagID = this.getStopTransactionTagId(stopTransaction, transaction);
        // Transaction is stopped by central system?
        const { user, alternateUser } = await this.checkAuthorizeStopTransactionAndGetUsers(
          tenant, chargingStation, transaction, tagID, isStoppedByCentralSystem);
        // Free the connector
        OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, transaction.connectorId);
        // Save Charging Station
        await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
        // Soft Stop
        this.checkSoftStopTransaction(transaction, stopTransaction, isSoftStop);
        // Transaction End has already been received?
        await this.checkAndApplyLastConsumptionInStopTransaction(tenant, chargingStation, transaction, stopTransaction);
        // Signed Data
        this.checkAndUpdateTransactionWithSignedDataInStopTransaction(transaction, stopTransaction);
        // Update Transaction with Stop Transaction and Stop MeterValues
        OCPPUtils.updateTransactionWithStopTransaction(transaction, chargingStation, stopTransaction, user, alternateUser, tagID);
        // Bill
        await OCPPUtils.processTransactionBilling(tenant, transaction, TransactionAction.STOP);
        // Roaming
        await OCPPUtils.processTransactionRoaming(tenant, transaction, chargingStation, transaction.tag, TransactionAction.STOP);
        // Save the transaction
        await TransactionStorage.saveTransaction(tenant, transaction);
        // Notify User
        this.notifyStopTransaction(tenant, chargingStation, transaction, user, alternateUser);
        // Recompute the Smart Charging Plan
        await this.triggerSmartChargingStopTransaction(tenant, chargingStation, transaction);
        await Logging.logInfo({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'handleStopTransaction',
          action: ServerAction.STOP_TRANSACTION,
          user: alternateUser ?? (user ?? null),
          actionOnUser: alternateUser ? (user ?? null) : null,
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction has been stopped successfully`,
          detailedMessages: { headers, stopTransaction }
        });
        // Accepted
        return {
          idTagInfo: {
            status: OCPPAuthorizationStatus.ACCEPTED
          }
        };
      } finally {
        // Release lock
        await LockingManager.release(chargingStationLock);
      }
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.STOP_TRANSACTION, error, { stopTransaction });
      // Invalid
      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID
        }
      };
    }
  }

  private checkAndUpdateTransactionWithSignedDataInStopTransaction(transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended) {
    // Handle Signed Data in Stop Transaction
    if (!Utils.isEmptyArray(stopTransaction.transactionData)) {
      for (const meterValue of stopTransaction.transactionData as OCPPMeterValue[]) {
        for (const sampledValue of meterValue.sampledValue) {
          if (sampledValue.format === OCPPValueFormat.SIGNED_DATA) {
            // Set Signed data in Start of Transaction
            if (sampledValue.context === OCPPReadingContext.TRANSACTION_BEGIN) {
              transaction.signedData = sampledValue.value;
            }
            if (sampledValue.context === OCPPReadingContext.TRANSACTION_END) {
              transaction.currentSignedData = sampledValue.value;
            }
          }
        }
      }
    }
  }

  private async checkAuthorizeStopTransactionAndGetUsers(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction,
      tagId: string, isStoppedByCentralSystem: boolean): Promise<{ user: User; alternateUser: User; }> {
    let user: User;
    let alternateUser: User;
    if (!isStoppedByCentralSystem) {
      // Check and get the authorized Users
      const authorizedUsers = await Authorizations.isAuthorizedToStopTransaction(
        tenant, chargingStation, transaction, tagId, ServerAction.STOP_TRANSACTION, Action.STOP_TRANSACTION);
      user = authorizedUsers.user;
      alternateUser = authorizedUsers.alternateUser;
    } else {
      // Get the User
      user = await UserStorage.getUserByTagId(tenant, tagId);
    }
    // Already Stopped?
    if (transaction.stop) {
      throw new BackendError({
        source: chargingStation.id,
        module: MODULE_NAME, method: 'checkAuthorizeStopTransactionAndGetUsers',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction has already been stopped`,
        action: ServerAction.STOP_TRANSACTION,
        user: (alternateUser ? alternateUser : user),
        actionOnUser: (alternateUser ? user : null),
        detailedMessages: { transaction }
      });
    }
    return { user, alternateUser };
  }

  private async triggerSmartChargingStopTransaction(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    if (Utils.isTenantComponentActive(tenant, TenantComponents.SMART_CHARGING)) {
      // Delete TxProfile if any
      await this.deleteAllTransactionTxProfile(tenant, transaction);
      // Call async because the Transaction ID on the connector should be cleared
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => {
        try {
          // Trigger Smart Charging
          await this.triggerSmartCharging(tenant, chargingStation);
        } catch (error) {
          await Logging.logError({
            tenant,
            source: chargingStation.id,
            module: MODULE_NAME, method: 'triggerSmartChargingStopTransaction',
            action: ServerAction.STOP_TRANSACTION,
            message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Smart Charging exception occurred`,
            detailedMessages: { error: error.stack, transaction, chargingStation }
          });
        }
      }, Constants.DELAY_SMART_CHARGING_EXECUTION_MILLIS);
    }
  }

  private async deleteAllTransactionTxProfile(tenant: Tenant, transaction: Transaction) {
    const chargingProfiles = await ChargingStationStorage.getChargingProfiles(tenant, {
      chargingStationIDs: [transaction.chargeBoxID],
      connectorID: transaction.connectorId,
      profilePurposeType: ChargingProfilePurposeType.TX_PROFILE,
      transactionId: transaction.id
    }, Constants.DB_PARAMS_MAX_LIMIT);
    // Delete all TxProfiles
    for (const chargingProfile of chargingProfiles.result) {
      try {
        await OCPPUtils.clearAndDeleteChargingProfile(tenant, chargingProfile);
        await Logging.logDebug({
          tenant,
          source: transaction.chargeBoxID,
          action: ServerAction.CHARGING_PROFILE_DELETE,
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} TX Charging Profile with ID '${chargingProfile.id}'`,
          module: MODULE_NAME, method: 'deleteAllTransactionTxProfile',
          detailedMessages: { chargingProfile }
        });
      } catch (error) {
        await Logging.logError({
          tenant,
          source: transaction.chargeBoxID,
          action: ServerAction.CHARGING_PROFILE_DELETE,
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Cannot delete TX Charging Profile with ID '${chargingProfile.id}'`,
          module: MODULE_NAME, method: 'deleteAllTransactionTxProfile',
          detailedMessages: { error: error.stack, chargingProfile }
        });
      }
    }
  }

  private async processConnectorStatusNotification(tenant: Tenant, chargingStation: ChargingStation, statusNotification: OCPPStatusNotificationRequestExtended) {
    // Get Connector
    const connector = await this.checkAndGetConnectorFromStatusNotification(tenant, chargingStation, statusNotification);
    // Check last Transaction
    await this.checkAndUpdateLastCompletedTransaction(tenant, chargingStation, statusNotification, connector);
    // Update Connector
    connector.connectorId = statusNotification.connectorId;
    connector.status = statusNotification.status;
    connector.errorCode = statusNotification.errorCode;
    connector.info = statusNotification.info;
    connector.vendorErrorCode = statusNotification.vendorErrorCode;
    connector.statusLastChangedOn = new Date(statusNotification.timestamp);
    // Save Status Notification
    await OCPPStorage.saveStatusNotification(tenant, statusNotification);
    // Process Roaming
    await this.processStatusNotificationRoaming(tenant, chargingStation, connector);
    // Sort connectors
    if (!Utils.isEmptyArray(chargingStation?.connectors)) {
      chargingStation.connectors.sort((connector1: Connector, connector2: Connector) =>
        connector1?.connectorId - connector2?.connectorId);
    }
    // Save Charging Station
    await ChargingStationStorage.saveChargingStationConnectors(tenant, chargingStation.id,
      chargingStation.connectors, chargingStation.backupConnectors);
    await ChargingStationStorage.saveChargingStationLastSeen(tenant, chargingStation.id, { lastSeen: new Date() });
    // Process Smart Charging
    await this.processSmartChargingStatusNotification(tenant, chargingStation, connector);
    // Log
    await Logging.logInfo({
      tenant,
      source: chargingStation.id,
      module: MODULE_NAME, method: 'processConnectorStatusNotification',
      action: ServerAction.STATUS_NOTIFICATION,
      message: `${Utils.buildConnectorInfo(statusNotification.connectorId, connector.currentTransactionID)} ${this.buildStatusNotification(statusNotification)} has been saved`,
      detailedMessages: { statusNotification, connector }
    });
    // Notify Users
    await this.notifyStatusNotification(tenant, chargingStation, connector, statusNotification);
  }

  private async processSmartChargingStatusNotification(tenant: Tenant, chargingStation: ChargingStation, connector: Connector): Promise<void> {
    // Trigger Smart Charging
    if (connector.status === ChargePointStatus.CHARGING ||
        connector.status === ChargePointStatus.SUSPENDED_EV) {
      try {
        // Trigger Smart Charging
        await this.triggerSmartCharging(tenant, chargingStation);
      } catch (error) {
        await Logging.logError({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'processSmartChargingStatusNotification',
          action: ServerAction.STATUS_NOTIFICATION,
          message: `${Utils.buildConnectorInfo(connector.connectorId, connector.currentTransactionID)} Smart Charging exception occurred`,
          detailedMessages: { error: error.stack }
        });
      }
    }
  }

  private async processStatusNotificationRoaming(tenant: Tenant, chargingStation: ChargingStation, foundConnector: Connector): Promise<void> {
    // Send connector status to eRoaming platforms if charging station is public and component is activated
    if (chargingStation.issuer && chargingStation.public) {
      if (Utils.isTenantComponentActive(tenant, TenantComponents.OICP)) {
        // Send new status to Hubject
        await this.updateOICPConnectorStatus(tenant, chargingStation, foundConnector);
      }
      if (Utils.isTenantComponentActive(tenant, TenantComponents.OCPI)) {
        // Send new status to IOP
        await this.updateOCPIConnectorStatus(tenant, chargingStation, foundConnector);
      }
    }
  }

  private async checkAndGetConnectorFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation,
      statusNotification: OCPPStatusNotificationRequestExtended): Promise<Connector> {
    let foundConnector = Utils.getConnectorFromID(chargingStation, statusNotification.connectorId);
    if (!foundConnector) {
      // Check backup first
      foundConnector = Utils.getLastSeenConnectorFromID(chargingStation, statusNotification.connectorId);
      if (foundConnector) {
        // Append the backup connector
        chargingStation.connectors.push(foundConnector);
        chargingStation.backupConnectors = chargingStation.backupConnectors.filter(
          (backupConnector) => backupConnector.connectorId !== foundConnector.connectorId);
      } else {
        // Does not exist: Create
        foundConnector = {
          currentTransactionID: 0,
          currentTransactionDate: null,
          currentTagID: null,
          currentUserID: null,
          connectorId: statusNotification.connectorId,
          currentInstantWatts: 0,
          status: ChargePointStatus.UNAVAILABLE,
          power: 0,
          type: ConnectorType.UNKNOWN
        };
        chargingStation.connectors.push(foundConnector);
        // Enrich Charging Station's Connector
        const chargingStationTemplate = await OCPPUtils.getChargingStationTemplate(chargingStation);
        if (chargingStationTemplate) {
          await OCPPUtils.enrichChargingStationConnectorWithTemplate(
            tenant, chargingStation, statusNotification.connectorId, chargingStationTemplate);
        }
      }
    }
    return foundConnector;
  }

  private async checkAndUpdateLastCompletedTransaction(tenant: Tenant, chargingStation: ChargingStation,
      statusNotification: OCPPStatusNotificationRequestExtended, connector: Connector) {
    // Check last transaction
    if (statusNotification.status === ChargePointStatus.AVAILABLE) {
      // Get the last transaction
      const lastTransaction = await TransactionStorage.getLastTransactionFromChargingStation(
        tenant, chargingStation.id, connector.connectorId);
      // Transaction completed
      if (lastTransaction?.stop) {
        // Check Inactivity
        if (Utils.objectHasProperty(statusNotification, 'timestamp')) {
          // Session is finished
          if (!lastTransaction.stop.extraInactivityComputed) {
            // Init
            lastTransaction.stop.extraInactivitySecs = 0;
            // Calculate Extra Inactivity only between Finishing and Available status notification
            if (connector.status === ChargePointStatus.FINISHING) {
              const transactionStopTimestamp = Utils.convertToDate(lastTransaction.stop.timestamp);
              const currentStatusNotifTimestamp = Utils.convertToDate(statusNotification.timestamp);
              // Diff
              lastTransaction.stop.extraInactivitySecs =
                Math.floor((currentStatusNotifTimestamp.getTime() - transactionStopTimestamp.getTime()) / 1000);
              // Negative inactivity
              if (lastTransaction.stop.extraInactivitySecs < 0) {
                await Logging.logWarning({
                  tenant,
                  source: chargingStation.id,
                  module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransaction',
                  action: ServerAction.STATUS_NOTIFICATION,
                  message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} Extra Inactivity is negative and will be ignored: ${lastTransaction.stop.extraInactivitySecs} secs`,
                  detailedMessages: { statusNotification }
                });
                lastTransaction.stop.extraInactivitySecs = 0;
              } else {
                // Fix the Inactivity severity
                lastTransaction.stop.inactivityStatus = Utils.getInactivityStatusLevel(chargingStation, lastTransaction.connectorId,
                  lastTransaction.stop.totalInactivitySecs + lastTransaction.stop.extraInactivitySecs);
                // Build extra inactivity consumption
                await OCPPUtils.buildExtraConsumptionInactivity(tenant, lastTransaction);
                await Logging.logInfo({
                  tenant,
                  source: chargingStation.id,
                  user: lastTransaction.userID,
                  module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransaction',
                  action: ServerAction.EXTRA_INACTIVITY,
                  message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} Extra Inactivity of ${lastTransaction.stop.extraInactivitySecs} secs has been added`,
                  detailedMessages: { statusNotification, connector, lastTransaction }
                });
              }
            // No extra inactivity
            } else {
              await Logging.logInfo({
                tenant,
                source: chargingStation.id,
                user: lastTransaction.userID,
                module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransaction',
                action: ServerAction.EXTRA_INACTIVITY,
                message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} No Extra Inactivity for this transaction`,
                detailedMessages: { statusNotification, connector, lastTransaction }
              });
            }
            // Flag
            lastTransaction.stop.extraInactivityComputed = true;
          }
        }
        // OCPI: Post the CDR
        if (lastTransaction.ocpiData?.session) {
          await this.checkAndSendOCPITransactionCdr(tenant, lastTransaction, chargingStation, lastTransaction.tag);
        }
        // OICP: Post the CDR
        if (lastTransaction.oicpData?.session) {
          await this.checkAndSendOICPTransactionCdr(tenant, lastTransaction, chargingStation, lastTransaction.tag);
        }
        // Save
        await TransactionStorage.saveTransaction(tenant, lastTransaction);
      } else if (!Utils.isNullOrUndefined(lastTransaction)) {
        await Logging.logWarning({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransaction',
          action: ServerAction.STATUS_NOTIFICATION,
          message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} Received Status Notification '${statusNotification.status}' while a transaction is ongoing`,
          detailedMessages: { statusNotification }
        });
        OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, lastTransaction.connectorId);
      }
    }
  }

  private async checkAndSendOCPITransactionCdr(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, tag: Tag) {
    // CDR not already pushed
    if (transaction.ocpiData && !transaction.ocpiData.cdr?.id) {
      // Get the lock
      const ocpiLock = await LockingHelper.acquireOCPIPushCdrLock(tenant.id, transaction.id);
      if (ocpiLock) {
        try {
          // Roaming
          await OCPPUtils.processTransactionRoaming(tenant, transaction, chargingStation, tag, TransactionAction.END);
        } finally {
          // Release the lock
          await LockingManager.release(ocpiLock);
        }
      }
    }
  }

  private async checkAndSendOICPTransactionCdr(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, tag: Tag) {
    // CDR not already pushed
    if (transaction.oicpData && !transaction.oicpData.cdr?.SessionID) {
      // Get the lock
      const oicpLock = await LockingHelper.acquireOICPPushCdrLock(tenant.id, transaction.id);
      if (oicpLock) {
        try {
          // Roaming
          await OCPPUtils.processTransactionRoaming(tenant, transaction, chargingStation, tag, TransactionAction.END);
        } finally {
          // Release the lock
          await LockingManager.release(oicpLock);
        }
      }
    }
  }

  private async updateOCPIConnectorStatus(tenant: Tenant, chargingStation: ChargingStation, connector: Connector) {
    if (chargingStation.issuer && chargingStation.public && Utils.isTenantComponentActive(tenant, TenantComponents.OCPI)) {
      try {
        const ocpiClient = await OCPIClientFactory.getAvailableOcpiClient(tenant, OCPIRole.CPO) as CpoOCPIClient;
        if (ocpiClient) {
          await ocpiClient.patchChargingStationStatus(chargingStation, connector);
        }
      } catch (error) {
        await Logging.logError({
          tenant,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'updateOCPIConnectorStatus',
          action: ServerAction.OCPI_PATCH_STATUS,
          message: `An error occurred while patching the charging station status of ${chargingStation.id}`,
          detailedMessages: { error: error.stack }
        });
      }
    }
  }

  private async updateOICPConnectorStatus(tenant: Tenant, chargingStation: ChargingStation, connector: Connector) {
    try {
      const oicpClient = await OICPClientFactory.getAvailableOicpClient(tenant, OICPRole.CPO) as CpoOICPClient;
      if (oicpClient) {
        await oicpClient.updateEVSEStatus(chargingStation, connector);
      }
    } catch (error) {
      await Logging.logError({
        tenant,
        source: chargingStation.id,
        module: MODULE_NAME, method: 'updateOICPConnectorStatus',
        action: ServerAction.OICP_UPDATE_EVSE_STATUS,
        message: `An error occurred while updating the charging station status of ${chargingStation.id}`,
        detailedMessages: { error: error.stack }
      });
    }
  }

  private async notifyStatusNotification(tenant: Tenant, chargingStation: ChargingStation, connector: Connector, statusNotification: OCPPStatusNotificationRequestExtended) {
    // Faulted?
    if (connector.status !== ChargePointStatus.AVAILABLE &&
        connector.status !== ChargePointStatus.FINISHING && // TODO: To remove after fix of ABB bug having Finishing status with an Error Code to avoid spamming Admins
        connector.errorCode !== ChargePointErrorCode.NO_ERROR) {
      // Log
      await Logging.logError({
        tenant,
        source: chargingStation.id,
        action: ServerAction.STATUS_NOTIFICATION,
        module: MODULE_NAME, method: 'notifyStatusNotification',
        message: `${Utils.buildConnectorInfo(connector.connectorId)} Error occurred: ${this.buildStatusNotification(statusNotification)}`
      });
      // Send Notification (Async)
      NotificationHandler.sendChargingStationStatusError(
        tenant,
        Utils.generateUUID(),
        chargingStation,
        {
          chargeBoxID: chargingStation.id,
          connectorId: Utils.getConnectorLetterFromConnectorID(connector.connectorId),
          error: this.buildStatusNotification(statusNotification),
          evseDashboardURL: Utils.buildEvseURL(tenant.subdomain),
          evseDashboardChargingStationURL: Utils.buildEvseChargingStationURL(tenant.subdomain, chargingStation, '#inerror')
        }
      ).catch(() => { });
    }
  }

  private updateTransactionWithMeterValues(chargingStation: ChargingStation, transaction: Transaction, meterValues: OCPPNormalizedMeterValue[]) {
    // Build consumptions
    for (const meterValue of meterValues) {
      // To keep backward compatibility with OCPP 1.5 where there is no Transaction.Begin/End,
      // We store the last Transaction.End meter value in transaction to create the last consumption
      // in Stop Transaction
      if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
        // Flag it
        if (!transaction.transactionEndReceived) {
          // First time: clear all values
          transaction.currentInstantWatts = 0;
          transaction.currentInstantWattsL1 = 0;
          transaction.currentInstantWattsL2 = 0;
          transaction.currentInstantWattsL3 = 0;
          transaction.currentInstantWattsDC = 0;
          transaction.currentInstantVolts = 0;
          transaction.currentInstantVoltsL1 = 0;
          transaction.currentInstantVoltsL2 = 0;
          transaction.currentInstantVoltsL3 = 0;
          transaction.currentInstantVoltsDC = 0;
          transaction.currentInstantAmps = 0;
          transaction.currentInstantAmpsL1 = 0;
          transaction.currentInstantAmpsL2 = 0;
          transaction.currentInstantAmpsL3 = 0;
          transaction.currentInstantAmpsDC = 0;
          transaction.transactionEndReceived = true;
        }
      }
      // Signed Data
      if (OCPPUtils.updateSignedData(transaction, meterValue)) {
        continue;
      }
      // SoC
      if (meterValue.attribute.measurand === OCPPMeasurand.STATE_OF_CHARGE) {
        // Set the first SoC and keep it
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_BEGIN) {
          transaction.stateOfCharge = Utils.convertToFloat(meterValue.value);
          continue;
        // Set only the last SoC (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        } else if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          transaction.currentStateOfCharge = Utils.convertToFloat(meterValue.value);
          continue;
        }
      }
      // Voltage
      if (meterValue.attribute.measurand === OCPPMeasurand.VOLTAGE) {
        // Set only the last Voltage (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const voltage = Utils.convertToFloat(meterValue.value);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantVoltsDC = voltage;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1_N:
                case OCPPPhase.L1:
                  transaction.currentInstantVoltsL1 = voltage;
                  break;
                case OCPPPhase.L2_N:
                case OCPPPhase.L2:
                  transaction.currentInstantVoltsL2 = voltage;
                  break;
                case OCPPPhase.L3_N:
                case OCPPPhase.L3:
                  transaction.currentInstantVoltsL3 = voltage;
                  break;
                case OCPPPhase.L1_L2:
                case OCPPPhase.L2_L3:
                case OCPPPhase.L3_L1:
                  // Do nothing
                  break;
                default:
                  transaction.currentInstantVolts = voltage;
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Power
      if (meterValue.attribute.measurand === OCPPMeasurand.POWER_ACTIVE_IMPORT) {
        // Set only the last Power (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const powerInMeterValue = Utils.convertToFloat(meterValue.value);
          const powerInMeterValueWatts = (meterValue.attribute && meterValue.attribute.unit === OCPPUnitOfMeasure.KILO_WATT ?
            powerInMeterValue * 1000 : powerInMeterValue);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantWattsDC = powerInMeterValueWatts;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1_N:
                case OCPPPhase.L1:
                  transaction.currentInstantWattsL1 = powerInMeterValueWatts;
                  break;
                case OCPPPhase.L2_N:
                case OCPPPhase.L2:
                  transaction.currentInstantWattsL2 = powerInMeterValueWatts;
                  break;
                case OCPPPhase.L3_N:
                case OCPPPhase.L3:
                  transaction.currentInstantWattsL3 = powerInMeterValueWatts;
                  break;
                default:
                  transaction.currentInstantWatts = powerInMeterValueWatts;
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Current
      if (meterValue.attribute.measurand === OCPPMeasurand.CURRENT_IMPORT) {
        // Set only the last Current (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const amperage = Utils.convertToFloat(meterValue.value);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantAmpsDC = amperage;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1:
                  transaction.currentInstantAmpsL1 = amperage;
                  break;
                case OCPPPhase.L2:
                  transaction.currentInstantAmpsL2 = amperage;
                  break;
                case OCPPPhase.L3:
                  transaction.currentInstantAmpsL3 = amperage;
                  break;
                default:
                  // MeterValue Current.Import is per phase and consumption currentInstantAmps attribute expect the total amperage
                  transaction.currentInstantAmps = amperage * Utils.getNumberOfConnectedPhases(chargingStation, null, transaction.connectorId);
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Consumption
      if (OCPPUtils.isEnergyActiveImportMeterValue(meterValue)) {
        transaction.numberOfMeterValues++;
      }
    }
  }

  private async updateChargingStationWithTransaction(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    // Get the connector
    const foundConnector: Connector = Utils.getConnectorFromID(chargingStation, transaction.connectorId);
    // Active transaction?
    if (!transaction.stop && foundConnector) {
      // Set consumption
      foundConnector.currentInstantWatts = transaction.currentInstantWatts;
      foundConnector.currentTotalConsumptionWh = transaction.currentTotalConsumptionWh;
      foundConnector.currentTotalInactivitySecs = transaction.currentTotalInactivitySecs;
      foundConnector.currentInactivityStatus = Utils.getInactivityStatusLevel(
        transaction.chargeBox, transaction.connectorId, transaction.currentTotalInactivitySecs);
      foundConnector.currentStateOfCharge = transaction.currentStateOfCharge;
      foundConnector.currentTagID = transaction.tagID;
      // Set Transaction ID
      foundConnector.currentTransactionID = transaction.id;
      foundConnector.currentUserID = transaction.userID;
      // Update lastSeen
      chargingStation.lastSeen = new Date();
      // Log
      const instantPower = Utils.truncTo(Utils.createDecimal(foundConnector.currentInstantWatts).div(1000).toNumber(), 3);
      const totalConsumption = Utils.truncTo(Utils.createDecimal(foundConnector.currentTotalConsumptionWh).div(1000).toNumber(), 3);
      await Logging.logInfo({
        tenant,
        source: chargingStation.id,
        module: MODULE_NAME, method: 'updateChargingStationWithTransaction',
        action: ServerAction.CONSUMPTION,
        user: transaction.userID,
        message: `${Utils.buildConnectorInfo(foundConnector.connectorId, foundConnector.currentTransactionID)} Instant: ${instantPower} kW, Total: ${totalConsumption} kW.h${foundConnector.currentStateOfCharge ? ', SoC: ' + foundConnector.currentStateOfCharge.toString() + ' %' : ''}`
      });
      // Cleanup connector transaction data
    } else if (foundConnector) {
      OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, foundConnector.connectorId);
    }
  }

  private notifyEndOfCharge(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    if (this.chargingStationConfig.notifEndOfChargeEnabled && transaction.user) {
      // Get the i18n lib
      const i18nManager = I18nManager.getInstanceForLocale(transaction.user.locale);
      // Notify (Async)
      NotificationHandler.sendEndOfCharge(
        tenant,
        transaction.id.toString() + '-EOC',
        transaction.user,
        chargingStation,
        {
          user: transaction.user,
          transactionId: transaction.id,
          chargeBoxID: chargingStation.id,
          connectorId: Utils.getConnectorLetterFromConnectorID(transaction.connectorId),
          totalConsumption: i18nManager.formatNumber(Math.round(transaction.currentTotalConsumptionWh / 10) / 100),
          stateOfCharge: transaction.currentStateOfCharge,
          totalDuration: this.transactionDurationToString(transaction),
          evseDashboardChargingStationURL: Utils.buildEvseTransactionURL(tenant.subdomain, transaction.id, '#inprogress'),
          evseDashboardURL: Utils.buildEvseURL(tenant.subdomain)
        }
      ).catch(() => { });
    }
  }

  private notifyOptimalChargeReached(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    if (this.chargingStationConfig.notifBeforeEndOfChargeEnabled && transaction.user) {
      // Get the i18n lib
      const i18nManager = I18nManager.getInstanceForLocale(transaction.user.locale);
      // Notification Before End Of Charge (Async)
      NotificationHandler.sendOptimalChargeReached(
        tenant,
        transaction.id.toString() + '-OCR',
        transaction.user,
        chargingStation,
        {
          user: transaction.user,
          chargeBoxID: chargingStation.id,
          transactionId: transaction.id,
          connectorId: Utils.getConnectorLetterFromConnectorID(transaction.connectorId),
          totalConsumption: i18nManager.formatNumber(Math.round(transaction.currentTotalConsumptionWh / 10) / 100),
          stateOfCharge: transaction.currentStateOfCharge,
          evseDashboardChargingStationURL: Utils.buildEvseTransactionURL(tenant.subdomain, transaction.id, '#inprogress'),
          evseDashboardURL: Utils.buildEvseURL(tenant.subdomain)
        }
      ).catch(() => { });
    }
  }

  private async checkNotificationEndOfCharge(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    // Transaction in progress?
    if (!transaction?.stop && transaction.currentTotalConsumptionWh > 0) {
      // Check the battery
      if (transaction.currentStateOfCharge > 0) {
        // Check if battery is full (100%)
        if (transaction.currentStateOfCharge === 100) {
          // Send Notification
          this.notifyEndOfCharge(tenant, chargingStation, transaction);
        // Check if optimal charge has been reached (85%)
        } else if (transaction.currentStateOfCharge >= this.chargingStationConfig.notifBeforeEndOfChargePercent) {
          // Send Notification
          this.notifyOptimalChargeReached(tenant, chargingStation, transaction);
        }
      // No battery information: check last consumptions
      } else {
        // Connector' status must be 'Suspended'
        const connector = Utils.getConnectorFromID(chargingStation, transaction.connectorId);
        if (connector.status === ChargePointStatus.SUSPENDED_EVSE ||
            connector.status === ChargePointStatus.SUSPENDED_EV) {
          // Check the last 3 consumptions
          const consumptions = await ConsumptionStorage.getTransactionConsumptions(
            tenant, { transactionId: transaction.id }, { limit: 3, skip: 0, sort: { startedAt: -1 } });
          if (consumptions.count === 3) {
            // Check the consumptions
            const noConsumption = consumptions.result.every((consumption) =>
              consumption.consumptionWh === 0 &&
              (consumption.limitSource !== ConnectorCurrentLimitSource.CHARGING_PROFILE ||
               consumption.limitAmps >= StaticLimitAmps.MIN_LIMIT_PER_PHASE * Utils.getNumberOfConnectedPhases(chargingStation, null, transaction.connectorId)));
            // Send Notification
            if (noConsumption) {
              this.notifyEndOfCharge(tenant, chargingStation, transaction);
            }
          }
        }
      }
    }
  }

  private transactionInactivityToString(transaction: Transaction, user: User, i18nHourShort = 'h') {
    const i18nManager = I18nManager.getInstanceForLocale(user ? user.locale : Constants.DEFAULT_LANGUAGE);
    // Get total
    const totalInactivitySecs = transaction.stop.totalInactivitySecs;
    // None?
    if (totalInactivitySecs === 0) {
      return `0${i18nHourShort}00 (${i18nManager.formatPercentage(0)})`;
    }
    // Build the inactivity percentage
    const totalInactivityPercent = i18nManager.formatPercentage(Math.round((totalInactivitySecs / transaction.stop.totalDurationSecs) * 100) / 100);
    return moment.duration(totalInactivitySecs, 's').format(`h[${i18nHourShort}]mm`, { trim: false }) + ` (${totalInactivityPercent})`;
  }

  private transactionDurationToString(transaction: Transaction): string {
    let totalDuration;
    if (!transaction.stop) {
      totalDuration = moment.duration(moment(transaction.lastConsumption.timestamp).diff(moment(transaction.timestamp))).asSeconds();
    } else {
      totalDuration = moment.duration(moment(transaction.stop.timestamp).diff(moment(transaction.timestamp))).asSeconds();
    }
    return moment.duration(totalDuration, 's').format('h[h]mm', { trim: false });
  }

  private buildTransactionDuration(transaction: Transaction): string {
    return moment.duration(transaction.stop.totalDurationSecs, 's').format('h[h]mm', { trim: false });
  }

  private filterMeterValuesOnSpecificChargingStations(tenant: Tenant, chargingStation: ChargingStation, meterValues: OCPPNormalizedMeterValues) {
    // Clean up Sample.Clock meter value
    if (chargingStation.chargePointVendor !== ChargerVendor.ABB ||
      chargingStation.ocppVersion !== OCPPVersion.VERSION_15) {
      // Filter Sample.Clock meter value for all chargers except ABB using OCPP 1.5
      meterValues.values = meterValues.values.filter(async (meterValue) => {
        // Remove Sample Clock
        if (meterValue.attribute && meterValue.attribute.context === OCPPReadingContext.SAMPLE_CLOCK) {
          await Logging.logWarning({
            tenant,
            source: chargingStation.id,
            module: MODULE_NAME, method: 'filterMeterValuesOnSpecificChargingStations',
            action: ServerAction.METER_VALUES,
            message: `Removed Meter Value with attribute context '${OCPPReadingContext.SAMPLE_CLOCK}'`,
            detailedMessages: { meterValue }
          });
          return false;
        }
        return true;
      });
    }
  }

  private normalizeMeterValues(chargingStation: ChargingStation, meterValues: OCPPMeterValuesRequestExtended): OCPPNormalizedMeterValues {
    // Create the normalized meter value
    const normalizedMeterValues: OCPPNormalizedMeterValues = {
      chargeBoxID: chargingStation.id,
      values: []
    };
    // OCPP 1.5: transfer to OCPP 1.6 structure
    if (chargingStation.ocppVersion === OCPPVersion.VERSION_15) {
      meterValues.meterValue = meterValues.values;
      delete meterValues.values;
    }
    // Always convert to an Array
    if (!Array.isArray(meterValues.meterValue)) {
      meterValues.meterValue = [meterValues.meterValue];
    }
    // Process the Meter Values
    for (const meterValue of meterValues.meterValue) {
      const normalizedMeterValue = {
        chargeBoxID: chargingStation.id,
        connectorId: meterValues.connectorId,
        transactionId: meterValues.transactionId,
        timestamp: Utils.convertToDate(meterValue.timestamp),
      } as OCPPNormalizedMeterValue;
      // OCPP 1.6
      if (chargingStation.ocppVersion === OCPPVersion.VERSION_16) {
        // Always an Array
        if (!Array.isArray(meterValue.sampledValue)) {
          meterValue.sampledValue = [meterValue.sampledValue];
        }
        // Create one record per value
        for (const sampledValue of meterValue.sampledValue) {
          // Add Attributes
          const normalizedLocalMeterValue: OCPPNormalizedMeterValue = Utils.cloneObject(normalizedMeterValue);
          normalizedLocalMeterValue.attribute = this.buildMeterValueAttributes(sampledValue);
          // Data is to be interpreted as integer/decimal numeric data
          if (normalizedLocalMeterValue.attribute.format === OCPPValueFormat.RAW) {
            normalizedLocalMeterValue.value = Utils.convertToFloat(sampledValue.value);
            // Data is represented as a signed binary data block, encoded as hex data
          } else if (normalizedLocalMeterValue.attribute.format === OCPPValueFormat.SIGNED_DATA) {
            normalizedLocalMeterValue.value = sampledValue.value;
          }
          // Add
          normalizedMeterValues.values.push(normalizedLocalMeterValue);
        }
      // OCPP 1.5
      } else if (meterValue['value']) {
        if (Array.isArray(meterValue['value'])) {
          for (const currentValue of meterValue['value']) {
            normalizedMeterValue.value = Utils.convertToFloat(currentValue['$value']);
            normalizedMeterValue.attribute = currentValue.attributes;
            normalizedMeterValues.values.push(Utils.cloneObject(normalizedMeterValue));
          }
        } else {
          normalizedMeterValue.value = Utils.convertToFloat(meterValue['value']['$value']);
          normalizedMeterValue.attribute = meterValue['value'].attributes;
          normalizedMeterValues.values.push(Utils.cloneObject(normalizedMeterValue));
        }
      }
    }
    return normalizedMeterValues;
  }

  private buildMeterValueAttributes(sampledValue: OCPPSampledValue): OCPPAttribute {
    return {
      context: sampledValue.context ? sampledValue.context : OCPPReadingContext.SAMPLE_PERIODIC,
      format: sampledValue.format ? sampledValue.format : OCPPValueFormat.RAW,
      measurand: sampledValue.measurand ? sampledValue.measurand : OCPPMeasurand.ENERGY_ACTIVE_IMPORT_REGISTER,
      location: sampledValue.location ? sampledValue.location : OCPPLocation.OUTLET,
      unit: sampledValue.unit ? sampledValue.unit : OCPPUnitOfMeasure.WATT_HOUR,
      phase: sampledValue.phase ? sampledValue.phase : null
    };
  }

  private async stopOrDeleteActiveTransaction(tenant: Tenant, chargingStation: ChargingStation, connectorId: number) {
    // Check
    let activeTransaction: Transaction, lastCheckedTransactionID: number;
    do {
      // Check if the charging station has already a transaction
      activeTransaction = await TransactionStorage.getActiveTransaction(tenant, chargingStation.id, connectorId);
      // Exists already?
      if (activeTransaction) {
        // Avoid infinite Loop
        if (lastCheckedTransactionID === activeTransaction.id) {
          return;
        }
        // Has consumption?
        if (activeTransaction.currentTotalConsumptionWh <= 0) {
          // No consumption: delete
          await Logging.logWarning({
            tenant,
            source: chargingStation.id,
            module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
            action: ServerAction.CLEANUP_TRANSACTION,
            actionOnUser: activeTransaction.user,
            message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)} Transaction with no consumption has been deleted`
          });
          // Delete
          await TransactionStorage.deleteTransaction(tenant, activeTransaction.id);
          // Clear connector
          OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, activeTransaction.connectorId);
        } else {
          // Simulate a Stop Transaction
          const result = await this.handleStopTransaction({
            tenantID: tenant.id,
            chargeBoxIdentity: activeTransaction.chargeBoxID
          }, {
            chargeBoxID: activeTransaction.chargeBoxID,
            transactionId: activeTransaction.id,
            meterStop: (activeTransaction.lastConsumption ? activeTransaction.lastConsumption.value : activeTransaction.meterStart),
            timestamp: Utils.convertToDate(activeTransaction.lastConsumption ? activeTransaction.lastConsumption.timestamp : activeTransaction.timestamp).toISOString(),
          }, false, true);
          // Check
          if (result.idTagInfo.status === OCPPAuthorizationStatus.INVALID) {
            // Cannot stop it
            await Logging.logError({
              tenant,
              source: chargingStation.id,
              module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
              action: ServerAction.CLEANUP_TRANSACTION,
              actionOnUser: activeTransaction.userID,
              message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)} Pending transaction cannot be stopped`,
              detailedMessages: { result }
            });
          } else {
            // Stopped
            await Logging.logWarning({
              tenant,
              source: chargingStation.id,
              module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
              action: ServerAction.CLEANUP_TRANSACTION,
              actionOnUser: activeTransaction.userID,
              message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)}  Pending transaction has been stopped`,
              detailedMessages: { result }
            });
          }
        }
        // Keep last Transaction ID
        lastCheckedTransactionID = activeTransaction.id;
      }
    } while (activeTransaction);
  }

  private notifyStartTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, user: User) {
    if (user) {
      NotificationHandler.sendSessionStarted(
        tenant,
        transaction.id.toString(),
        user,
        chargingStation,
        {
          'user': user,
          'transactionId': transaction.id,
          'chargeBoxID': chargingStation.id,
          'connectorId': Utils.getConnectorLetterFromConnectorID(transaction.connectorId),
          'evseDashboardURL': Utils.buildEvseURL(tenant.subdomain),
          'evseDashboardChargingStationURL': Utils.buildEvseTransactionURL(tenant.subdomain, transaction.id, '#inprogress')
        }
      ).catch(() => { });
    }
  }

  private getStopTransactionTagId(stopTransaction: OCPPStopTransactionRequestExtended, transaction: Transaction): string {
    // Stopped Remotely?
    if (transaction.remotestop) {
      // Yes: Get the diff from now
      const secs = moment.duration(moment().diff(
        moment(transaction.remotestop.timestamp))).asSeconds();
      // In a minute
      if (secs < 60) {
        // Return tag that remotely stopped the transaction
        return transaction.remotestop.tagID;
      }
    }
    // Already provided?
    if (stopTransaction.idTag) {
      // Return tag that stopped the transaction
      return stopTransaction.idTag;
    }
    // Default: return tag that started the transaction
    return transaction.tagID;
  }

  private notifyStopTransaction(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction, user: User, alternateUser: User) {
    // User provided?
    if (user) {
      // Get the i18n lib
      const i18nManager = I18nManager.getInstanceForLocale(user.locale);
      // Send Notification (Async)
      NotificationHandler.sendEndOfSession(
        tenant,
        transaction.id.toString() + '-EOS',
        user,
        chargingStation,
        {
          user: user,
          alternateUser: (alternateUser ? alternateUser : null),
          transactionId: transaction.id,
          chargeBoxID: chargingStation.id,
          connectorId: Utils.getConnectorLetterFromConnectorID(transaction.connectorId),
          totalConsumption: i18nManager.formatNumber(Math.round(transaction.stop.totalConsumptionWh / 10) / 100),
          totalDuration: this.buildTransactionDuration(transaction),
          totalInactivity: this.transactionInactivityToString(transaction, user),
          stateOfCharge: transaction.stop.stateOfCharge,
          evseDashboardChargingStationURL: Utils.buildEvseTransactionURL(tenant.subdomain, transaction.id, '#history'),
          evseDashboardURL: Utils.buildEvseURL(tenant.subdomain)
        }
      ).catch(() => { });
      // Notify Signed Data
      if (transaction.stop.signedData !== '') {
        // Send Notification (Async)
        NotificationHandler.sendEndOfSignedSession(
          tenant,
          transaction.id.toString() + '-EOSS',
          user,
          chargingStation,
          {
            user: user,
            alternateUser: (alternateUser ? alternateUser : null),
            transactionId: transaction.id,
            chargeBoxID: chargingStation.id,
            connectorId: Utils.getConnectorLetterFromConnectorID(transaction.connectorId),
            tagId: transaction.tagID,
            startDate: transaction.timestamp.toLocaleString(user.locale ? user.locale.replace('_', '-') : Constants.DEFAULT_LOCALE.replace('_', '-')),
            endDate: transaction.stop.timestamp.toLocaleString(user.locale ? user.locale.replace('_', '-') : Constants.DEFAULT_LOCALE.replace('_', '-')),
            meterStart: (transaction.meterStart / 1000).toLocaleString(
              (user.locale ? user.locale.replace('_', '-') : Constants.DEFAULT_LOCALE.replace('_', '-')),
              { minimumIntegerDigits: 1, minimumFractionDigits: 4, maximumFractionDigits: 4 }),
            meterStop: (transaction.stop.meterStop / 1000).toLocaleString(
              (user.locale ? user.locale.replace('_', '-') : Constants.DEFAULT_LOCALE.replace('_', '-')),
              { minimumIntegerDigits: 1, minimumFractionDigits: 4, maximumFractionDigits: 4 }),
            totalConsumption: (transaction.stop.totalConsumptionWh / 1000).toLocaleString(
              (user.locale ? user.locale.replace('_', '-') : Constants.DEFAULT_LOCALE.replace('_', '-')),
              { minimumIntegerDigits: 1, minimumFractionDigits: 4, maximumFractionDigits: 4 }),
            price: transaction.stop.price,
            relativeCost: (transaction.stop.price / (transaction.stop.totalConsumptionWh / 1000)),
            startSignedData: transaction.signedData,
            endSignedData: transaction.stop.signedData,
            evseDashboardURL: Utils.buildEvseURL(tenant.subdomain)
          }
        ).catch(() => { });
      }
    }
  }

  private async triggerSmartCharging(tenant: Tenant, chargingStation: ChargingStation) {
    // Smart Charging must be active
    if (Utils.isTenantComponentActive(tenant, TenantComponents.SMART_CHARGING)) {
      // Get Site Area
      const siteArea = await SiteAreaStorage.getSiteArea(tenant, chargingStation.siteAreaID);
      if (siteArea && siteArea.smartCharging) {
        const siteAreaLock = await LockingHelper.acquireSiteAreaSmartChargingLock(tenant.id, siteArea, 30);
        if (siteAreaLock) {
          try {
            const smartCharging = await SmartChargingFactory.getSmartChargingImpl(tenant);
            if (smartCharging) {
              await smartCharging.computeAndApplyChargingProfiles(siteArea);
            }
          } finally {
            // Release lock
            await LockingManager.release(siteAreaLock);
          }
        }
      }
    }
  }

  private async updateChargingStationConnectorWithTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, user: User): Promise<void> {
    const foundConnector = Utils.getConnectorFromID(chargingStation, transaction.connectorId);
    if (foundConnector) {
      foundConnector.currentInstantWatts = 0;
      foundConnector.currentTotalConsumptionWh = 0;
      foundConnector.currentTotalInactivitySecs = 0;
      foundConnector.currentInactivityStatus = InactivityStatus.INFO;
      foundConnector.currentStateOfCharge = 0;
      foundConnector.currentTransactionID = transaction.id;
      foundConnector.currentTransactionDate = transaction.timestamp;
      foundConnector.currentTagID = transaction.tagID;
      foundConnector.currentUserID = transaction.userID;
    } else {
      await Logging.logWarning({
        tenant,
        source: chargingStation.id,
        module: MODULE_NAME, method: 'clearChargingStationConnectorRuntimeData',
        action: ServerAction.START_TRANSACTION, user: user,
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Connector does not exist`
      });
    }
    // Update lastSeen
    chargingStation.lastSeen = new Date();
  }

  private async processCarTransaction(tenant: Tenant, transaction: Transaction, user: User): Promise<void> {
    if (Utils.isTenantComponentActive(tenant, TenantComponents.CAR) && user) {
      // Check default car
      if (user.lastSelectedCarID) {
        transaction.carID = user.lastSelectedCarID;
      } else {
        // Get default car if any
        const defaultCar = await CarStorage.getDefaultUserCar(tenant, user.id, {}, ['id', 'carCatalogID']);
        if (defaultCar) {
          transaction.carID = defaultCar.id;
          transaction.carCatalogID = defaultCar.carCatalogID;
        }
      }
      // Set Car Catalog ID
      if (transaction.carID && !transaction.carCatalogID) {
        const car = await CarStorage.getCar(tenant, transaction.carID, {}, ['id', 'carCatalogID']);
        transaction.carCatalogID = car?.carCatalogID;
      }
      // Clear
      await UserStorage.saveUserLastSelectedCarID(tenant, user.id, null);
    }
  }

  private addChargingStationToException(error: BackendError, chargingStationID: string): void {
    if (error.params) {
      error.params.source = chargingStationID;
    }
  }

  private enrichStartTransaction(tenant: Tenant, startTransaction: OCPPStartTransactionRequestExtended, chargingStation: ChargingStation): void {
    // Enrich
    this.enrichOCPPRequest(chargingStation, startTransaction, false);
    startTransaction.tagID = startTransaction.idTag;
    // Organization
    if (Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION)) {
      // Set the Organization IDs
      startTransaction.companyID = chargingStation.companyID;
      startTransaction.siteID = chargingStation.siteID;
      startTransaction.siteAreaID = chargingStation.siteAreaID;
    }
  }

  private async createTransaction(tenant: Tenant, startTransaction: OCPPStartTransactionRequestExtended): Promise<Transaction> {
    return {
      id: await TransactionStorage.findAvailableID(tenant),
      issuer: true,
      chargeBoxID: startTransaction.chargeBoxID,
      tagID: startTransaction.idTag,
      timezone: startTransaction.timezone,
      userID: startTransaction.userID,
      companyID: startTransaction.companyID,
      siteID: startTransaction.siteID,
      siteAreaID: startTransaction.siteAreaID,
      connectorId: startTransaction.connectorId,
      meterStart: startTransaction.meterStart,
      timestamp: Utils.convertToDate(startTransaction.timestamp),
      numberOfMeterValues: 0,
      lastConsumption: {
        value: startTransaction.meterStart,
        timestamp: Utils.convertToDate(startTransaction.timestamp)
      },
      currentInstantWatts: 0,
      currentStateOfCharge: 0,
      currentConsumptionWh: 0,
      currentTotalConsumptionWh: 0,
      currentTotalInactivitySecs: 0,
      currentInactivityStatus: InactivityStatus.INFO,
      signedData: '',
      stateOfCharge: 0,
    };
  }

  private getHeartbeatInterval(ocppProtocol: OCPPProtocol): number {
    switch (ocppProtocol) {
      case OCPPProtocol.SOAP:
        return this.chargingStationConfig.heartbeatIntervalOCPPSSecs;
      case OCPPProtocol.JSON:
        return this.chargingStationConfig.heartbeatIntervalOCPPJSecs;
    }
  }

  private enrichBootNotification(headers: OCPPHeader, bootNotification: OCPPBootNotificationRequestExtended): void {
    // Set the endpoint
    if (headers.From) {
      bootNotification.endpoint = headers.From.Address;
    }
    bootNotification.id = headers.chargeBoxIdentity;
    bootNotification.chargeBoxID = headers.chargeBoxIdentity;
    bootNotification.currentIPAddress = headers.currentIPAddress;
    bootNotification.ocppProtocol = headers.ocppProtocol;
    bootNotification.ocppVersion = headers.ocppVersion;
    // Set the default
    bootNotification.lastReboot = new Date();
    bootNotification.lastSeen = bootNotification.lastReboot;
    bootNotification.timestamp = bootNotification.lastReboot;
  }

  private async checkAndCreateChargingStation(tenant: Tenant, bootNotification: OCPPBootNotificationRequestExtended, headers: OCPPHeader): Promise<ChargingStation> {
    // Check connection Token
    const token = await OCPPUtils.checkChargingStationConnectionToken(
      ServerAction.BOOT_NOTIFICATION, tenant, headers.chargeBoxIdentity, headers.token, { headers, bootNotification });
    // New Charging Station: Create
    const newChargingStation = {} as ChargingStation;
    for (const key in bootNotification) {
      newChargingStation[key] = bootNotification[key];
    }
    // Update props
    newChargingStation.createdOn = new Date();
    newChargingStation.issuer = true;
    newChargingStation.powerLimitUnit = ChargingRateUnitType.AMPERE;
    newChargingStation.registrationStatus = RegistrationStatus.ACCEPTED;
    // Assign to Site Area
    if (token.siteAreaID) {
      const siteArea = await SiteAreaStorage.getSiteArea(tenant, token.siteAreaID, { withSite: true });
      if (siteArea) {
        newChargingStation.companyID = siteArea.site?.companyID;
        newChargingStation.siteID = siteArea.siteID;
        newChargingStation.siteAreaID = token.siteAreaID;
        // Set the same coordinates
        if (siteArea?.address?.coordinates?.length === 2) {
          newChargingStation.coordinates = siteArea.address.coordinates;
        }
      }
    }
    return newChargingStation;
  }

  private async checkExistingChargingStation(headers: OCPPHeader, chargingStation: ChargingStation, bootNotification: OCPPBootNotificationRequestExtended) {
    // Existing Charging Station: Update
    // Check if same vendor and model
    if ((chargingStation.chargePointVendor !== bootNotification.chargePointVendor ||
         chargingStation.chargePointModel !== bootNotification.chargePointModel) ||
        (chargingStation.chargePointSerialNumber && bootNotification.chargePointSerialNumber &&
         chargingStation.chargePointSerialNumber !== bootNotification.chargePointSerialNumber)) {
      // Not the same Charging Station
      const isChargingStationOnline = moment().subtract(Configuration.getChargingStationConfig().maxLastSeenIntervalSecs, 'seconds').isSameOrBefore(chargingStation.lastSeen);
      if (isChargingStationOnline && chargingStation.registrationStatus === RegistrationStatus.ACCEPTED) {
        await Logging.logWarning({
          tenantID: headers.tenantID,
          source: chargingStation.id,
          action: ServerAction.BOOT_NOTIFICATION,
          module: MODULE_NAME, method: 'checkExistingChargingStation',
          message: 'Trying to connect a charging station matching an online charging station with identical chargeBoxID, registered boot notification and different attributes',
          detailedMessages: { headers, bootNotification }
        });
      }
      throw new BackendError({
        source: chargingStation.id,
        action: ServerAction.BOOT_NOTIFICATION,
        module: MODULE_NAME, method: 'checkExistingChargingStation',
        message: 'Boot Notification Rejected: Attribute mismatch: ' +
          (bootNotification.chargePointVendor !== chargingStation.chargePointVendor ?
            `Got chargePointVendor='${bootNotification.chargePointVendor}' but expected '${chargingStation.chargePointVendor}'! ` : '') +
          (bootNotification.chargePointModel !== chargingStation.chargePointModel ?
            `Got chargePointModel='${bootNotification.chargePointModel}' but expected '${chargingStation.chargePointModel}'! ` : '') +
          (bootNotification.chargePointSerialNumber !== chargingStation.chargePointSerialNumber ?
            `Got chargePointSerialNumber='${bootNotification.chargePointSerialNumber ? bootNotification.chargePointSerialNumber : ''}' but expected '${chargingStation.chargePointSerialNumber ? chargingStation.chargePointSerialNumber : ''}'!` : ''),
        detailedMessages: { headers, bootNotification }
      });
    }
    chargingStation.chargePointSerialNumber = bootNotification.chargePointSerialNumber;
    chargingStation.chargeBoxSerialNumber = bootNotification.chargeBoxSerialNumber;
    chargingStation.firmwareVersion = bootNotification.firmwareVersion;
    chargingStation.lastReboot = bootNotification.lastReboot;
    chargingStation.registrationStatus = RegistrationStatus.ACCEPTED;
    // Back again
    chargingStation.deleted = false;
  }

  private enrichChargingStation(chargingStation: ChargingStation, headers: OCPPHeader, bootNotification: OCPPBootNotificationRequestExtended) {
    // Set common params
    chargingStation.ocppVersion = headers.ocppVersion;
    chargingStation.ocppProtocol = headers.ocppProtocol;
    chargingStation.lastSeen = bootNotification.lastSeen;
    chargingStation.currentIPAddress = bootNotification.currentIPAddress;
    // Set the Charging Station URL?
    if (headers.chargingStationURL) {
      chargingStation.chargingStationURL = headers.chargingStationURL;
    }
    // Update CF Instance
    chargingStation.cfApplicationIDAndInstanceIndex = Configuration.getCFApplicationIDAndInstanceIndex();
    // Backup connectors
    if (!Utils.isEmptyArray(chargingStation.connectors)) {
      // Init array
      if (Utils.isEmptyArray(chargingStation.backupConnectors)) {
        chargingStation.backupConnectors = [];
      }
      // Check and backup connectors
      for (const connector of chargingStation.connectors) {
        // Check if already backed up
        const foundBackupConnector = chargingStation.backupConnectors.find(
          (backupConnector) => backupConnector.connectorId === connector.connectorId);
        if (!foundBackupConnector) {
          chargingStation.backupConnectors.push(connector);
        }
      }
    }
    // Clear Connectors
    chargingStation.connectors = [];
  }

  private async applyChargingStationTemplate(tenant: Tenant, chargingStation: ChargingStation): Promise<TemplateUpdateResult> {
    const templateUpdateResult = await OCPPUtils.applyTemplateToChargingStation(tenant, chargingStation, false);
    // No matching template or manual configuration
    if (!templateUpdateResult.chargingStationUpdated) {
      OCPPUtils.checkAndSetChargingStationAmperageLimit(chargingStation);
      await OCPPUtils.setChargingStationPhaseAssignment(tenant, chargingStation);
    }
    return templateUpdateResult;
  }

  private notifyBootNotification(tenant: Tenant, chargingStation: ChargingStation) {
    void NotificationHandler.sendChargingStationRegistered(
      tenant,
      Utils.generateUUID(),
      chargingStation,
      {
        chargeBoxID: chargingStation.id,
        evseDashboardURL: Utils.buildEvseURL(tenant.subdomain),
        evseDashboardChargingStationURL: Utils.buildEvseChargingStationURL(tenant.subdomain, chargingStation, '#all')
      }
    );
  }

  private requestOCPPConfigurationDelayed(tenant: Tenant, chargingStation: ChargingStation, templateUpdateResult: TemplateUpdateResult, heartbeatIntervalSecs: number) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      let result: OCPPChangeConfigurationCommandResult;
      // Synchronize heartbeat interval OCPP parameter for charging stations that do not take into account its value in the boot notification response
      let heartbeatIntervalOcppParamSet = false;
      // Change one of the key
      for (const heartbeatOcppKey of Constants.OCPP_HEARTBEAT_KEYS) {
        result = await OCPPUtils.requestChangeChargingStationOcppParameter(tenant, chargingStation, {
          key: heartbeatOcppKey,
          value: heartbeatIntervalSecs.toString()
        }, false);
        if (result.status === OCPPConfigurationStatus.ACCEPTED ||
            result.status === OCPPConfigurationStatus.REBOOT_REQUIRED) {
          heartbeatIntervalOcppParamSet = true;
          break;
        }
      }
      if (!heartbeatIntervalOcppParamSet) {
        await Logging.logError({
          tenant,
          action: ServerAction.BOOT_NOTIFICATION,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'requestOCPPConfigurationDelayed',
          message: `Cannot set heartbeat interval OCPP Parameter on '${chargingStation.id}' in Tenant '${tenant.name}' ('${tenant.subdomain}')`,
          detailedMessages: { heartbeatIntervalSecs, chargingStation }
        });
      }
      // Apply Charging Station Template OCPP configuration
      if (templateUpdateResult.ocppStandardUpdated || templateUpdateResult.ocppVendorUpdated) {
        result = await OCPPUtils.applyTemplateOcppParametersToChargingStation(tenant, chargingStation);
      }
      if (result.status !== OCPPConfigurationStatus.ACCEPTED) {
        await Logging.logError({
          tenant,
          action: ServerAction.BOOT_NOTIFICATION,
          source: chargingStation.id,
          module: MODULE_NAME, method: 'requestOCPPConfigurationDelayed',
          message: `Cannot request and save OCPP Parameters from '${chargingStation.id}' in Tenant '${tenant.name}' ('${tenant.subdomain}')`,
          detailedMessages: { result, chargingStation }
        });
      }
    }, Constants.DELAY_CHANGE_CONFIGURATION_EXECUTION_MILLIS);
  }

  private enrichAuthorize(user: User, chargingStation: ChargingStation, headers: OCPPHeader, authorize: OCPPAuthorizeRequestExtended) {
    // Enrich
    this.enrichOCPPRequest(chargingStation, authorize);
    // Roaming User
    if (user && !user.issuer) {
      // Authorization ID provided?
      if (user.authorizationID) {
        // Public Charging Station
        if (chargingStation.public) {
          // Keep Roaming Auth ID
          authorize.authorizationId = user.authorizationID;
        } else {
          throw new BackendError({
            user: user,
            action: ServerAction.AUTHORIZE,
            module: MODULE_NAME,
            method: 'enrichAuthorize',
            message: 'Cannot authorize a roaming user on a private charging station',
            detailedMessages: { headers, authorize }
          });
        }
      } else {
        throw new BackendError({
          user: user,
          action: ServerAction.AUTHORIZE,
          module: MODULE_NAME,
          method: 'enrichAuthorize',
          message: 'Authorization ID has not been supplied',
          detailedMessages: { headers, authorize }
        });
      }
    }
    // Set
    authorize.user = user;
  }

  private enrichOCPPRequest(chargingStation: ChargingStation, ocppRequest: any, withTimeStamp = true) {
    // Enrich Request
    ocppRequest.chargeBoxID = chargingStation.id;
    ocppRequest.timezone = Utils.getTimezone(chargingStation.coordinates);
    if (withTimeStamp) {
      ocppRequest.timestamp = new Date();
    }
    // Update Charging Station
    chargingStation.lastSeen = new Date();
  }

  private async bypassStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      headers: OCPPHeader, stopTransaction: OCPPStopTransactionRequestExtended): Promise<boolean> {
    // Ignore it (DELTA bug)?
    if (stopTransaction.transactionId === 0) {
      await Logging.logWarning({
        tenant,
        source: chargingStation.id,
        module: MODULE_NAME, method: 'bypassStopTransaction',
        action: ServerAction.STOP_TRANSACTION,
        message: 'Ignored Transaction ID = 0',
        detailedMessages: { headers, stopTransaction }
      });
      return true;
    }
    return false;
  }

  private async getTransactionFromMeterValues(tenant: Tenant, chargingStation: ChargingStation, headers: OCPPHeader, meterValues: OCPPMeterValuesRequest): Promise<Transaction> {
    // Handle Meter Value only for transaction
    if (!meterValues.transactionId) {
      throw new BackendError({
        source: chargingStation.id,
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId)} Meter Values are not linked to a transaction and will be ignored`,
        action: ServerAction.METER_VALUES,
        detailedMessages: { headers, meterValues }
      });
    }
    const transaction = await TransactionStorage.getTransaction(tenant, meterValues.transactionId, { withUser: true, withTag: true });
    if (!transaction) {
      // Try a Remote Stop the Transaction
      if (meterValues.transactionId) {
        // Get the OCPP Client
        const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
        if (!chargingStationClient) {
          await Logging.logWarning({
            tenant,
            source: chargingStation.id,
            module: MODULE_NAME, method: 'getTransactionFromMeterValues',
            action: ServerAction.STOP_TRANSACTION,
            message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Charging Station is not connected to the backend, cannot send a Remote Stop Transaction on an unknown ongoing Transaction`,
            detailedMessages: { headers, meterValues }
          });
        } else {
          // Send Remote Stop
          const result = await chargingStationClient.remoteStopTransaction({
            transactionId: meterValues.transactionId
          });
          if (result.status === OCPPRemoteStartStopStatus.ACCEPTED) {
            await Logging.logInfo({
              tenant,
              source: chargingStation.id,
              module: MODULE_NAME, method: 'getTransactionFromMeterValues',
              action: ServerAction.STOP_TRANSACTION,
              message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Transaction with unknown ID has been automatically remotely stopped`,
              detailedMessages: { headers, meterValues }
            });
          } else {
            await Logging.logWarning({
              tenant,
              source: chargingStation.id,
              module: MODULE_NAME, method: 'getTransactionFromMeterValues',
              action: ServerAction.STOP_TRANSACTION,
              message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Cannot send a Remote Stop Transaction on an unknown ongoing Transaction`,
              detailedMessages: { headers, meterValues }
            });
          }
        }
      }
      // Unkown Transaction
      throw new BackendError({
        source: chargingStation.id,
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Transaction does not exist`,
        action: ServerAction.METER_VALUES,
        detailedMessages: { headers, meterValues }
      });
    }
    // Received Meter Values after the Transaction End Meter Value
    if (transaction.transactionEndReceived) {
      await Logging.logWarning({
        tenant,
        source: chargingStation.id,
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        action: ServerAction.METER_VALUES,
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Meter Values received after the 'Transaction.End'`,
        detailedMessages: { headers, meterValues }
      });
    }
    return transaction;
  }

  private async getTransactionFromStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      headers: OCPPHeader, stopTransaction: OCPPStopTransactionRequestExtended): Promise<Transaction> {
    const transaction = await TransactionStorage.getTransaction(tenant, stopTransaction.transactionId, { withUser: true, withTag: true });
    if (!transaction) {
      throw new BackendError({
        source: chargingStation.id,
        module: MODULE_NAME, method: 'getTransactionFromStopTransaction',
        message: `Transaction with ID '${stopTransaction.transactionId}' doesn't exist`,
        action: ServerAction.STOP_TRANSACTION,
        detailedMessages: { headers, stopTransaction }
      });
    }
    return transaction;
  }

  private checkSoftStopTransaction(transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended, isSoftStop: boolean) {
    if (isSoftStop) {
      // Yes: Add the latest Meter Value
      if (transaction.lastConsumption) {
        stopTransaction.meterStop = transaction.lastConsumption.value;
      } else {
        stopTransaction.meterStop = 0;
      }
    }
  }

  private async checkAndApplyLastConsumptionInStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended) {
    // No need to compute the last consumption if Transaction.End Meter Value has been received
    if (!transaction.transactionEndReceived) {
      // Recreate the last meter value to price the last Consumption
      const stopMeterValues = OCPPUtils.createTransactionStopMeterValues(chargingStation, transaction, stopTransaction);
      // Build final Consumptions (only one consumption)
      const consumptions = await OCPPUtils.createConsumptionsFromMeterValues(tenant, chargingStation, transaction, stopMeterValues);
      // Update
      for (const consumption of consumptions) {
        // Update Transaction with Consumption
        OCPPUtils.updateTransactionWithConsumption(chargingStation, transaction, consumption);
        if (consumption.toPrice) {
          // Price
          await OCPPUtils.processTransactionPricing(tenant, transaction, chargingStation, consumption, TransactionAction.STOP);
        }
        // Save Consumption
        await ConsumptionStorage.saveConsumption(tenant, consumption);
      }
    // Check Inactivity and Consumption between the last Transaction.End and Stop Transaction
    } else if (transaction.lastConsumption) {
      // The consumption should be the same
      if (transaction.lastConsumption.value !== stopTransaction.meterStop) {
        await Logging.logWarning({
          tenant,
          source: chargingStation.id,
          action: ServerAction.STOP_TRANSACTION,
          module: MODULE_NAME, method: 'checkAndApplyLastConsumptionInStopTransaction',
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction.End consumption '${transaction.lastConsumption.value}' differs from Stop Transaction '${stopTransaction.meterStop}'`,
          detailedMessages: { stopTransaction, transaction }
        });
      }
      // Handle inactivity
      const inactivitySecs = Utils.createDecimal(new Date(stopTransaction.timestamp).getTime() - new Date(transaction.lastConsumption.timestamp).getTime()).div(1000).toNumber();
      // Add inactivity to Transaction
      if (inactivitySecs > 0) {
        transaction.currentTotalInactivitySecs += inactivitySecs;
        transaction.currentTotalDurationSecs += inactivitySecs;
      }
    }
  }

  private buildStatusNotification(statusNotification: OCPPStatusNotificationRequestExtended) {
    const statusNotifications: string[] = [];
    statusNotifications.push(`Status: '${statusNotification.status}'`);
    if (statusNotification.errorCode && statusNotification.errorCode !== 'NoError') {
      statusNotifications.push(`errorCode: '${statusNotification.errorCode}'`);
    }
    if (statusNotification.info) {
      statusNotifications.push(`info: '${statusNotification.info}'`);
    }
    if (statusNotification.vendorErrorCode) {
      statusNotifications.push(`vendorErrorCode: '${statusNotification.vendorErrorCode}'`);
    }
    if (statusNotification.vendorId) {
      statusNotifications.push(`vendorId: '${statusNotification.vendorId}'`);
    }
    return statusNotifications.join(', ');
  }
}
