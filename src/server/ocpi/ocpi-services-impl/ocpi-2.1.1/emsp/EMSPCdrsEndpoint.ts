import { NextFunction, Request, Response } from 'express';

import AbstractEndpoint from '../../AbstractEndpoint';
import AbstractOCPIService from '../../../AbstractOCPIService';
import AppError from '../../../../../exception/AppError';
import Constants from '../../../../../utils/Constants';
import { HTTPError } from '../../../../../types/HTTPError';
import { OCPICdr } from '../../../../../types/ocpi/OCPICdr';
import OCPIEndpoint from '../../../../../types/ocpi/OCPIEndpoint';
import { OCPIResponse } from '../../../../../types/ocpi/OCPIResponse';
import { OCPIStatusCode } from '../../../../../types/ocpi/OCPIStatusCode';
import OCPIUtils from '../../../OCPIUtils';
import OCPIUtilsService from '../OCPIUtilsService';
import Tenant from '../../../../../types/Tenant';
import Transaction from '../../../../../types/Transaction';
import TransactionStorage from '../../../../../storage/mongodb/TransactionStorage';

const MODULE_NAME = 'EMSPCdrsEndpoint';

export default class EMSPCdrsEndpoint extends AbstractEndpoint {
  public constructor(ocpiService: AbstractOCPIService) {
    super(ocpiService, 'cdrs');
  }

  public async process(req: Request, res: Response, next: NextFunction, tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<OCPIResponse> {
    switch (req.method) {
      case 'GET':
        return await this.getCdrRequest(req, res, next, tenant);
      case 'POST':
        return await this.postCdrRequest(req, res, next, tenant);
    }
  }

  private async getCdrRequest(req: Request, res: Response, next: NextFunction, tenant: Tenant): Promise<OCPIResponse> {
    const urlSegment = req.path.substring(1).split('/');
    // Remove action
    urlSegment.shift();
    // Get filters
    const id = urlSegment.shift();
    if (!id) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        module: MODULE_NAME, method: 'getCdrRequest',
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Missing request parameters',
        ocpiError: OCPIStatusCode.CODE_2001_INVALID_PARAMETER_ERROR
      });
    }
    const transaction: Transaction = await TransactionStorage.getOCPITransaction(tenant.id, id);
    if (!transaction || !transaction.ocpiData || !transaction.ocpiData.cdr) {
      throw new AppError({
        source: Constants.CENTRAL_SERVER,
        module: MODULE_NAME, method: 'getCdrRequest',
        errorCode: HTTPError.GENERAL_ERROR,
        message: `The CDR ID '${id}' does not exist or does not belong to the requester`,
        ocpiError: OCPIStatusCode.CODE_2001_INVALID_PARAMETER_ERROR
      });
    }
    return OCPIUtils.success(transaction.ocpiData.cdr);
  }

  private async postCdrRequest(req: Request, res: Response, next: NextFunction, tenant: Tenant): Promise<OCPIResponse> {
    const cdr: OCPICdr = req.body as OCPICdr;
    await OCPIUtilsService.processCdr(tenant.id, cdr);
    res.setHeader('Location', OCPIUtils.buildLocationUrl(req, this.getBaseUrl(req), cdr.id));
    return OCPIUtils.success({});
  }
}
