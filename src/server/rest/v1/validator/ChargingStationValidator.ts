import { HttpChargingStationGetDiagnosticsRequest, HttpChargingStationGetOcppConfigurationRequest, HttpChargingStationRemoteStartRequest, HttpChargingStationRemoteStopRequest, HttpChargingStationResetRequest, HttpChargingStationUnlockConnectorRequest, HttpChargingStationUpdateFirmwareRequest, HttpChargingStationUpdateOcppConfigurationRequest, HttpChargingStationsRequest } from '../../../../types/requests/HttpChargingStationRequest';

import HttpByIDRequest from '../../../../types/requests/HttpByIDRequest';
import Schema from './Schema';
import SchemaValidator from './SchemaValidator';
import fs from 'fs';
import global from '../../../../types/GlobalType';

export default class ChargingStationValidator extends SchemaValidator {
  private static instance: ChargingStationValidator | undefined;
  private chargingStationsGet: Schema;
  private chargingStationGet: Schema;
  private chargingStationDelete: Schema;
  private chargingStationReset: Schema;
  private chargingStationOcppConfigurationGet: Schema;
  private chargingStationOcppConfigurationUpdate: Schema;
  private chargingStationRemoteStart: Schema;
  private chargingStationRemoteStop: Schema;
  private chargingStationUnlockConnector: Schema;
  private chargingStationGetCompositeSchedule: Schema;
  private chargingStationGetDiagnostics: Schema;
  private chargingStationFirmwareUpdate: Schema;
  private chargingStationAvailabilityChange: Schema;


  private constructor() {
    super('ChargingStationValidator');
    this.chargingStationsGet = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/chargingstations-get.json`, 'utf8'));
    this.chargingStationGet = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/chargingstation-get.json`, 'utf8'));
    this.chargingStationDelete = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/chargingstation-delete.json`, 'utf8'));
    this.chargingStationReset = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-reset.json`, 'utf8'));
    this.chargingStationOcppConfigurationGet = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-get-ocpp-configuration.json`, 'utf8'));
    this.chargingStationOcppConfigurationUpdate = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-update-ocpp-configuration.json`, 'utf8'));
    this.chargingStationRemoteStart = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-remote-start.json`, 'utf8'));
    this.chargingStationRemoteStop = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-remote-stop.json`, 'utf8'));
    this.chargingStationUnlockConnector = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-unlock-connector.json`, 'utf8'));
    this.chargingStationGetCompositeSchedule = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-get-composite-schedule.json`, 'utf8'));
    this.chargingStationGetDiagnostics = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-get-diagnostics.json`, 'utf8'));
    this.chargingStationFirmwareUpdate = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-update-firmware.json`, 'utf8'));
    this.chargingStationAvailabilityChange = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/chargingstation/actions/chargingstation-change-availability.json`, 'utf8'));
  }

  public static getInstance(): ChargingStationValidator {
    if (!ChargingStationValidator.instance) {
      ChargingStationValidator.instance = new ChargingStationValidator();
    }
    return ChargingStationValidator.instance;
  }

  public validateChargingStationsGetReq(data: any): HttpChargingStationsRequest {
    // Validate schema
    this.validate(this.chargingStationsGet, data);
    return data;
  }

  public validateChargingStationGetReq(data: any): HttpByIDRequest {
    // Validate schema
    this.validate(this.chargingStationGet, data);
    return data;
  }

  public validateChargingStationDeleteReq(data: any): HttpByIDRequest {
    // Validate schema
    this.validate(this.chargingStationDelete, data);
    return data;
  }

  public validateChargingStationResetReq(data: any): HttpChargingStationResetRequest {
    // Validate schema
    this.validate(this.chargingStationReset, data);
    return data;
  }

  public validateChargingStationGetOcppConfigurationReq(data: any): HttpChargingStationGetOcppConfigurationRequest {
    // Validate schema
    this.validate(this.chargingStationOcppConfigurationGet, data);
    return data;
  }

  public validateChargingStationUpdateOcppConfigurationReq(data: any): HttpChargingStationUpdateOcppConfigurationRequest {
    // Validate schema
    this.validate(this.chargingStationOcppConfigurationUpdate, data);
    return data;
  }

  public validateChargingStationRemoteStartReq(data: any): HttpChargingStationRemoteStartRequest {
    // Validate schema
    this.validate(this.chargingStationRemoteStart, data);
    return data;
  }

  public validateChargingStationRemoteStopReq(data: any): HttpChargingStationRemoteStopRequest {
    // Validate schema
    this.validate(this.chargingStationRemoteStop, data);
    return data;
  }

  public validateChargingStationUnlockConnectorReq(data: any): HttpChargingStationUnlockConnectorRequest {
    // Validate schema
    this.validate(this.chargingStationUnlockConnector, data);
    return data;
  }

  public validateChargingStationGetCompositeScheduleReq(data: any): HttpChargingStationUnlockConnectorRequest {
    // Validate schema
    this.validate(this.chargingStationGetCompositeSchedule, data);
    return data;
  }

  public validateChargingStationGetDiagnosticsReq(data: any): HttpChargingStationGetDiagnosticsRequest {
    // Validate schema
    this.validate(this.chargingStationGetDiagnostics, data);
    return data;
  }

  public validateChargingStationUpdateFirmwareReq(data: any): HttpChargingStationUpdateFirmwareRequest {
    // Validate schema
    this.validate(this.chargingStationFirmwareUpdate, data);
    return data;
  }

  public validateChargingStationChangeAvailabilityReq(data: any): HttpChargingStationUpdateFirmwareRequest {
    // Validate schema
    this.validate(this.chargingStationAvailabilityChange, data);
    return data;
  }
}
