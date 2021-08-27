import { Action, Entity } from '../../../../types/Authorization';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import { NextFunction, Request, Response } from 'express';
import { OCPPProtocol, OCPPVersion } from '../../../../types/ocpp/OCPPServer';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import Authorizations from '../../../../authorization/Authorizations';
import Constants from '../../../../utils/Constants';
import Logging from '../../../../utils/Logging';
import RegistrationToken from '../../../../types/RegistrationToken';
import RegistrationTokenSecurity from './security/RegistrationTokenSecurity';
import RegistrationTokenStorage from '../../../../storage/mongodb/RegistrationTokenStorage';
import { ServerAction } from '../../../../types/Server';
import SiteAreaStorage from '../../../../storage/mongodb/SiteAreaStorage';
import TenantComponents from '../../../../types/TenantComponents';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
import moment from 'moment';

const MODULE_NAME = 'RegistrationTokenService';

export default class RegistrationTokenService {
  static async handleCreateRegistrationToken(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Filter
    const filteredRequest = RegistrationTokenSecurity.filterRegistrationTokenCreateRequest(req.body);
    // Check Auth
    if (Utils.isComponentActiveFromToken(req.user, TenantComponents.ORGANIZATION) && filteredRequest.siteAreaID) {
      // Get the Site Area
      const siteArea = await SiteAreaStorage.getSiteArea(req.tenant, filteredRequest.siteAreaID);
      UtilsService.assertObjectExists(action, siteArea, `Site Area ID '${filteredRequest.siteAreaID}' does not exist`,
        MODULE_NAME, 'handleCreateRegistrationToken', req.user);
      if (!await Authorizations.canCreateRegistrationToken(req.user, siteArea.siteID)) {
        // Not Authorized!
        throw new AppAuthError({
          errorCode: HTTPAuthError.FORBIDDEN,
          user: req.user,
          action: Action.CREATE, entity: Entity.TOKEN,
          module: MODULE_NAME, method: 'handleCreateRegistrationToken'
        });
      }
    } else if (!await Authorizations.canCreateRegistrationToken(req.user, null)) {
      // Not Authorized!
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.CREATE, entity: Entity.TOKEN,
        module: MODULE_NAME, method: 'handleCreateRegistrationToken'
      });
    }
    // Check
    if (!filteredRequest.description) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The description must be provided',
        module: MODULE_NAME, method: 'handleCreateRegistrationToken',
        user: req.user
      });
    }
    // Check site is provided for site admins
    if (Utils.isComponentActiveFromToken(req.user, TenantComponents.ORGANIZATION) &&
        Authorizations.isSiteAdmin(req.user) &&
        !filteredRequest.siteAreaID) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The Site ID must be provided',
        module: MODULE_NAME, method: 'handleCreateRegistrationToken',
        user: req.user
      });
    }
    // Create
    const registrationToken: RegistrationToken = {
      siteAreaID: filteredRequest.siteAreaID,
      description: filteredRequest.description,
      expirationDate: filteredRequest.expirationDate ? filteredRequest.expirationDate : moment().add(1, 'month').toDate(),
      createdBy: { id: req.user.id },
      createdOn: new Date()
    };
    // Save
    registrationToken.id = await RegistrationTokenStorage.saveRegistrationToken(req.tenant, registrationToken);
    // Build OCPP URLs
    registrationToken.ocpp15SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    registrationToken.ocpp15SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    // Ok
    res.json(Object.assign({ id: registrationToken.id }, Constants.REST_RESPONSE_SUCCESS));
    next();
  }

  static async handleUpdateRegistrationToken(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Filter
    const filteredRequest = RegistrationTokenSecurity.filterRegistrationTokenUpdateRequest(req.body);
    UtilsService.assertIdIsProvided(action, filteredRequest.id, MODULE_NAME, 'handleUpdateRegistrationToken', req.user);
    // Check Auth
    if (!await Authorizations.canUpdateRegistrationToken(req.user, filteredRequest.siteAreaID)) {
      // Not Authorized!
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.UPDATE, entity: Entity.TOKEN,
        module: MODULE_NAME, method: 'handleUpdateRegistrationToken'
      });
    }
    // Get Token
    const registrationToken = await RegistrationTokenStorage.getRegistrationToken(req.tenant, filteredRequest.id);
    UtilsService.assertObjectExists(action, registrationToken, `Token ID '${filteredRequest.id}' does not exist`,
      MODULE_NAME, 'handleUpdateRegistrationToken', req.user);
    if (Utils.isComponentActiveFromToken(req.user, TenantComponents.ORGANIZATION)) {
      // Check Site Area if it's provided
      if (filteredRequest.siteAreaID) {
        const siteArea = await SiteAreaStorage.getSiteArea(req.tenant, filteredRequest.siteAreaID);
        UtilsService.assertObjectExists(action, siteArea, `Site Area ID '${filteredRequest.siteAreaID}' does not exist`,
          MODULE_NAME, 'handleUpdateRegistrationToken', req.user);
      }
    }
    // Check
    if (!filteredRequest.description) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The description must be provided',
        module: MODULE_NAME, method: 'handleUpdateRegistrationToken',
        user: req.user
      });
    }
    // Update
    registrationToken.siteAreaID = filteredRequest.siteAreaID;
    registrationToken.description = filteredRequest.description;
    registrationToken.expirationDate = filteredRequest.expirationDate ? filteredRequest.expirationDate : moment().add(1, 'month').toDate();
    registrationToken.lastChangedBy = { id: req.user.id };
    registrationToken.lastChangedOn = new Date();
    registrationToken.revocationDate = null;
    // Save
    registrationToken.id = await RegistrationTokenStorage.saveRegistrationToken(req.tenant, registrationToken);
    // Build OCPP URLs
    registrationToken.ocpp15SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    registrationToken.ocpp15SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  static async handleDeleteRegistrationToken(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const tokenID = RegistrationTokenSecurity.filterRegistrationTokenByIDRequest(req.query);
    UtilsService.assertIdIsProvided(action, tokenID, MODULE_NAME, 'handleDeleteRegistrationToken', req.user);
    // Get Token
    const registrationToken = await RegistrationTokenStorage.getRegistrationToken(req.tenant, tokenID);
    UtilsService.assertObjectExists(action, registrationToken, `Registration Token ID '${tokenID}' does not exist`,
      MODULE_NAME, 'handleDeleteRegistrationToken', req.user);
    // Check auth
    if (!await Authorizations.canDeleteRegistrationToken(req.user, registrationToken.siteArea?.siteID)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.DELETE, entity: Entity.TOKEN,
        module: MODULE_NAME, method: 'handleDeleteRegistrationToken',
        value: tokenID
      });
    }
    // Delete
    await RegistrationTokenStorage.deleteRegistrationToken(req.tenant, tokenID);
    // Log
    await Logging.logSecurityInfo({
      tenantID: req.user.tenantID,
      user: req.user,
      module: MODULE_NAME, method: 'handleDeleteRegistrationToken',
      message: `Registration token with ID '${tokenID}' has been deleted successfully`,
      action: action
    });
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  static async handleRevokeRegistrationToken(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const tokenID = RegistrationTokenSecurity.filterRegistrationTokenByIDRequest(req.query);
    UtilsService.assertIdIsProvided(action, tokenID, MODULE_NAME, 'handleDeleteRegistrationToken', req.user);
    // Get Token
    const registrationToken = await RegistrationTokenStorage.getRegistrationToken(req.tenant, tokenID);
    UtilsService.assertObjectExists(action, registrationToken, `Registration Token ID '${tokenID}' does not exist`,
      MODULE_NAME, 'handleRevokeRegistrationToken', req.user);
    // Check auth
    if (!await Authorizations.canUpdateRegistrationToken(req.user, registrationToken.siteArea?.siteID)) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.UPDATE, entity: Entity.TOKEN,
        module: MODULE_NAME, method: 'handleRevokeRegistrationToken',
        value: tokenID
      });
    }
    if (registrationToken.expirationDate &&
        moment(registrationToken.expirationDate).isBefore(new Date())) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Cannot revoke a token that has expired',
        module: MODULE_NAME, method: 'handleRevokeRegistrationToken',
        user: req.user
      });
    }
    // Update
    registrationToken.revocationDate = new Date();
    registrationToken.lastChangedBy = { 'id': req.user.id };
    registrationToken.lastChangedOn = new Date();
    await RegistrationTokenStorage.saveRegistrationToken(req.tenant, registrationToken);
    // Log
    await Logging.logSecurityInfo({
      tenantID: req.user.tenantID,
      user: req.user,
      module: MODULE_NAME, method: 'handleRevokeRegistrationToken',
      message: `Registration token with ID '${tokenID}' has been revoked successfully`,
      action: action
    });
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  static async handleGetRegistrationTokens(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check auth
    if (!await Authorizations.canListRegistrationTokens(req.user)) {
      // Not Authorized!
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.LIST, entity: Entity.TOKENS,
        module: MODULE_NAME, method: 'handleGetRegistrationTokens'
      });
    }
    const filteredRequest = RegistrationTokenSecurity.filterRegistrationTokensRequest(req.query);
    // Check User
    let userProject: string[] = [];
    if ((await Authorizations.canListUsers(req.user)).authorized) {
      userProject = [ 'createdBy.name', 'createdBy.firstName', 'lastChangedBy.name', 'lastChangedBy.firstName' ];
    }
    // Get the tokens
    const registrationTokens = await RegistrationTokenStorage.getRegistrationTokens(req.tenant,
      {
        siteAreaID: filteredRequest.SiteAreaID,
        siteIDs: Authorizations.getAuthorizedSiteAdminIDs(req.user, null),
      },
      {
        limit: filteredRequest.Limit,
        skip: filteredRequest.Skip,
        sort: filteredRequest.SortFields,
        onlyRecordCount: filteredRequest.OnlyRecordCount
      },
      [
        'id', 'status', 'description', 'createdOn', 'lastChangedOn', 'expirationDate', 'revocationDate',
        'siteAreaID', 'siteArea.name',
        ...userProject
      ]
    );
    // Build OCPP URLs
    for (const registrationToken of registrationTokens.result) {
      registrationToken.ocpp15SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
      registrationToken.ocpp16SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
      registrationToken.ocpp16JSONUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
      registrationToken.ocpp15SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
      registrationToken.ocpp16SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
      registrationToken.ocpp16JSONSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    }
    // Ok
    res.json(registrationTokens);
    next();
  }

  static async handleGetRegistrationToken(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = RegistrationTokenSecurity.filterRegistrationTokenByIDRequest(req.query);
    // Check User
    let userProject: string[] = [];
    if ((await Authorizations.canListUsers(req.user)).authorized) {
      userProject = [ 'createdBy.name', 'createdBy.firstName', 'lastChangedBy.name', 'lastChangedBy.firstName' ];
    }
    // Get the token
    const registrationToken = await RegistrationTokenStorage.getRegistrationToken(req.tenant,
      filteredRequest,
      [
        'id', 'status', 'description', 'createdOn', 'lastChangedOn', 'expirationDate', 'revocationDate',
        'siteAreaID', 'siteArea.name',
        ...userProject
      ]);
    UtilsService.assertObjectExists(action, registrationToken, `Token ID '${filteredRequest}' does not exist`,
      MODULE_NAME, 'handleGetRegistrationToken', req.user);
    // Check auth
    if (!await Authorizations.canReadRegistrationToken(req.user, registrationToken?.siteArea?.siteID)) {
      // Not Authorized!
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.READ, entity: Entity.TOKEN,
        module: MODULE_NAME, method: 'handleGetRegistrationToken'
      });
    }
    // Build OCPP URLs
    registrationToken.ocpp15SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONUrl = Utils.buildOCPPServerURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    registrationToken.ocpp15SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_15, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16SOAPSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.SOAP, registrationToken.id);
    registrationToken.ocpp16JSONSecureUrl = Utils.buildOCPPServerSecureURL(req.user.tenantID, OCPPVersion.VERSION_16, OCPPProtocol.JSON, registrationToken.id);
    // Ok
    res.json(registrationToken);
    next();
  }
}

