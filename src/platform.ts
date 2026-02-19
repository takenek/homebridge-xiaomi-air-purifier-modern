import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { AirPurifierAccessory } from "./accessories/air-purifier";
import { DeviceClient } from "./core/device-client";
import { ModernMiioTransport } from "./core/miio-transport";
import type { AirPurifierModel } from "./core/types";

export const PLATFORM_NAME = "XiaomiMiAirPurifier";
export const PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern";

interface DeviceConfig {
  name: string;
  address: string;
  token: string;
  model: AirPurifierModel;
}

interface XiaomiPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
}

export class XiaomiAirPurifierPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];

  public constructor(
    public readonly log: Logger,
    public readonly config: XiaomiPlatformConfig,
    public readonly api: API,
  ) {
    this.api.on("didFinishLaunching", () => {
      void this.discoverDevices();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
    const devices = this.config.devices ?? [];

    for (const deviceConfig of devices) {
      const uuid = this.api.hap.uuid.generate(
        `${deviceConfig.address}-${deviceConfig.token}`,
      );
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid,
      );

      if (existingAccessory) {
        this.log.info(`Restoring accessory from cache: ${deviceConfig.name}`);
        this.attachAccessory(existingAccessory, deviceConfig);
      } else {
        this.log.info(`Adding new accessory: ${deviceConfig.name}`);
        const accessory = new this.api.platformAccessory(
          deviceConfig.name,
          uuid,
        );
        this.attachAccessory(accessory, deviceConfig);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
      }
    }
  }

  private attachAccessory(
    accessory: PlatformAccessory,
    config: DeviceConfig,
  ): void {
    const transport = new ModernMiioTransport({
      address: config.address,
      token: config.token,
      model: config.model,
    });
    const client = new DeviceClient(transport, this.log);
    new AirPurifierAccessory(this, accessory, client, config);
  }
}
