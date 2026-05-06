import { isIP } from "node:net";
import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge" with { "resolution-mode": "import" };
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
const TOKEN_PATTERN = /^[0-9a-fA-F]{32}$/;

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

export interface ValidatedDeviceConfig {
  name: string;
  address: string;
  token: string;
  model: AirPurifierModel;
}

export const maskAddress = (address: string): string => {
  const segments = address.split(".");
  if (segments.length !== 4) {
    return "[masked]";
  }

  return `${segments[0]}.${segments[1]}.*.*`;
};

const trimOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const formatDeviceLabel = (
  config: DeviceConfig,
  index: number,
): string => {
  const number = `#${index + 1}`;
  const name = trimOrEmpty(config.name);
  return name ? `${number} ("${name}")` : number;
};

export const validateDeviceConfig = (
  config: DeviceConfig,
): ValidatedDeviceConfig => {
  const missing: string[] = [];
  const invalid: string[] = [];

  const name = trimOrEmpty(config.name);
  if (!name) {
    missing.push("name");
  }

  const address = trimOrEmpty(config.address);
  if (!address) {
    missing.push("address");
  } else if (isIP(address) !== 4) {
    invalid.push("address");
  }

  const token = trimOrEmpty(config.token);
  if (!token) {
    missing.push("token");
  } else if (!TOKEN_PATTERN.test(token)) {
    invalid.push("token");
  }

  const model = trimOrEmpty(config.model);
  if (!model) {
    missing.push("model");
  } else if (!VALID_MODELS.has(model as AirPurifierModel)) {
    invalid.push("model");
  }

  if (missing.length > 0 || invalid.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      const label =
        missing.length === 1
          ? "missing required config field"
          : "missing required config fields";
      parts.push(`${label}: ${missing.join(", ")}`);
    }
    if (invalid.length > 0) {
      const label =
        invalid.length === 1 ? "invalid config field" : "invalid config fields";
      parts.push(`${label}: ${invalid.join(", ")}`);
    }
    throw new Error(parts.join("; "));
  }

  return {
    name,
    address,
    token,
    model: model as AirPurifierModel,
  };
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
    this.devices.forEach((deviceConfig, index) => {
      try {
        this.setupDevice(deviceConfig);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const label = formatDeviceLabel(deviceConfig, index);
        this.log.error(`Failed to configure device ${label}: ${message}`);
      }
    });

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
    const { name, address, token, model } = validateDeviceConfig(deviceConfig);
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
