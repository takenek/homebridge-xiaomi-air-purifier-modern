import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState } from "../src/core/types";

const emptyState: DeviceState = {
  power: false,
  fan_level: 0,
  mode: "idle",
  temperature: 0,
  humidity: 0,
  aqi: 0,
  filter1_life: 0,
  child_lock: false,
  led: false,
  motor1_speed: 0,
  use_time: 0,
  purify_volume: 0,
};

const createTransport = () =>
  new ModernMiioTransport({
    address: "127.0.0.1",
    token: "00112233445566778899aabbccddeeff",
    model: "zhimi.airpurifier.4",
    connectTimeoutMs: 20,
    operationTimeoutMs: 20,
  });

describe("ModernMiioTransport protocol detection and property paths", () => {
  it("covers getProperties fallback branches and non-retryable MIOT fallback", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      protocolMode: "unknown" | "miot" | "legacy";
      detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
      readViaLegacy: () => Promise<DeviceState>;
      readViaMiot: () => Promise<DeviceState>;
      getProperties: (props: readonly string[]) => Promise<DeviceState>;
    };

    vi.spyOn(internals, "detectProtocolMode").mockResolvedValue(null);
    vi.spyOn(internals, "readViaLegacy").mockResolvedValue(emptyState);
    vi.spyOn(internals, "readViaMiot").mockResolvedValue({
      ...emptyState,
      power: true,
      mode: "auto",
      fan_level: 3,
    });

    const state = await internals.getProperties([]);
    expect(state.power).toBe(true);
    expect(internals.protocolMode).toBe("miot");

    internals.protocolMode = "miot";
    vi.spyOn(internals, "readViaMiot").mockRejectedValueOnce(
      new Error("no-miot"),
    );
    vi.spyOn(internals, "readViaLegacy").mockResolvedValueOnce({
      ...emptyState,
      power: true,
      fan_level: 1,
      mode: "sleep",
    });
    const fallback = await internals.getProperties([]);
    expect(fallback.mode).toBe("sleep");

    await transport.close();
  });

  it("covers setProperty miot path success/fallback and unknown method", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      protocolMode: "unknown" | "miot" | "legacy";
      detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
      trySetViaMiot: (
        method: string,
        params: readonly unknown[],
      ) => Promise<boolean>;
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
      setProperty: (
        method: string,
        params: readonly unknown[],
      ) => Promise<void>;
    };

    vi.spyOn(internals, "detectProtocolMode").mockResolvedValue("miot");
    vi.spyOn(internals, "trySetViaMiot").mockResolvedValueOnce(true);
    const call = vi.spyOn(internals, "call").mockResolvedValue(null);

    await internals.setProperty("set_power", ["on"]);
    expect(call).not.toHaveBeenCalled();

    vi.spyOn(internals, "trySetViaMiot").mockResolvedValueOnce(false);
    await internals.setProperty("set_power", ["off"]);
    expect(call).toHaveBeenCalledWith("set_power", ["off"]);

    internals.protocolMode = "miot";
    vi.spyOn(internals, "call").mockResolvedValue([{ code: 0 }]);
    expect(await internals.trySetViaMiot("unknown", [])).toBe(false);

    await transport.close();
  });

  it("covers readViaMiot/readViaLegacy conversion and unavailable-core errors", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      readViaMiotBatch: () => Promise<Map<string, unknown>>;
      readViaMiot: () => Promise<DeviceState>;
      readViaLegacyBatch: (
        props: readonly string[],
      ) => Promise<Map<string, unknown>>;
      readViaLegacy: (props: readonly string[]) => Promise<DeviceState>;
    };

    vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
      new Map([
        ["power", "on"],
        ["fan_level", "7"],
        ["mode", 2],
        ["temperature", "21"],
        ["humidity", "40"],
        ["aqi", "10"],
        ["filter1_life", "90"],
        ["child_lock", 1],
        ["led", 2],
      ]),
    );
    const miot = await internals.readViaMiot();
    expect(miot.mode).toBe("favorite");
    expect(miot.led).toBe(false);

    vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(new Map());
    await expect(internals.readViaMiot()).rejects.toThrow(
      "MIOT core properties unavailable",
    );

    vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
      new Map([
        ["power", true],
        ["fan_level", 2],
        ["mode", "bogus"],
        ["led", "on"],
      ]),
    );
    const legacy = await internals.readViaLegacy(["power"]);
    expect(legacy.mode).toBe("idle");

    vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(new Map());
    await expect(internals.readViaLegacy(["power"])).rejects.toMatchObject({
      code: "EDEVICEUNAVAILABLE",
    });

    // M1: led_b numeric encoding — 0=bright(on), 1=dim(on), 2=off
    vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
      new Map<string, unknown>([
        ["power", true],
        ["fan_level", 2],
        ["mode", "auto"],
        ["led", 0], // led_b=0 → bright → on
      ]),
    );
    const legacyLedBright = await internals.readViaLegacy(["power"]);
    expect(legacyLedBright.led).toBe(true);

    vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
      new Map<string, unknown>([
        ["power", true],
        ["fan_level", 2],
        ["mode", "auto"],
        ["led", 2], // led_b=2 → off
      ]),
    );
    const legacyLedOff = await internals.readViaLegacy(["power"]);
    expect(legacyLedOff.led).toBe(false);

    await transport.close();
  });

  it("covers readViaMiotBatch/readMiotOne fallback behaviors", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
      readViaMiotBatch: (
        props: readonly string[],
      ) => Promise<Map<string, unknown>>;
      readMiotOne: (
        candidates: readonly Array<{ did: string; siid: number; piid: number }>,
      ) => Promise<unknown>;
    };

    vi.spyOn(internals, "call").mockResolvedValue("not-array");
    await expect(internals.readViaMiotBatch(["power"])).resolves.toBeInstanceOf(
      Map,
    );

    vi.spyOn(internals, "call").mockRejectedValue(new Error("batch-fail"));
    const map = await internals.readViaMiotBatch(["power", "fan_level"]);
    expect(map.has("power")).toBe(true);

    const retryable = Object.assign(new Error("timeout"), {
      code: "ETIMEDOUT",
    });
    vi.spyOn(internals, "call").mockRejectedValueOnce(retryable);
    await expect(
      internals.readMiotOne([{ did: "0", siid: 2, piid: 2 }]),
    ).rejects.toBe(retryable);

    vi.spyOn(internals, "call")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { did: "0", siid: 2, piid: 2, code: 1, value: null },
      ])
      .mockResolvedValueOnce([
        { did: "0", siid: 2, piid: 2, code: 0, value: "on" },
      ]);
    const value = await internals.readMiotOne([
      { did: "0", siid: 2, piid: 2 },
      { did: "0", siid: 2, piid: 2 },
      { did: "0", siid: 2, piid: 2 },
    ]);
    expect(value).toBe("on");

    await transport.close();
  });
});

it("covers detectProtocolMode outcomes and legacy batch parsing", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
  };

  vi.spyOn(internals, "call").mockResolvedValueOnce([{}]);
  await expect(internals.detectProtocolMode()).resolves.toBe("miot");

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("miot-fail"))
    .mockResolvedValueOnce(["on"]);
  await expect(internals.detectProtocolMode()).resolves.toBe("legacy");

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("miot-fail"))
    .mockResolvedValueOnce("bad");
  await expect(internals.detectProtocolMode()).resolves.toBeNull();

  // props with no LEGACY_MAP entries return empty map without a call
  const emptyLegacy = await internals.readViaLegacyBatch(["unknown" as never]);
  expect(emptyLegacy.size).toBe(0);

  // non-array response → all values undefined
  vi.spyOn(internals, "call").mockResolvedValueOnce("bad");
  const badLegacy = await internals.readViaLegacyBatch([
    "unknown" as never,
    "power" as never,
  ]);
  expect(badLegacy.get("unknown" as never)).toBeUndefined();
  expect(badLegacy.get("power" as never)).toBeUndefined();

  // M2: single value in response maps to the property
  vi.spyOn(internals, "call").mockResolvedValueOnce(["ok"]);
  const goodLegacy = await internals.readViaLegacyBatch(["power" as never]);
  expect(goodLegacy.get("power" as never)).toBe("ok");

  // M2: alias fallback — first alias null, second alias used
  // "temperature" → aliases ["temperature", "temp_dec"]
  vi.spyOn(internals, "call").mockResolvedValueOnce([null, "21"]);
  const tempLegacy = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(tempLegacy.get("temperature" as never)).toBe("21");

  // M2: first valid alias wins; second alias pair is skipped (covers has(key) guard)
  vi.spyOn(internals, "call").mockResolvedValueOnce(["30", "ignored"]);
  const tempFirst = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(tempFirst.get("temperature" as never)).toBe("30");

  await transport.close();
});

it("covers trySetViaMiot command mappings and send() result branches", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  vi.spyOn(internals, "call").mockResolvedValue("bad");
  await expect(internals.trySetViaMiot("set_power", ["on"])).resolves.toBe(
    false,
  );

  vi.spyOn(internals, "call").mockResolvedValue([{ code: 1 }]);
  await expect(internals.trySetViaMiot("set_mode", ["auto"])).resolves.toBe(
    false,
  );

  vi.spyOn(internals, "call").mockResolvedValue([{ code: 0 }]);
  await expect(internals.trySetViaMiot("set_mode", ["sleep"])).resolves.toBe(
    true,
  );
  await expect(internals.trySetViaMiot("set_mode", ["favorite"])).resolves.toBe(
    true,
  );
  await expect(internals.trySetViaMiot("set_mode", ["idle"])).resolves.toBe(
    true,
  );
  await expect(internals.trySetViaMiot("set_child_lock", ["on"])).resolves.toBe(
    true,
  );
  await expect(internals.trySetViaMiot("set_led", ["off"])).resolves.toBe(true);
  await expect(internals.trySetViaMiot("set_level_fan", [0])).resolves.toBe(
    true,
  );

  await transport.close();
});

it("covers toMode direct string branch and legacy-empty fallback null path", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: () => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
    protocolMode: "unknown" | "miot" | "legacy";
    readViaLegacy: () => Promise<DeviceState>;
    getProperties: (props: readonly string[]) => Promise<DeviceState>;
  };

  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map([
      ["power", true],
      ["fan_level", 1],
      ["mode", "auto"],
    ]),
  );
  const directMode = await internals.readViaMiot();
  expect(directMode.mode).toBe("auto");

  internals.protocolMode = "legacy";
  vi.spyOn(internals, "readViaLegacy").mockResolvedValue(emptyState);
  vi.spyOn(internals, "readViaMiot").mockRejectedValue(
    new Error("miot unavailable"),
  );
  const legacy = await internals.getProperties([]);
  expect(legacy).toEqual(emptyState);

  await transport.close();
});

it("covers MIOT candidate selection branches and fan level clamp upper bound", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  vi.spyOn(internals, "call").mockResolvedValueOnce([
    { did: "0", siid: 10, piid: 10, code: 2, value: 3 },
    { did: "0", siid: 2, piid: 4, code: 0, value: 11 },
  ]);
  const map = await internals.readViaMiotBatch(["fan_level"]);
  expect(map.get("fan_level")).toBe(11);

  const call = vi
    .spyOn(internals, "call")
    .mockResolvedValue([{ code: 0 }, { code: 0 }]);
  await expect(internals.trySetViaMiot("set_level_fan", [99])).resolves.toBe(
    true,
  );
  const payload = call.mock.calls.at(-1)?.[1] as Array<{ value: unknown }>;
  expect(payload[1]?.value).toBe(16);

  await transport.close();
});

it("covers remaining branch counters in getProperties/setProperty and toNumber NaN path", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: () => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
    getProperties: (props: readonly string[]) => Promise<DeviceState>;
    protocolMode: "unknown" | "miot" | "legacy";
    readViaLegacy: (props: readonly string[]) => Promise<DeviceState>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
  };

  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["temperature", "NaN"],
    ]),
  );
  const miot = await internals.readViaMiot();
  expect(miot.temperature).toBe(0);

  internals.protocolMode = "legacy";
  vi.spyOn(internals, "readViaLegacy").mockResolvedValue({
    ...emptyState,
    power: true,
    fan_level: 1,
    mode: "auto",
  });
  const partial = await internals.getProperties(["power"]);
  expect(partial.power).toBe(true);

  internals.protocolMode = "miot";
  const call = vi.spyOn(internals, "call").mockResolvedValue(null);
  vi.spyOn(internals, "trySetViaMiot").mockResolvedValue(true);
  await internals.setProperty("set_power", ["on"]);
  expect(call).not.toHaveBeenCalled();

  internals.protocolMode = "unknown";
  vi.spyOn(internals, "detectProtocolMode").mockResolvedValueOnce(null);
  await internals.setProperty("set_power", ["off"]);
  expect(call).toHaveBeenCalledWith("set_power", ["off"]);

  internals.protocolMode = "legacy";
  await internals.setProperty("set_power", ["off"]);
  expect(call).toHaveBeenCalledWith("set_power", ["off"]);

  internals.protocolMode = "miot";
  vi.spyOn(internals, "readViaMiot").mockResolvedValue({
    ...emptyState,
    power: false,
    fan_level: 0,
    mode: "idle",
  });
  const emptyMiot = await internals.getProperties([]);
  expect(emptyMiot.mode).toBe("idle");

  await transport.close();
});

it("covers final protocol mode branches in getProperties and setProperty", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    readViaLegacy: () => Promise<DeviceState>;
    readViaMiot: () => Promise<DeviceState>;
    getProperties: (props: readonly string[]) => Promise<DeviceState>;
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
  };

  internals.protocolMode = "legacy";
  vi.spyOn(internals, "readViaLegacy").mockResolvedValue(emptyState);
  vi.spyOn(internals, "readViaMiot").mockResolvedValue({
    ...emptyState,
    power: true,
    fan_level: 2,
    mode: "auto",
  });
  await expect(internals.getProperties([])).resolves.toMatchObject({
    power: true,
  });

  internals.protocolMode = "unknown";
  vi.spyOn(internals, "detectProtocolMode").mockResolvedValue("legacy");
  vi.spyOn(internals, "call").mockResolvedValue(null);
  await internals.setProperty("set_power", ["off"]);

  await transport.close();
});
