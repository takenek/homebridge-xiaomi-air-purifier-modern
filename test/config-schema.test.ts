import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_SCHEMA_PATH = join(process.cwd(), "config.schema.json");

const REQUIRED_DEVICE_FIELDS = ["name", "address", "token", "model"];

const DEVICE_LAYOUT_KEYS = [
  "devices[].name",
  "devices[].model",
  "devices[].address",
  "devices[].token",
  "devices[].enableAirQuality",
  "devices[].enableTemperature",
  "devices[].enableHumidity",
  "devices[].filterChangeThreshold",
  "devices[].exposeFilterReplaceAlertSensor",
  "devices[].enableChildLockControl",
  "devices[].maskDeviceAddressInLogs",
  "devices[].connectTimeoutMs",
  "devices[].operationTimeoutMs",
  "devices[].reconnectDelayMs",
  "devices[].keepAliveIntervalMs",
  "devices[].operationPollIntervalMs",
  "devices[].sensorPollIntervalMs",
  "devices[].transportResetThreshold",
  "devices[].transportResetCooldownMs",
];

function parseConfigSchema(): unknown {
  return JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  expectation: string,
): Record<string, unknown> {
  expect(isRecord(value), expectation).toBe(true);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, expectation: string): unknown[] {
  expect(Array.isArray(value), expectation).toBe(true);
  return value as unknown[];
}

function requireStringArray(value: unknown, expectation: string): string[] {
  const values = requireArray(value, expectation);
  expect(
    values.every((item) => typeof item === "string"),
    expectation,
  ).toBe(true);
  return values as string[];
}

function requireProperty(
  record: Record<string, unknown>,
  key: string,
  expectation: string,
): Record<string, unknown> {
  return requireRecord(record[key], expectation);
}

function layoutKey(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  const key = entry.key;
  return typeof key === "string" ? key : undefined;
}

function collectLayoutKeys(entry: unknown): string[] {
  const key = layoutKey(entry);
  const keys = key ? [key] : [];

  if (!isRecord(entry)) {
    return keys;
  }

  const items = entry.items;
  if (!Array.isArray(items)) {
    return keys;
  }

  return keys.concat(items.flatMap((item) => collectLayoutKeys(item)));
}

function loadDevicesLayout(
  root: Record<string, unknown>,
): Record<string, unknown> {
  const layout = requireArray(root.layout, "layout must be an array");
  const devicesLayout = layout.find((entry) => layoutKey(entry) === "devices");
  return requireRecord(devicesLayout, "layout must contain a devices entry");
}

describe("config.schema.json", () => {
  it("is valid JSON", () => {
    expect(() => parseConfigSchema()).not.toThrow();
  });

  it("keeps the required devices schema strict", () => {
    const root = requireRecord(
      parseConfigSchema(),
      "schema root must be an object",
    );
    expect(root.strictValidation).toBe(true);

    const schema = requireProperty(root, "schema", "schema must be an object");
    const properties = requireProperty(
      schema,
      "properties",
      "schema.properties must be an object",
    );
    const devices = requireProperty(
      properties,
      "devices",
      "schema.properties.devices must be an object",
    );
    expect(devices.type).toBe("array");

    const deviceItem = requireProperty(
      devices,
      "items",
      "schema.properties.devices.items must be an object",
    );
    expect(deviceItem.additionalProperties).toBe(false);

    const required = requireStringArray(
      deviceItem.required,
      "devices.items.required must be a string array",
    );
    expect(required).toHaveLength(REQUIRED_DEVICE_FIELDS.length);
    expect(new Set(required)).toEqual(new Set(REQUIRED_DEVICE_FIELDS));

    const deviceProperties = requireProperty(
      deviceItem,
      "properties",
      "devices.items.properties must be an object",
    );
    const token = requireProperty(
      deviceProperties,
      "token",
      "devices.items.properties.token must be an object",
    );
    expect(token.pattern).toBe("^[0-9a-fA-F]{32}$");

    const address = requireProperty(
      deviceProperties,
      "address",
      "devices.items.properties.address must be an object",
    );
    expect(address.format).toBe("ipv4");

    const model = requireProperty(
      deviceProperties,
      "model",
      "devices.items.properties.model must be an object",
    );
    const modelOptions = requireArray(
      model.oneOf,
      "devices.items.properties.model.oneOf must be an array",
    );
    const proModelOption = modelOptions.find((option) => {
      if (!isRecord(option)) {
        return false;
      }

      return (
        option.title === "Mi Air Purifier Pro" &&
        Array.isArray(option.enum) &&
        option.enum.includes("zhimi.airpurifier.pro")
      );
    });
    expect(proModelOption).toBeDefined();
  });

  it("keeps the Homebridge Config UI array item layout grouped as one device form", () => {
    const root = requireRecord(
      parseConfigSchema(),
      "schema root must be an object",
    );
    const devicesLayout = loadDevicesLayout(root);
    expect(devicesLayout.type).toBe("array");
    expect(devicesLayout.add).toBe("Add Device");

    const devicesLayoutItems = requireArray(
      devicesLayout.items,
      "devices layout items must be an array",
    );
    expect(devicesLayoutItems).toHaveLength(1);

    const directDeviceFields = devicesLayoutItems
      .map((entry) => layoutKey(entry))
      .filter((key) => key?.startsWith("devices[]."));
    expect(directDeviceFields).toEqual([]);

    const deviceForm = requireRecord(
      devicesLayoutItems.at(0),
      "devices layout must have one grouped device form entry",
    );
    expect(deviceForm.type).toBe("fieldset");

    const deviceFormItems = requireArray(
      deviceForm.items,
      "grouped device form entry must contain nested items",
    );
    expect(deviceFormItems.length).toBeGreaterThan(0);

    const layoutKeys = collectLayoutKeys(deviceForm);
    for (const key of DEVICE_LAYOUT_KEYS) {
      expect(
        layoutKeys,
        `${key} must be present in the device form layout`,
      ).toContain(key);
      expect(
        layoutKeys.filter((layoutEntryKey) => layoutEntryKey === key),
        `${key} must appear exactly once in the device form layout`,
      ).toHaveLength(1);
    }
  });
});
