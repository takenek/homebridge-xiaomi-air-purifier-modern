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
  filterChangeThreshold?: number;
};

const assertString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid or missing config field: ${field}`);
  }

  return value;
};

const normalizeThreshold = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
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
    const filterChangeThreshold = normalizeThreshold(
      typedConfig.filterChangeThreshold,
    );

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
      address,
      client,
      model,
      filterChangeThreshold,
    );
  }

  public getServices() {
    return this.delegate.getServices();
  }
}
