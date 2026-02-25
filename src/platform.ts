import type { AccessoryConfig, AccessoryPlugin, API, Logging } from "homebridge";
import { AirPurifierAccessory } from "./accessories/air-purifier";
import { DeviceClient } from "./core/device-client";
import { ModernMiioTransport } from "./core/miio-transport";
import { DEFAULT_RETRY_POLICY } from "./core/retry";
import type { AirPurifierModel } from "./core/types";

export const ACCESSORY_NAME = "XiaomiMiAirPurifier";

const VALID_MODELS: readonly AirPurifierModel[] = [
  "zhimi.airpurifier.2h",
  "zhimi.airpurifier.3",
  "zhimi.airpurifier.3h",
  "zhimi.airpurifier.4",
  "zhimi.airpurifier.pro",
];
export const PLUGIN_NAME = "homebridge-xiaomi-air-purifier-modern";

type XiaomiAccessoryConfig = AccessoryConfig & {
  address?: string;
  token?: string;
  model?: AirPurifierModel;
  filterChangeThreshold?: number;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
  reconnectDelayMs?: number;
  keepAliveIntervalMs?: number;
  exposeFilterReplaceAlertSensor?: boolean;
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
      "Config field 'token' must be a 32-character hexadecimal string (e.g. 00112233445566778899aabbccddeeff).",
    );
  }

  return value;
};

const normalizeThreshold = (value: unknown): number => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return 10;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
};

const normalizeTimeout = (value: unknown, fallbackMs: number, minMs = 100): number => {
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
    const model = assertString(typedConfig.model, "model") as AirPurifierModel;
    if (!VALID_MODELS.includes(model)) {
      log.warn(
        `Unrecognized model "${model}". Supported models: ${VALID_MODELS.join(", ")}. Proceeding anyway — protocol auto-detection will be used.`,
      );
    }
    const filterChangeThreshold = normalizeThreshold(typedConfig.filterChangeThreshold);
    const connectTimeoutMs = normalizeTimeout(typedConfig.connectTimeoutMs, 15_000);
    const operationTimeoutMs = normalizeTimeout(typedConfig.operationTimeoutMs, 15_000);
    const reconnectDelayMs = normalizeTimeout(typedConfig.reconnectDelayMs, 15_000);
    const keepAliveIntervalMs = normalizeTimeout(typedConfig.keepAliveIntervalMs, 60_000, 1_000);
    const exposeFilterReplaceAlertSensor = normalizeBoolean(
      typedConfig.exposeFilterReplaceAlertSensor,
      false,
    );

    const transport = new ModernMiioTransport(
      { address, token, model, connectTimeoutMs, operationTimeoutMs },
      this.log,
    );
    const client = new DeviceClient(transport, this.log, {
      keepAliveIntervalMs,
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        baseDelayMs: reconnectDelayMs,
      },
    });
    this.delegate = new AirPurifierAccessory(
      this.api,
      this.log,
      name,
      address,
      client,
      model,
      filterChangeThreshold,
      exposeFilterReplaceAlertSensor,
    );
  }

  public getServices() {
    return this.delegate.getServices();
  }
}
