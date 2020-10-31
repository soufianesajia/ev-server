import { ServerAction } from './Server';
import User from './User';

export interface Log {
  tenantID: string;
  id?: string;
  level?: LogLevel;
  source?: string;
  host?: string;
  process?: string;
  module: string;
  method: string;
  timestamp?: Date;
  action?: ServerAction;
  type?: LogType;
  message: string;
  user?: User;
  actionOnUser?: User;
  hasDetailedMessages?: boolean;
  detailedMessages?: any;
}

export enum LogLevel {
  DEBUG = 'D',
  INFO = 'I',
  WARNING = 'W',
  ERROR = 'E',
  NONE = 'NONE',
  DEFAULT = 'DEFAULT',
}

export enum LogType {
  REGULAR = 'R',
  SECURITY = 'S',
}
