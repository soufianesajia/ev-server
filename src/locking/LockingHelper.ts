import Lock, { LockEntity } from '../types/Locking';

import Asset from '../types/Asset';
import AsyncTask from '../types/AsyncTask';
import Constants from '../utils/Constants';
import LockingManager from './LockingManager';
import OCPIEndpoint from '../types/ocpi/OCPIEndpoint';
import OICPEndpoint from '../types/oicp/OICPEndpoint';
import SiteArea from '../types/SiteArea';
import Tenant from '../types/Tenant';

export default class LockingHelper {
  public static async acquireAsyncTaskLock(tenant: Tenant, asyncTask: AsyncTask): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.ASYNC_TASK, `${asyncTask.id}`, 300);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireSiteAreaSmartChargingLock(tenant: Tenant, siteArea: SiteArea, timeoutSecs: number): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.SITE_AREA, `${siteArea.id}-smart-charging`, 180);
    if (!(await LockingManager.acquire(lock, timeoutSecs))) {
      return null;
    }
    return lock;
  }

  public static async acquireBillingSyncUsersLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.USER, 'synchronize-billing-users');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireImportUsersLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.USER, 'import-users');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireImportTagsLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.TAG, 'import-tags');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireSyncCarCatalogsLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.CAR_CATALOG, 'synchronize-car-catalogs');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireBillingSyncInvoicesLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.INVOICE, 'synchronize-billing-invoices');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireBillingPeriodicOperationLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.INVOICE, 'periodic-billing');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireAssetRetrieveConsumptionsLock(tenant: Tenant, asset: Asset): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.ASSET, `${asset.id}-consumptions`);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireOCPIPushCpoCdrsLock(tenant: Tenant): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.TRANSACTION, 'push-cdrs');
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async createOCPIPushTokensLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'push-tokens');
  }

  public static async acquireOCPIPushCdrLock(tenant: Tenant, transactionID: number): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.TRANSACTION, `push-cdr-${transactionID}`);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async createOCPIPullTokensLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint, partial: boolean): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, `pull-tokens${partial ? '-partial' : ''}`);
  }

  public static async createOCPICheckCdrsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'check-cdrs');
  }

  public static async createOCPICheckLocationsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'check-locations');
  }

  public static async createOCPICheckSessionsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'check-sessions');
  }

  public static async createOCPIPullCdrsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'pull-cdrs');
  }

  public static async createOCPIPullLocationsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'pull-locations');
  }

  public static async createOCPIPullSessionsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'pull-sessions');
  }

  public static async createOCPIPatchLocationsLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock | null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'patch-locations');
  }

  public static async createOCPIPatchEVSEStatusesLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<Lock|null> {
    return LockingHelper.acquireOCPIEndpointActionLock(tenant, ocpiEndpoint, 'patch-evse-statuses');
  }

  public static async createOICPPatchEVSEsLock(tenant: Tenant, oicpEndpoint: OICPEndpoint): Promise<Lock|null> {
    return LockingHelper.acquireOICPEndpointActionLock(tenant, oicpEndpoint, 'patch-evses');
  }

  public static async createOICPPatchEvseStatusesLock(tenant: Tenant, oicpEndpoint: OICPEndpoint): Promise<Lock|null> {
    return LockingHelper.acquireOICPEndpointActionLock(tenant, oicpEndpoint, 'patch-evse-statuses');
  }

  public static async acquireOICPPushCdrLock(tenant: Tenant, transactionID: number): Promise<Lock|null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.TRANSACTION, `push-cdr-${transactionID}`);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  public static async acquireBillUserLock(tenant: Tenant, userID: string): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.USER, `bill-user-${userID}`);
    // ----------------------------------------------------------------------------------------
    // We may have concurrent attempts to create an invoice when running billing async tasks.
    // On the otherhand, we cannot just give up too early in case of conflicts
    // To prevent such situation, we have here a timeout of 60 seconds.
    // This means that we assume here that the billing concrete layer (stripe) will be able to
    // create within a minute both the invoice item and the corresponding invoice.
    // ----------------------------------------------------------------------------------------
    if (!(await LockingManager.acquire(lock, 60 /* , timeoutSecs) */))) {
      return null;
    }
    return lock;
  }

  public static async acquireChargingStationLock(tenant: Tenant, chargingStationID: string): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.CHARGING_STATION,
      `${chargingStationID}`, Constants.CHARGING_STATION_LOCK_SECS);
    if (!(await LockingManager.acquire(lock, Constants.CHARGING_STATION_LOCK_SECS * 2))) {
      return null;
    }
    return lock;
  }

  private static async acquireOCPIEndpointActionLock(tenant: Tenant, ocpiEndpoint: OCPIEndpoint, action: string): Promise<Lock | null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.OCPI_ENDPOINT, `${ocpiEndpoint.id}-${action}`);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }

  private static async acquireOICPEndpointActionLock(tenant: Tenant, oicpEndpoint: OICPEndpoint, action: string): Promise<Lock|null> {
    const lock = LockingManager.createExclusiveLock(tenant, LockEntity.OICP_ENDPOINT, `${oicpEndpoint.id}-${action}`);
    if (!(await LockingManager.acquire(lock))) {
      return null;
    }
    return lock;
  }
}
