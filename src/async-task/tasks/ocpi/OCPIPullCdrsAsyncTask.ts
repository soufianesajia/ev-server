import AbstractAsyncTask from '../../AsyncTask';
import LockingHelper from '../../../locking/LockingHelper';
import LockingManager from '../../../locking/LockingManager';
import Logging from '../../../utils/Logging';
import OCPIClientFactory from '../../../client/ocpi/OCPIClientFactory';
import OCPIEndpointStorage from '../../../storage/mongodb/OCPIEndpointStorage';
import { ServerAction } from '../../../types/Server';
import TenantComponents from '../../../types/TenantComponents';
import TenantStorage from '../../../storage/mongodb/TenantStorage';
import Utils from '../../../utils/Utils';

export default class OCPIPullCdrsAsyncTask extends AbstractAsyncTask {
  protected async executeAsyncTask(): Promise<void> {
    const tenant = await TenantStorage.getTenant(this.asyncTask.tenantID);
    // Check if OCPI component is active
    if (Utils.isTenantComponentActive(tenant, TenantComponents.OCPI)) {
      try {
        // Get the OCPI Endpoint
        const ocpiEndpoint = await OCPIEndpointStorage.getOcpiEndpoint(tenant, this.asyncTask.parameters.endpointID);
        if (!ocpiEndpoint) {
          throw new Error(`Unknown OCPI Endpoint ID '${this.asyncTask.parameters.endpointID}'`);
        }
        const pullCdrsLock = await LockingHelper.createOCPIPullCdrsLock(tenant, ocpiEndpoint);
        if (pullCdrsLock) {
          try {
            // Get the OCPI Client
            const ocpiClient = await OCPIClientFactory.getEmspOcpiClient(tenant, ocpiEndpoint);
            if (!ocpiClient) {
              throw new Error(`OCPI Client not found in Endpoint ID '${this.asyncTask.parameters.endpointID}'`);
            }
            await ocpiClient.pullCdrs();
          } finally {
            // Release the lock
            await LockingManager.release(pullCdrsLock);
          }
        }
      } catch (error) {
        await Logging.logActionExceptionMessage(tenant, ServerAction.OCPI_PULL_CDRS, error);
      }
    }
  }
}
