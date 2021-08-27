import ChargingStation, { ChargerVendor } from '../../types/ChargingStation';

import ChargingStationVendorIntegration from './ChargingStationVendorIntegration';
import DefaultChargingStationVendorIntegration from './default/DefaultChargingStationVendorIntegration';
import EVBOXChargingStationVendorIntegration from './evbox/EVBOXChargingStationVendorIntegration';
import KebaChargingStationVendorIntegration from './keba/KebaChargingStationVendorIntegration';

export default class ChargingStationVendorFactory {

  static getChargingStationVendorImpl(chargingStation: ChargingStation): ChargingStationVendorIntegration {
    let chargingStationVendorImpl: ChargingStationVendorIntegration = null;
    switch (chargingStation.chargePointVendor) {
      case ChargerVendor.EVBOX:
        chargingStationVendorImpl = new EVBOXChargingStationVendorIntegration(chargingStation);
        break;
      case ChargerVendor.KEBA:
        chargingStationVendorImpl = new KebaChargingStationVendorIntegration(chargingStation);
        break;
      case ChargerVendor.ABB:
      case ChargerVendor.ARK_AC_EV_CHARGER:
      case ChargerVendor.DBTCEV:
      case ChargerVendor.SCHNEIDER:
      case ChargerVendor.EVMETER:
      case ChargerVendor.INNOGY:
      case ChargerVendor.INGETEAM:
      case ChargerVendor.IES:
      case ChargerVendor.WALLBOX_CHARGERS:
      case ChargerVendor.ENPLUS:
      case ChargerVendor.EXADYS:
      case ChargerVendor.EBEE:
      case ChargerVendor.BENDER:
      case ChargerVendor.WEBASTO:
      case ChargerVendor.MENNEKES:
      case ChargerVendor.DELTA_ELECTRONICS:
      case ChargerVendor.DELTA:
      case ChargerVendor.LEGRAND:
      case ChargerVendor.ATESS:
      case ChargerVendor.SAP_LABS_FRANCE:
      case ChargerVendor.CIRCONTROL:
      case ChargerVendor.JOINON:
      case ChargerVendor.LAFON_TECHNOLOGIES:
      case ChargerVendor.ALFEN:
      case ChargerVendor.ALPITRONIC:
      case ChargerVendor.CFOS:
      case ChargerVendor.ECOTAP:
      case ChargerVendor.EFACEC:
      case ChargerVendor.HDM:
      case ChargerVendor.HAGER:
      case ChargerVendor.JOINT:
      case ChargerVendor.AIXCHARGE:
      case ChargerVendor.TRITIUM:
      case ChargerVendor.GREEN_MOTION:
      case ChargerVendor.NEXANS:
      case ChargerVendor.G2_MOBILITY:
        chargingStationVendorImpl = new DefaultChargingStationVendorIntegration(chargingStation);
        break;
    }
    return chargingStationVendorImpl;
  }
}
