import type {
  API,
  AccessoryConfig,
  AccessoryPlugin,
  Logging,
} from "homebridge";
import { AirPurifierAccessory } from "./accessories/air-purifier";
import { DeviceClient } from "./core/device-client";
import { ModernMiioTransport } from "./core/miio-transport";
import type { AirPurifierModel } from "./core/types";

export const ACCESSORY_NAME = "XiaomiMiAirPurifier";
export const PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern";

type XiaomiAccessoryConfig = AccessoryConfig & {
  address?: string;
  token?: string;
  model?: AirPurifierModel;
};

const assertString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid or missing config field: ${field}`);
  }

  return value;
};

export class XiaomiAirPurifierAccessoryPlugin implements AccessoryPlugin {
  private readonly delegate: AirPurifierAccessory;

  public constructor(
    private readonly log: Logging,
    config: AccessoryConfig,
    private readonly api: API,
  ) {
    const typedConfig = config as XiaomiAccessoryConfig;
    const name = assertString(typedConfig.name, "name");
    const address = assertString(typedConfig.address, "address");
    const token = assertString(typedConfig.token, "token");
    const model = assertString(typedConfig.model, "model") as AirPurifierModel;

    const transport = new ModernMiioTransport({
      address,
      token,
      model,
    });
    const client = new DeviceClient(transport, this.log);
    this.delegate = new AirPurifierAccessory(
      this.api,
      this.log,
      name,
      client,
      model,
    );
  }

  public getServices() {
    return this.delegate.getServices();
  }
}
