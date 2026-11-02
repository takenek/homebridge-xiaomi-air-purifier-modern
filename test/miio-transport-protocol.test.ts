import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

import {
  MiioCommandError,
  ModernMiioTransport,
} from "../src/core/miio-transport";
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
      new Map<string, unknown>([
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
      new Map<string, unknown>([
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
        candidates: readonly { did: string; siid: number; piid: number }[],
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
  // "humidity" → aliases ["humidity", "rh"]
  vi.spyOn(internals, "call").mockResolvedValueOnce([null, "41"]);
  const humidityLegacy = await internals.readViaLegacyBatch([
    "humidity" as never,
  ]);
  expect(humidityLegacy.get("humidity" as never)).toBe("41");

  // temp_dec is tenths of a degree Celsius (Mi Air Purifier 2S, #297)
  // "temperature" → aliases ["temp_dec", "temperature"]
  vi.spyOn(internals, "call").mockResolvedValueOnce([233, null]);
  const tempDecLegacy = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(tempDecLegacy.get("temperature" as never)).toBe(23.3);

  // below 10 °C the raw temp_dec is <= 100 and must still be scaled
  vi.spyOn(internals, "call").mockResolvedValueOnce(["95", ""]);
  const coldTempDecLegacy = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(coldTempDecLegacy.get("temperature" as never)).toBe(9.5);

  // M2: first valid alias wins; second alias pair is skipped (covers has(key) guard)
  vi.spyOn(internals, "call").mockResolvedValueOnce([233, "ignored"]);
  const tempFirst = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(tempFirst.get("temperature" as never)).toBe(23.3);

  // without temp_dec, "temperature" is already in °C and passed through unscaled
  vi.spyOn(internals, "call").mockResolvedValueOnce([null, "21"]);
  const tempFallback = await internals.readViaLegacyBatch([
    "temperature" as never,
  ]);
  expect(tempFallback.get("temperature" as never)).toBe("21");

  await transport.close();
});

it("reads a Mi Air Purifier 2S legacy response with temp_dec in tenths of a degree", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
  };
  internals.protocolMode = "legacy";

  // One reply value per requested alias, modelled on a real 2S
  // (zhimi.airpurifier.mc1): it answers temp_dec, aqi, humidity,
  // favorite_level and filter1_life, and has no "temperature" or "fan_level".
  const replyByAlias: Record<string, unknown> = {
    power: "on",
    favorite_level: 10,
    mode: "auto",
    temp_dec: 233,
    humidity: 48,
    aqi: 12,
    filter1_life: 87,
    child_lock: "off",
    led: "on",
    motor1_speed: 700,
    use_time: 12345,
    purify_volume: 6789,
  };
  const call = vi
    .spyOn(internals, "call")
    .mockImplementation(async (_method, aliases) =>
      aliases.map((alias) => replyByAlias[alias as string] ?? null),
    );

  const state = await transport.getProperties([]);

  // 18 aliases are requested 15 + 3, within the legacy get_prop limit.
  expect(
    call.mock.calls.map(([method, aliases]) => [method, aliases.length]),
  ).toEqual([
    ["get_prop", 15],
    ["get_prop", 3],
  ]);
  expect(state).toEqual({
    power: true,
    fan_level: 10,
    mode: "auto",
    temperature: 23.3,
    humidity: 48,
    aqi: 12,
    filter1_life: 87,
    child_lock: false,
    led: true,
    motor1_speed: 700,
    use_time: 12345,
    purify_volume: 6789,
  });

  await transport.close();
});

it("maps legacy night mode 'silent' to sleep on read and sleep to 'silent' on write", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaLegacy: (props: readonly string[]) => Promise<DeviceState>;
  };

  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", "on"],
      ["fan_level", 10],
      ["mode", "silent"],
    ]),
  );
  expect((await internals.readViaLegacy([])).mode).toBe("sleep");

  const call = vi.spyOn(internals, "call").mockResolvedValue(["ok"]);
  internals.protocolMode = "legacy";
  await transport.setProperty("set_mode", ["sleep"]);
  expect(call).toHaveBeenLastCalledWith("set_mode", ["silent"]);

  await transport.setProperty("set_mode", ["auto"]);
  expect(call).toHaveBeenLastCalledWith("set_mode", ["auto"]);

  // MIOT write rejected → legacy fallback also uses the legacy night mode name
  internals.protocolMode = "miot";
  vi.spyOn(internals, "trySetViaMiot").mockResolvedValueOnce(false);
  await transport.setProperty("set_mode", ["sleep"]);
  expect(call).toHaveBeenLastCalledWith("set_mode", ["silent"]);
  expect(internals.protocolMode).toBe("legacy");

  await transport.close();
});

it("writes legacy Rotation Speed as favorite mode + favorite level and rethrows errors other than -5001 without stepping down (#298)", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  // MIOT write rejected → legacy fallback uses the favorite level too
  internals.protocolMode = "miot";
  vi.spyOn(internals, "trySetViaMiot").mockResolvedValueOnce(false);
  const call = vi.spyOn(internals, "call").mockResolvedValue(["ok"]);
  await transport.setProperty("set_level_fan", [5]);
  expect(call.mock.calls).toEqual([
    ["set_mode", ["favorite"]],
    ["set_level_favorite", [5]],
  ]);
  expect(internals.protocolMode).toBe("legacy");

  const failFavoriteLevelWith = (error: unknown) =>
    call.mockReset().mockImplementation(async (method: string) => {
      if (method === "set_level_favorite") {
        throw error;
      }
      return ["ok"];
    });

  // Only -5001 steps down; any other error surfaces after the first write.
  const firstWriteOnly = [
    ["set_mode", ["favorite"]],
    ["set_level_favorite", [16]],
  ];

  const timeout = Object.assign(new Error("MIIO timeout after 20ms"), {
    code: "ETIMEDOUT",
  });
  failFavoriteLevelWith(timeout);
  await expect(transport.setProperty("set_level_fan", [16])).rejects.toBe(
    timeout,
  );
  expect(call.mock.calls).toEqual(firstWriteOnly);

  const notFound = new MiioCommandError(
    -32601,
    "MIIO error -32601: Method not found.",
  );
  failFavoriteLevelWith(notFound);
  await expect(transport.setProperty("set_level_fan", [16])).rejects.toBe(
    notFound,
  );
  expect(call.mock.calls).toEqual(firstWriteOnly);

  // A non-finite level cannot step down forever: it is rejected once and
  // surfaces. HomeKit never sends one; this guards direct callers.
  const rejected = new MiioCommandError(-5001, "MIIO error -5001: invaild_arg");
  failFavoriteLevelWith(rejected);
  await expect(
    transport.setProperty("set_level_fan", [Number.NaN]),
  ).rejects.toBe(rejected);
  expect(call.mock.calls).toEqual([
    ["set_mode", ["favorite"]],
    ["set_level_favorite", [Number.NaN]],
  ]);

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

  // A result list proves MIOT works: a failed item is a rejected value, not a
  // reason to fall back to legacy.
  vi.spyOn(internals, "call").mockResolvedValue([
    { did: "0", siid: 2, piid: 5, code: -4005 },
  ]);
  await expect(
    internals.trySetViaMiot("set_mode", ["auto"]),
  ).rejects.toMatchObject({
    code: "-4005",
    message: "MIOT property 2.5 rejected the value (code -4005)",
  });

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
    new Map<string, unknown>([
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

  const call = vi.spyOn(internals, "call").mockResolvedValue([{ code: 0 }]);
  call.mockClear();
  await expect(internals.trySetViaMiot("set_level_fan", [99])).resolves.toBe(
    true,
  );
  expect(call.mock.calls).toEqual([
    ["set_properties", [{ did: "0", siid: 2, piid: 5, value: 2 }]],
    ["set_properties", [{ did: "0", siid: 10, piid: 10, value: 16 }]],
  ]);

  // Mode accepted but no result list for the level: an error, not a
  // protocol switch, and not a refused value either, so no step-down.
  call
    .mockReset()
    .mockResolvedValueOnce([{ code: 0 }])
    .mockResolvedValueOnce("bad");
  await expect(internals.trySetViaMiot("set_level_fan", [16])).rejects.toThrow(
    "MIOT set_properties returned no result list",
  );
  expect(call).toHaveBeenCalledTimes(2);

  // A MIIO-level error on the level write is not a refused value either.
  const busy = new MiioCommandError(-5001, "MIIO error -5001: command error");
  call
    .mockReset()
    .mockResolvedValueOnce([{ code: 0 }])
    .mockRejectedValueOnce(busy);
  await expect(internals.trySetViaMiot("set_level_fan", [16])).rejects.toBe(
    busy,
  );
  expect(call).toHaveBeenCalledTimes(2);

  // A refused level without an item code still steps down.
  call
    .mockReset()
    .mockResolvedValueOnce([{ code: 0 }])
    .mockResolvedValueOnce([{ did: "0", siid: 10, piid: 10 }])
    .mockResolvedValueOnce([{ code: 0 }]);
  await expect(internals.trySetViaMiot("set_level_fan", [13])).resolves.toBe(
    true,
  );
  expect(call.mock.calls.at(-1)).toEqual([
    "set_properties",
    [{ did: "0", siid: 10, piid: 10, value: 12 }],
  ]);

  // Mode refused: the write fails before any favorite level is sent.
  call
    .mockReset()
    .mockResolvedValueOnce([{ did: "0", siid: 2, piid: 5, code: -4005 }]);
  await expect(
    internals.trySetViaMiot("set_level_fan", [16]),
  ).rejects.toMatchObject({ code: "-4005" });
  expect(call).toHaveBeenCalledTimes(1);

  // Mode not answered with a result list: fall back to legacy as before.
  call.mockReset().mockResolvedValueOnce("bad");
  await expect(internals.trySetViaMiot("set_level_fan", [8])).resolves.toBe(
    false,
  );

  await transport.close();
});

it("covers remaining branch counters in getProperties/setProperty and toNumber NaN path", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: () => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
    getProperties: (props: readonly string[]) => Promise<DeviceState>;
    protocolMode: "unknown" | "miot" | "legacy";
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
    readViaLegacy: (props: readonly string[]) => Promise<DeviceState>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
  };

  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map<string, unknown>([
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

describe("ModernMiioTransport.reset", () => {
  it("recreates the UDP socket and clears session/protocolMode/messageId", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      socket: { close: (cb?: () => void) => void };
      session: unknown;
      protocolMode: "unknown" | "miot" | "legacy";
      nextMessageId: number;
    };

    internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
    internals.protocolMode = "miot";
    internals.nextMessageId = 999;
    const previousSocket = internals.socket;

    await transport.reset();

    expect(internals.session).toBeNull();
    expect(internals.protocolMode).toBe("unknown");
    expect(internals.nextMessageId).toBe(1);
    expect(internals.socket).not.toBe(previousSocket);

    await transport.close();
  });

  it("survives socket.close throwing ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      socket: { close: (cb?: () => void) => void };
    };

    internals.socket = {
      close: () => {
        const err = Object.assign(new Error("not running"), {
          code: "ERR_SOCKET_DGRAM_NOT_RUNNING",
        });
        throw err;
      },
    };

    await expect(transport.reset()).resolves.toBeUndefined();
    await transport.close();
  });

  it("logs other socket.close errors via reportSuppressedError", async () => {
    const debug = vi.fn();
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.4",
      connectTimeoutMs: 20,
      operationTimeoutMs: 20,
      logger: { debug },
    });
    const internals = transport as unknown as {
      socket: { close: (cb?: () => void) => void };
    };

    internals.socket = {
      close: () => {
        throw new Error("boom");
      },
    };

    await transport.reset();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("[miio-transport:reset-close]"),
    );
    await transport.close();
  });

  it("survives socket.close throwing a non-Error value", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      socket: { close: (cb?: () => void) => void };
    };

    const nonError = "raw-string-throw" as unknown as Error;
    internals.socket = {
      close: () => {
        // Simulate a synchronous non-Error throw (e.g. a thrown string).
        throw nonError;
      },
    };

    await expect(transport.reset()).resolves.toBeUndefined();
    await transport.close();
  });
});
