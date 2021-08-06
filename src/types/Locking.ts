import Tenant from './Tenant';

export default interface Lock {
  id?: string;
  tenant: Tenant;
  entity: LockEntity;
  key: string;
  type: LockType;
  timestamp: Date;
  expirationDate?: Date;
  hostname: string;
}

export enum LockType {
  EXCLUSIVE = 'E'
}

export enum LockEntity {
  DATABASE = 'database',
  DATABASE_INDEX = 'database-index',
  CHARGING_STATION = 'charging-station',
  SITE_AREA = 'site-area',
  USER = 'user',
  LOGGING = 'logging',
  PERFORMANCE = 'performance',
  TRANSACTION = 'transaction',
  CAR = 'car',
  CAR_CATALOG = 'car-catalog',
  INVOICE = 'invoice',
  ASSET = 'asset',
  OCPI_ENDPOINT = 'ocpi-endpoint',
  TAG = 'tag',
  OICP_ENDPOINT = 'oicp-endpoint',
  ASYNC_TASK = 'async-task',
}
