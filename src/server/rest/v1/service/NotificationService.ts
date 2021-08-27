import { Action, Entity } from '../../../../types/Authorization';
import { NextFunction, Request, Response } from 'express';

import AppAuthError from '../../../../exception/AppAuthError';
import Authorizations from '../../../../authorization/Authorizations';
import Constants from '../../../../utils/Constants';
import { EndUserErrorNotification } from '../../../../types/UserNotifications';
import { HTTPAuthError } from '../../../../types/HTTPError';
import NotificationHandler from '../../../../notification/NotificationHandler';
import NotificationSecurity from './security/NotificationSecurity';
import NotificationStorage from '../../../../storage/mongodb/NotificationStorage';
import { ServerAction } from '../../../../types/Server';
import UserStorage from '../../../../storage/mongodb/UserStorage';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';

const MODULE_NAME = 'NotificationService';

export default class NotificationService {
  static async handleGetNotifications(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Filter
    const filteredRequest = NotificationSecurity.filterNotificationsRequest(req.query);
    // Check User
    let userProject: string[] = [];
    if ((await Authorizations.canListUsers(req.user)).authorized) {
      userProject = [ 'userID', 'user.id', 'user.name', 'user.firstName', 'user.email', 'data' ];
    }
    // Check Charging Station
    let chargingStationProject: string[] = [];
    if (await Authorizations.canListChargingStations(req.user)) {
      chargingStationProject = [ 'chargeBoxID' ];
    }
    // Get the Notification
    const notifications = await NotificationStorage.getNotifications(req.tenant, {
      'userID': filteredRequest.UserID,
      'dateFrom': filteredRequest.DateFrom,
      'channel': filteredRequest.Channel
    }, {
      limit: filteredRequest.Limit,
      skip: filteredRequest.Skip,
      sort: filteredRequest.SortFields
    },
    [
      'id', 'timestamp', 'channel', 'sourceId', 'sourceDescr', 'chargeBoxID',
      ...userProject, ...chargingStationProject
    ]);
    // Return
    res.json(notifications);
    next();
  }

  static async handleEndUserReportError(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check auth
    if (!(await Authorizations.canEndUserReportError(req.user)).authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.CREATE, entity: Entity.NOTIFICATION,
        module: MODULE_NAME, method: 'handleEndUserReportError'
      });
    }
    // Filter
    const filteredRequest = NotificationSecurity.filterEndUserReportErrorRequest(req.body);
    // Check if Notification is valid
    UtilsService.checkIfEndUserErrorNotificationValid(filteredRequest, req);
    // Check and Get User
    const user = await UtilsService.checkAndGetUserAuthorization(
      req.tenant, req.user, req.user.id, Action.READ, action);
    // Save mobile number
    if (filteredRequest.mobile && user.mobile !== filteredRequest.mobile) {
      user.mobile = filteredRequest.mobile;
      await UserStorage.saveUserMobilePhone(req.tenant, user.id, { mobile: filteredRequest.mobile });
    }
    // Set
    const endUserErrorNotification: EndUserErrorNotification = {
      userID: user.id,
      email: user.email,
      phone: user.mobile,
      name: Utils.buildUserFullName(user, false, false),
      errorTitle: filteredRequest.subject,
      errorDescription: filteredRequest.description,
      evseDashboardURL: Utils.buildEvseURL(),
    };
    // Send Notification
    await NotificationHandler.sendEndUserErrorNotification(req.tenant, endUserErrorNotification);
    // Ok
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }
}

