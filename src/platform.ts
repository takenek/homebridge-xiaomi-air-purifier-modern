import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { AirPurifierAccessory } from "./accessories/air-purifier";
import { DeviceClient } from "./core/device-client";
import { ModernMiioTransport } from "./core/miio-transport";
import { DEFAULT_RETRY_POLICY } from "./core/retry";
import type { AirPurifierModel } from "./core/types";

export const PLATFORM_NAME = "XiaomiMiAirPurifier";
export const PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern";

const SUPPORTED_MODELS: readonly AirPurifierModel[] = [
  "zhimi.airpurifier.2h",
  "zhimi.airpurifier.3",
  "zhimi.airpurifier.3h",
  "zhimi.airpurifier.4",
  "zhimi.airpurifier.pro",
];
const VALID_MODELS = new Set<AirPurifierModel>(SUPPORTED_MODELS);

export interface DeviceConfig {
  name?: string;
  address?: string;
  token?: string;
  model?: string;
  enableAirQuality?: boolean;
  enableTemperature?: boolean;
  enableHumidity?: boolean;
  filterChangeThreshold?: number;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
  reconnectDelayMs?: number;
  keepAliveIntervalMs?: number;
  operationPollIntervalMs?: number;
  sensorPollIntervalMs?: number;
  exposeFilterReplaceAlertSensor?: boolean;
  enableChildLockControl?: boolean;
  maskDeviceAddressInLogs?: boolean;
}

export const maskAddress = (address: string): string => {
  const segments = address.split(".");
  if (segments.length !== 4) {
    return "[masked]";
  }

  return `${segments[0]}.${segments[1]}.*.*`;
};

export const assertString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid or missing config field: ${field}`);
  }

  return value;
};

export const assertHexToken = (value: string): string => {
  if (!/^[0-9a-fA-F]{32}$/.test(value)) {
    throw new Error(
      "Invalid config field: token must be a 32-character hexadecimal string.",
    );
  }

  return value;
};

export const normalizeModel = (
  value: string,
  log: Logging,
): AirPurifierModel => {
  if (VALID_MODELS.has(value as AirPurifierModel)) {
    return value as AirPurifierModel;
  }

  log.error(`Unsupported model configured: "${value}".`);
  throw new Error(
    `Unsupported model: ${value}. Supported models: ${SUPPORTED_MODELS.join(", ")}.`,
  );
};

export const normalizeThreshold = (value: unknown): number => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return 10;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
};

export const normalizeTimeout = (
  value: unknown,
  fallbackMs: number,
  minMs = 100,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.max(minMs, Math.round(value));
};

export const normalizeBoolean = (
  value: unknown,
  fallback: boolean,
): boolean => {
  if (typeof value !== "boolean") {
    return fallback;
  }

  return value;
};

export class XiaomiAirPurifierPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly activeAccessoryUuids = new Set<string>();
  private readonly devices: DeviceConfig[];

  public constructor(
    private readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    this.devices = Array.isArray(config.devices) ? config.devices : [];

    this.log.debug(
      "Platform initialized with %d device(s).",
      this.devices.length,
    );

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug("Restoring cached accessory: %s", accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private discoverDevices(): void {
    for (const deviceConfig of this.devices) {
      try {
        this.setupDevice(deviceConfig);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to configure device: ${message}`);
      }
    }

    const staleAccessories = this.cachedAccessories.filter(
      (accessory) => !this.activeAccessoryUuids.has(accessory.UUID),
    );
    if (staleAccessories.length > 0) {
      this.log.info(
        "Removing %d stale cached accessory(ies).",
        staleAccessories.length,
      );
      this.api.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        staleAccessories,
      );
    }
  }

  private setupDevice(deviceConfig: DeviceConfig): void {
    const name = assertString(deviceConfig.name, "name");
    const address = assertString(deviceConfig.address, "address");
    const token = assertHexToken(assertString(deviceConfig.token, "token"));
    const model = normalizeModel(
      assertString(deviceConfig.model, "model"),
      this.log,
    );
    const filterChangeThreshold = normalizeThreshold(
      deviceConfig.filterChangeThreshold,
    );
    const enableAirQuality = normalizeBoolean(
      deviceConfig.enableAirQuality,
      true,
    );
    const enableTemperature = normalizeBoolean(
      deviceConfig.enableTemperature,
      true,
    );
    const enableHumidity = normalizeBoolean(deviceConfig.enableHumidity, true);
    const connectTimeoutMs = normalizeTimeout(
      deviceConfig.connectTimeoutMs,
      15_000,
    );
    const operationTimeoutMs = normalizeTimeout(
      deviceConfig.operationTimeoutMs,
      15_000,
    );
    const reconnectDelayMs = normalizeTimeout(
      deviceConfig.reconnectDelayMs,
      15_000,
    );
    const keepAliveIntervalMs = normalizeTimeout(
      deviceConfig.keepAliveIntervalMs,
      60_000,
      1_000,
    );
    const operationPollIntervalMs = normalizeTimeout(
      deviceConfig.operationPollIntervalMs,
      10_000,
      1_000,
    );
    const sensorPollIntervalMs = normalizeTimeout(
      deviceConfig.sensorPollIntervalMs,
      30_000,
      1_000,
    );
    const exposeFilterReplaceAlertSensor = normalizeBoolean(
      deviceConfig.exposeFilterReplaceAlertSensor,
      false,
    );
    const enableChildLockControl = normalizeBoolean(
      deviceConfig.enableChildLockControl,
      false,
    );

    const maskDeviceAddressInLogs = normalizeBoolean(
      deviceConfig.maskDeviceAddressInLogs,
      false,
    );
    const displayAddress = maskDeviceAddressInLogs
      ? maskAddress(address)
      : address;

    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${address}`);
    this.activeAccessoryUuids.add(uuid);

    let platformAccessory = this.cachedAccessories.find(
      (acc) => acc.UUID === uuid,
    );
    let isNew = false;

    if (!platformAccessory) {
      platformAccessory = new this.api.platformAccessory(name, uuid);
      isNew = true;
    }

    const transport = new ModernMiioTransport({
      address,
      token,
      model,
      connectTimeoutMs,
      operationTimeoutMs,
      logger: this.log,
    });
    const client = new DeviceClient(transport, this.log, {
      operationPollIntervalMs,
      sensorPollIntervalMs,
      keepAliveIntervalMs,
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        maxDelayMs: reconnectDelayMs,
      },
    });

    new AirPurifierAccessory(
      this.api,
      this.log,
      name,
      displayAddress,
      client,
      model,
      filterChangeThreshold,
      {
        enableAirQuality,
        enableTemperature,
        enableHumidity,
        exposeFilterReplaceAlertSensor,
        enableChildLockControl,
      },
      platformAccessory,
    );

    if (isNew) {
      this.log.info("Registering new accessory: %s", name);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        platformAccessory,
      ]);
    } else {
      this.log.info("Updating existing accessory: %s", name);
      this.api.updatePlatformAccessories([platformAccessory]);
    }
  }
}
