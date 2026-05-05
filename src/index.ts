import type { API } from "homebridge" with { "resolution-mode": "import" };
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  XiaomiAirPurifierPlatform,
} from "./platform";

export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, XiaomiAirPurifierPlatform);
};
