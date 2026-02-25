import type { API } from "homebridge";
import { ACCESSORY_NAME, PLUGIN_NAME, XiaomiAirPurifierAccessoryPlugin } from "./platform";

export = (api: API): void => {
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, XiaomiAirPurifierAccessoryPlugin);
};
