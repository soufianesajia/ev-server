import { HttpUserAssignSitesRequest, HttpUserMobileTokenRequest, HttpUserRequest, HttpUserSitesRequest, HttpUsersRequest } from '../../../../../types/requests/HttpUserRequest';
import User, { UserRole } from '../../../../../types/User';

import Authorizations from '../../../../../authorization/Authorizations';
import UserNotifications from '../../../../../types/UserNotifications';
import UserToken from '../../../../../types/UserToken';
import Utils from '../../../../../utils/Utils';
import UtilsSecurity from './UtilsSecurity';
import sanitize from 'mongo-sanitize';

export default class UserSecurity {

  public static filterAssignSitesToUserRequest(request: any): HttpUserAssignSitesRequest {
    return {
      userID: sanitize(request.userID),
      siteIDs: request.siteIDs ? request.siteIDs.map(sanitize) : []
    };
  }

  public static filterDefaultTagCarRequestByUserID(request: any): string {
    return sanitize(request.UserID);
  }

  public static filterUserRequest(request: any): HttpUserRequest {
    const filteredRequest: HttpUserRequest = {
      ID: sanitize(request.ID)
    };
    UtilsSecurity.filterProject(request, filteredRequest);
    return filteredRequest;
  }

  public static filterUserByIDRequest(request: any): string {
    return sanitize(request.ID);
  }

  public static filterUserByIDsRequest(request: any): string[] {
    return request.usersIDs.map(sanitize);
  }

  public static filterUsersRequest(request: any): HttpUsersRequest {
    const filteredRequest = {} as HttpUsersRequest;
    if (request.Issuer) {
      filteredRequest.Issuer = UtilsSecurity.filterBoolean(request.Issuer);
    }
    if (request.WithTag) {
      filteredRequest.WithTag = UtilsSecurity.filterBoolean(request.WithTag);
    }
    if (request.Search) {
      filteredRequest.Search = sanitize(request.Search);
    }
    if (request.SiteID) {
      filteredRequest.SiteID = sanitize(request.SiteID);
    }
    if (request.Role) {
      filteredRequest.Role = sanitize(request.Role);
    }
    if (request.Status) {
      filteredRequest.Status = sanitize(request.Status);
    }
    if (request.ErrorType) {
      filteredRequest.ErrorType = sanitize(request.ErrorType);
    }
    if (request.ExcludeSiteID) {
      filteredRequest.ExcludeSiteID = sanitize(request.ExcludeSiteID);
    }
    if (request.TagID) {
      filteredRequest.TagID = sanitize(request.TagID);
    }
    if (request.ExcludeUserIDs) {
      filteredRequest.ExcludeUserIDs = sanitize(request.ExcludeUserIDs);
    }
    if (request.IncludeCarUserIDs) {
      filteredRequest.IncludeCarUserIDs = sanitize(request.IncludeCarUserIDs);
    }
    if (request.NotAssignedToCarID) {
      filteredRequest.NotAssignedToCarID = sanitize(request.NotAssignedToCarID);
    }
    UtilsSecurity.filterSkipAndLimit(request, filteredRequest);
    UtilsSecurity.filterSort(request, filteredRequest);
    UtilsSecurity.filterProject(request, filteredRequest);
    return filteredRequest;
  }

  public static filterUserSitesRequest(request: any): HttpUserSitesRequest {
    const filteredRequest = {} as HttpUserSitesRequest;
    filteredRequest.UserID = sanitize(request.UserID);
    filteredRequest.Search = sanitize(request.Search);
    UtilsSecurity.filterSkipAndLimit(request, filteredRequest);
    UtilsSecurity.filterSort(request, filteredRequest);
    UtilsSecurity.filterProject(request, filteredRequest);
    return filteredRequest;
  }

  public static filterUserUpdateRequest(request: any, loggedUser: UserToken): Partial<User> {
    const filteredRequest = UserSecurity._filterUserRequest(request, loggedUser);
    filteredRequest.id = sanitize(request.id);
    return filteredRequest;
  }

  public static filterUserUpdateMobileTokenRequest(request: any): Partial<HttpUserMobileTokenRequest> {
    return {
      id: sanitize(request.id),
      mobileToken: sanitize(request.mobileToken),
      mobileOS: sanitize(request.mobileOS)
    };
  }

  public static filterUserCreateRequest(request: any, loggedUser: UserToken): Partial<User> {
    return UserSecurity._filterUserRequest(request, loggedUser);
  }

  static filterNotificationsRequest(role: UserRole, notifications: UserNotifications): UserNotifications {
    // All Users
    let filteredNotifications: UserNotifications = {
      sendSessionStarted: UtilsSecurity.filterBoolean(notifications.sendSessionStarted),
      sendOptimalChargeReached: UtilsSecurity.filterBoolean(notifications.sendOptimalChargeReached),
      sendEndOfCharge: UtilsSecurity.filterBoolean(notifications.sendEndOfCharge),
      sendEndOfSession: UtilsSecurity.filterBoolean(notifications.sendEndOfSession),
      sendUserAccountStatusChanged: UtilsSecurity.filterBoolean(notifications.sendUserAccountStatusChanged),
      sendSessionNotStarted: UtilsSecurity.filterBoolean(notifications.sendSessionNotStarted),
      sendCarCatalogSynchronizationFailed: UtilsSecurity.filterBoolean(notifications.sendCarCatalogSynchronizationFailed),
      sendUserAccountInactivity: UtilsSecurity.filterBoolean(notifications.sendUserAccountInactivity),
      sendPreparingSessionNotStarted: UtilsSecurity.filterBoolean(notifications.sendPreparingSessionNotStarted),
      sendBillingSynchronizationFailed: UtilsSecurity.filterBoolean(notifications.sendBillingSynchronizationFailed),
      sendBillingNewInvoice: UtilsSecurity.filterBoolean(notifications.sendBillingNewInvoice),
      sendNewRegisteredUser: false,
      sendUnknownUserBadged: false,
      sendChargingStationStatusError: false,
      sendChargingStationRegistered: false,
      sendOcpiPatchStatusError: false,
      sendSmtpError: false,
      sendOfflineChargingStations: false,
      sendEndUserErrorNotification: false,
      sendComputeAndApplyChargingProfilesFailed: false,
      sendAccountVerificationNotification: UtilsSecurity.filterBoolean(notifications.sendAccountVerificationNotification),
      sendAdminAccountVerificationNotification: false,
    };
    // Admin Notif only
    if (role === UserRole.ADMIN) {
      filteredNotifications = {
        ...filteredNotifications,
        sendBillingSynchronizationFailed: UtilsSecurity.filterBoolean(notifications.sendBillingSynchronizationFailed),
        sendNewRegisteredUser: UtilsSecurity.filterBoolean(notifications.sendNewRegisteredUser),
        sendUnknownUserBadged: UtilsSecurity.filterBoolean(notifications.sendUnknownUserBadged),
        sendChargingStationStatusError: UtilsSecurity.filterBoolean(notifications.sendChargingStationStatusError),
        sendChargingStationRegistered: UtilsSecurity.filterBoolean(notifications.sendChargingStationRegistered),
        sendOcpiPatchStatusError: UtilsSecurity.filterBoolean(notifications.sendOcpiPatchStatusError),
        sendSmtpError: UtilsSecurity.filterBoolean(notifications.sendSmtpError),
        sendOfflineChargingStations: UtilsSecurity.filterBoolean(notifications.sendOfflineChargingStations),
        sendEndUserErrorNotification: UtilsSecurity.filterBoolean(notifications.sendEndUserErrorNotification),
        sendComputeAndApplyChargingProfilesFailed: UtilsSecurity.filterBoolean(notifications.sendComputeAndApplyChargingProfilesFailed),
        sendAdminAccountVerificationNotification: UtilsSecurity.filterBoolean(notifications.sendAdminAccountVerificationNotification),
      };
    }
    return filteredNotifications;
  }

  private static _filterUserRequest(request: any, loggedUser: UserToken): Partial<User> {
    const filteredRequest: Partial<User> = {};
    if (request.costCenter) {
      filteredRequest.costCenter = sanitize(request.costCenter);
    }
    if (request.firstName) {
      filteredRequest.firstName = sanitize(request.firstName);
    }
    if (request.iNumber) {
      filteredRequest.iNumber = sanitize(request.iNumber);
    }
    if (request.image) {
      filteredRequest.image = sanitize(request.image);
    }
    if (request.mobile) {
      filteredRequest.mobile = sanitize(request.mobile);
    }
    if (request.name) {
      filteredRequest.name = sanitize(request.name);
    }
    if (request.locale) {
      filteredRequest.locale = sanitize(request.locale);
    }
    if (request.address) {
      filteredRequest.address = UtilsSecurity.filterAddressRequest(request.address);
    }
    if (request.passwords && request.passwords.password && request.passwords.password.length > 0) {
      filteredRequest.password = sanitize(request.passwords.password);
    }
    if (request.phone) {
      filteredRequest.phone = sanitize(request.phone);
    }
    if (request.email) {
      filteredRequest.email = sanitize(request.email);
    }
    if (Utils.objectHasProperty(request, 'issuer')) {
      filteredRequest.issuer = UtilsSecurity.filterBoolean(request.issuer);
    }
    if (Utils.objectHasProperty(request, 'notificationsActive')) {
      filteredRequest.notificationsActive = sanitize(request.notificationsActive);
    }
    // Admin?
    if (Authorizations.isAdmin(loggedUser) || Authorizations.isSuperAdmin(loggedUser)) {
      // Ok to set the sensitive data
      if (request.status) {
        filteredRequest.status = sanitize(request.status);
      }
      if (request.plateID) {
        filteredRequest.plateID = sanitize(request.plateID);
      }
      if (request.role) {
        filteredRequest.role = sanitize(request.role);
      }
    }
    if (request.notifications) {
      filteredRequest.notifications = UserSecurity.filterNotificationsRequest(request.role, request.notifications);
    }
    return filteredRequest;
  }
}
