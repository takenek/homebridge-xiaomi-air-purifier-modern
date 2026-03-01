import type {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  Logging,
} from "homebridge";
import { AirPurifierAccessory } from "./accessories/air-purifier";
import { DeviceClient } from "./core/device-client";
import { ModernMiioTransport } from "./core/miio-transport";
import { DEFAULT_RETRY_POLICY } from "./core/retry";
import type { AirPurifierModel } from "./core/types";

export const ACCESSORY_NAME = "XiaomiMiAirPurifier";
export const PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern";

const SUPPORTED_MODELS: readonly AirPurifierModel[] = [
  "zhimi.airpurifier.2h",
  "zhimi.airpurifier.3",
  "zhimi.airpurifier.3h",
  "zhimi.airpurifier.4",
  "zhimi.airpurifier.pro",
];
const VALID_MODELS = new Set<AirPurifierModel>(SUPPORTED_MODELS);

type XiaomiAccessoryConfig = AccessoryConfig & {
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
  enableBuzzerControl?: boolean;
  maskDeviceAddressInLogs?: boolean;
};

const maskAddress = (address: string): string => {
  const segments = address.split(".");
  if (segments.length !== 4) {
    return "[masked]";
  }

  return `${segments[0]}.${segments[1]}.*.*`;
};

const assertString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid or missing config field: ${field}`);
  }

  return value;
};

const assertHexToken = (value: string): string => {
  if (!/^[0-9a-fA-F]{32}$/.test(value)) {
    throw new Error(
      "Invalid config field: token must be a 32-character hexadecimal string.",
    );
  }

  return value;
};

const normalizeModel = (value: string, log: Logging): AirPurifierModel => {
  if (VALID_MODELS.has(value as AirPurifierModel)) {
    return value as AirPurifierModel;
  }

  log.error(`Unsupported model configured: "${value}".`);
  throw new Error(
    `Unsupported model: ${value}. Supported models: ${SUPPORTED_MODELS.join(", ")}.`,
  );
};

const normalizeThreshold = (value: unknown): number => {
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

const normalizeTimeout = (
  value: unknown,
  fallbackMs: number,
  minMs = 100,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallbackMs;
  }

  return Math.max(minMs, Math.round(value));
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value !== "boolean") {
    return fallback;
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
    const token = assertHexToken(assertString(typedConfig.token, "token"));
    const model = normalizeModel(
      assertString(typedConfig.model, "model"),
      this.log,
    );
    const filterChangeThreshold = normalizeThreshold(
      typedConfig.filterChangeThreshold,
    );
    const enableAirQuality = normalizeBoolean(
      typedConfig.enableAirQuality,
      true,
    );
    const enableTemperature = normalizeBoolean(
      typedConfig.enableTemperature,
      true,
    );
    const enableHumidity = normalizeBoolean(typedConfig.enableHumidity, true);
    const connectTimeoutMs = normalizeTimeout(
      typedConfig.connectTimeoutMs,
      15_000,
    );
    const operationTimeoutMs = normalizeTimeout(
      typedConfig.operationTimeoutMs,
      15_000,
    );
    const reconnectDelayMs = normalizeTimeout(
      typedConfig.reconnectDelayMs,
      15_000,
    );
    const keepAliveIntervalMs = normalizeTimeout(
      typedConfig.keepAliveIntervalMs,
      60_000,
      1_000,
    );
    const operationPollIntervalMs = normalizeTimeout(
      typedConfig.operationPollIntervalMs,
      10_000,
      1_000,
    );
    const sensorPollIntervalMs = normalizeTimeout(
      typedConfig.sensorPollIntervalMs,
      30_000,
      1_000,
    );
    const exposeFilterReplaceAlertSensor = normalizeBoolean(
      typedConfig.exposeFilterReplaceAlertSensor,
      false,
    );
    const enableChildLockControl = normalizeBoolean(
      typedConfig.enableChildLockControl,
      false,
    );
    const enableBuzzerControl = normalizeBoolean(
      typedConfig.enableBuzzerControl,
      false,
    );
    const maskDeviceAddressInLogs = normalizeBoolean(
      typedConfig.maskDeviceAddressInLogs,
      false,
    );
    const displayAddress = maskDeviceAddressInLogs
      ? maskAddress(address)
      : address;

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
    this.delegate = new AirPurifierAccessory(
      this.api,
      this.log,
      name,
      address,
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
        enableBuzzerControl,
      },
    );
  }

  public getServices() {
    return this.delegate.getServices();
  }
}
