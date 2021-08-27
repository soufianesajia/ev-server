import DynamicAuthorizationDataSource from '../authorization/DynamicAuthorizationDataSource';

export interface AuthorizationDefinition {
  superAdmin: {
    grants: Grant[];
    $extend?: any;
  };
  admin: {
    grants: Grant[];
    $extend?: any;
  };
  basic: {
    grants: Grant[];
    $extend?: any;
  };
  demo: {
    grants: Grant[];
    $extend?: any;
  };
  siteAdmin: {
    grants: Grant[];
    $extend?: any;
  };
  siteOwner: {
    grants: Grant[];
    $extend?: any;
  };
}

export interface AuthorizationResult {
  authorized: boolean;
  fields: string[];
}

export interface AuthorizationFilter {
  filters: Record<string, any>;
  projectFields: string[];
  authorized: boolean;
  dataSources: Map<DynamicAuthorizationDataSourceName, DynamicAuthorizationDataSource<DynamicAuthorizationDataSourceData>>;
}

export interface Grant {
  resource: Entity;
  action: Action | Action[];
  attributes?: string[];
  args?: any;
  condition?: any;
}

export enum Entity {
  SITE = 'Site',
  SITES = 'Sites',
  SITE_AREA = 'SiteArea',
  SITE_AREAS = 'SiteAreas',
  COMPANY = 'Company',
  COMPANIES = 'Companies',
  CHARGING_STATION = 'ChargingStation',
  CHARGING_STATIONS = 'ChargingStations',
  TENANT = 'Tenant',
  TENANTS = 'Tenants',
  TRANSACTION = 'Transaction',
  TRANSACTIONS = 'Transactions',
  TRANSACTION_METER_VALUES = 'MeterValues',
  TRANSACTION_STOP = 'Stop',
  REPORT = 'Report',
  USER = 'User',
  USERS = 'Users',
  USERS_SITES = 'UsersSites',
  LOGGINGS = 'Loggings',
  LOGGING = 'Logging',
  PRICING = 'Pricing',
  BILLING = 'Billing',
  SETTING = 'Setting',
  SETTINGS = 'Settings',
  TOKENS = 'Tokens',
  TOKEN = 'Token',
  ASYNC_TASK = 'AsyncTask',
  ASYNC_TASKS = 'AsyncTasks',
  OCPI_ENDPOINT = 'OcpiEndpoint',
  OCPI_ENDPOINTS = 'OcpiEndpoints',
  OICP_ENDPOINT = 'OicpEndpoint',
  OICP_ENDPOINTS = 'OicpEndpoints',
  CONNECTION = 'Connection',
  CONNECTIONS = 'Connections',
  ASSET = 'Asset',
  ASSETS = 'Assets',
  CAR_CATALOG = 'CarCatalog',
  CAR_CATALOGS = 'CarCatalogs',
  CAR = 'Car',
  CARS = 'Cars',
  INVOICE = 'Invoice',
  INVOICES = 'Invoices',
  TAXES = 'Taxes',
  REGISTRATION_TOKEN = 'RegistrationToken',
  REGISTRATION_TOKENS = 'RegistrationTokens',
  CHARGING_PROFILE = 'ChargingProfile',
  CHARGING_PROFILES = 'ChargingProfiles',
  NOTIFICATION = 'Notification',
  TAGS = 'Tags',
  TAG = 'Tag',
  PAYMENT_METHOD = 'PaymentMethod',
  PAYMENT_METHODS = 'PaymentMethods',
}

export enum Action {
  READ = 'Read',
  CREATE = 'Create',
  UPDATE = 'Update',
  REPLACE = 'Replace',
  DELETE = 'Delete',
  LOGOUT = 'Logout',
  LOGIN = 'Login',
  LIST = 'List',
  IN_ERROR = 'InError',
  RESET = 'Reset',
  ASSIGN = 'Assign',
  UNASSIGN = 'Unassign',
  CLEAR_CACHE = 'ClearCache',
  TRIGGER_DATA_TRANSFER = 'DataTransfer',
  SYNCHRONIZE = 'Synchronize',
  GET_CONFIGURATION = 'GetConfiguration',
  CHANGE_CONFIGURATION = 'ChangeConfiguration',
  SYNCHRONIZE_CAR_CATALOGS = 'SynchronizeCarCatalogs',
  REMOTE_START_TRANSACTION = 'RemoteStartTransaction',
  REMOTE_STOP_TRANSACTION = 'RemoteStopTransaction',
  START_TRANSACTION = 'StartTransaction',
  STOP_TRANSACTION = 'StopTransaction',
  UNLOCK_CONNECTOR = 'UnlockConnector',
  AUTHORIZE = 'Authorize',
  SET_CHARGING_PROFILE = 'SetChargingProfile',
  GET_COMPOSITE_SCHEDULE = 'GetCompositeSchedule',
  CLEAR_CHARGING_PROFILE = 'ClearChargingProfile',
  GET_DIAGNOSTICS = 'GetDiagnostics',
  UPDATE_FIRMWARE = 'UpdateFirmware',
  EXPORT = 'Export',
  CHANGE_AVAILABILITY = 'ChangeAvailability',
  REFUND_TRANSACTION = 'RefundTransaction',
  SYNCHRONIZE_BILLING_USERS = 'SynchronizeBillingUsers',
  SYNCHRONIZE_BILLING_USER = 'SynchronizeBillingUser',
  BILLING_SETUP_PAYMENT_METHOD = 'BillingSetupPaymentMethod',
  BILLING_PAYMENT_METHODS = 'BillingPaymentMethods',
  BILLING_DELETE_PAYMENT_METHOD = 'BillingDeletePaymentMethod',
  BILLING_CHARGE_INVOICE = 'BillingChargeInvoice',
  CHECK_CONNECTION = 'CheckConnection',
  CLEAR_BILLING_TEST_DATA = 'ClearBillingTestData',
  RETRIEVE_CONSUMPTION = 'RetrieveConsumption',
  CREATE_CONSUMPTION = 'CreateConsumption',
  PING = 'Ping',
  GENERATE_LOCAL_TOKEN = 'GenerateLocalToken',
  REGISTER = 'Register',
  TRIGGER_JOB = 'TriggerJob',
  DOWNLOAD = 'Download',
  IMPORT = 'Import',
  ASSIGN_USERS_TO_SITE = 'AssignUsersToSite',
  UNASSIGN_USERS_TO_SITE = 'UnassignUsersToSite',
  ASSIGN_ASSETS_TO_SITE_AREA = 'AssignAssetsToSiteArea',
  UNASSIGN_ASSETS_TO_SITE_AREA = 'UnassignAssetsToSiteArea',
  ASSIGN_CHARGING_STATIONS_TO_SITE_AREA = 'AssignChargingStationsToSiteArea',
  UNASSIGN_CHARGING_STATIONS_TO_SITE_AREA = 'UnassignChargingStationsToSiteArea',
  EXPORT_OCPP_PARAMS = 'ExportOCPPParams',
  GENERATE_QR = 'GenerateQrCode',
}

export interface AuthorizationContext {
  tagIDs?: string[];
  tagID?: string;
  owner?: string;
  site?: string;
  sites?: string[];
  sitesAdmin?: string[];
  user?: string;
  UserID?: string;
  sitesOwner?: string[];
  company?: string;
  companies?: string[];
  asset?: string;
  assets?: string[];
  filters?: DynamicAuthorizationFilterName[] | [DynamicAuthorizationFilterName[]];
  asserts?: DynamicAuthorizationAssertName[] | [DynamicAuthorizationAssertName[]];
}

export interface AuthorizationActions {
  canRead?: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}
export interface SiteAreaAuthorizationActions extends AuthorizationActions {
  canAssignAssets?: boolean;
  canUnassignAssets?: boolean;
  canAssignChargingStations?: boolean;
  canUnassignChargingStations?: boolean;
  canExportOCPPParams?: boolean;
  canGenerateQrCode?:boolean;
}

export interface SiteAuthorizationActions extends AuthorizationActions {
  canAssignUsers?: boolean;
  canUnassignUsers?: boolean;
  canExportOCPPParams?: boolean;
  canGenerateQrCode?: boolean;
}

export enum DynamicAuthorizationFilterName {
  ASSIGNED_SITES_COMPANIES = 'AssignedSitesCompanies',
  SITES_ADMIN = 'SitesAdmin',
  SITES_OWNER = 'SitesOwner',
  ASSIGNED_SITES = 'AssignedSites',
  OWN_USER = 'OwnUser',
  LOCAL_ISSUER = 'LocalIssuer',
}

export enum DynamicAuthorizationAssertName {
  POOL_CAR = 'PoolCar',
  OWN_USER = 'OwnUser',
}

export enum DynamicAuthorizationDataSourceName {
  ASSIGNED_SITES_COMPANIES = 'AssignedSitesCompanies',
  SITES_ADMIN = 'SitesAdmin',
  SITES_OWNER = 'SitesOwner',
  ASSIGNED_SITES = 'AssignedSites',
  OWN_USER = 'OwnUser',
}

export interface DynamicAuthorizationDataSourceData {}

export interface AssignedSitesCompaniesDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  companyIDs?: string[];
}

export interface SitesAdminDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  siteIDs?: string[];
}

export interface SitesOwnerDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  siteIDs?: string[];
}

export interface AssignedSitesDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  siteIDs?: string[];
}

export interface SiteAdminUsersDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  userIDs?: string[];
}

export interface OwnUserDynamicAuthorizationDataSourceData extends DynamicAuthorizationDataSourceData {
  userID?: string;
}
