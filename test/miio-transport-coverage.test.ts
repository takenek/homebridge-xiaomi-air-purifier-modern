import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState } from "../src/core/types";

class FakeSocket extends EventEmitter {
  public sendError: Error | null = null;

  public send(
    _packet: Buffer,
    _port: number,
    _address: string,
    callback: (error: Error | null) => void,
  ): void {
    callback(this.sendError);
  }

  public close(callback?: () => void): void {
    callback?.();
  }
}

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
  buzzer_volume: 0,
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

const createProTransport = () =>
  new ModernMiioTransport({
    address: "127.0.0.1",
    token: "00112233445566778899aabbccddeeff",
    model: "zhimi.airpurifier.pro",
    connectTimeoutMs: 20,
    operationTimeoutMs: 20,
  });

describe("ModernMiioTransport coverage", () => {
  it("validates token and supports logger-based suppressed error reporting", async () => {
    expect(
      () =>
        new ModernMiioTransport({
          address: "127.0.0.1",
          token: "bad",
          model: "zhimi.airpurifier.4",
        }),
    ).toThrow("Token must be a 32-char hex string");

    const debug = vi.fn();
    const fakeSocket = new FakeSocket();
    vi.spyOn(dgram, "createSocket").mockReturnValue(
      fakeSocket as unknown as dgram.Socket,
    );

    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.4",
      logger: { debug },
    });

    fakeSocket.emit("error", Object.assign(new Error("boom"), { code: "EIO" }));
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("[miio-transport:socket]"),
    );

    await transport.close();
  });

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
    // readViaMiot will try legacy supplement for missing properties
    vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(new Map());
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

  it("covers call/handshake/sendCommand happy and error paths", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      session: {
        deviceId: number;
        deviceStamp: number;
        handshakeAtEpochSec: number;
      } | null;
      isTransportError: (error: unknown) => boolean;
      handshake: () => Promise<void>;
      sendCommand: (
        method: string,
        params: readonly unknown[],
      ) => Promise<unknown>;
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
      sendAndReceive: (
        packet: Buffer,
        expectEncrypted: boolean,
        expectedResponseId?: number,
        options?: { timeoutMs: number },
      ) => Promise<Buffer>;
      encrypt: (payload: Buffer) => Buffer;
      decrypt: (payload: Buffer) => Buffer;
      close: () => Promise<void>;
    };

    expect(internals.isTransportError(new Error("x"))).toBe(false);
    expect(
      internals.isTransportError(
        Object.assign(new Error("x"), { code: "EIO" }),
      ),
    ).toBe(true);

    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(Buffer.alloc(32));
    await internals.handshake();
    expect(internals.session).not.toBeNull();

    internals.session = null;
    await expect(internals.sendCommand("get_prop", [])).rejects.toThrow(
      "MIIO session not initialized",
    );

    internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(Buffer.alloc(10));
    await expect(internals.sendCommand("get_prop", [])).rejects.toThrow(
      "Invalid MIIO command response",
    );

    const encryptedEmpty = Buffer.concat([Buffer.alloc(32), Buffer.alloc(0)]);
    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(encryptedEmpty);
    await expect(internals.sendCommand("noop", [])).resolves.toBeNull();

    const cipherPayload = internals.encrypt(Buffer.from("not-json", "utf8"));
    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(
      Buffer.concat([Buffer.alloc(32), cipherPayload]),
    );
    await expect(internals.sendCommand("x", [])).rejects.toThrow(
      "Malformed MIIO JSON response",
    );

    const errPayload = internals.encrypt(
      Buffer.from(
        JSON.stringify({ error: { code: -1, message: "bad" } }),
        "utf8",
      ),
    );
    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(
      Buffer.concat([Buffer.alloc(32), errPayload]),
    );
    await expect(internals.sendCommand("x", [])).rejects.toMatchObject({
      code: "-1",
    });

    const okPayload = internals.encrypt(
      Buffer.from(JSON.stringify({ result: ["ok"] }), "utf8"),
    );
    vi.spyOn(internals, "sendAndReceive").mockResolvedValue(
      Buffer.concat([Buffer.alloc(32), okPayload]),
    );
    await expect(internals.sendCommand("x", [])).resolves.toEqual(["ok"]);

    internals.session = null;
    vi.spyOn(internals, "handshake").mockResolvedValue();
    vi.spyOn(internals, "sendCommand")
      .mockRejectedValueOnce(
        Object.assign(new Error("sock"), { code: "ECONNRESET" }),
      )
      .mockResolvedValueOnce("ok");
    await expect(internals.call("get_prop", [])).resolves.toBe("ok");

    vi.spyOn(internals, "sendCommand").mockRejectedValueOnce(new Error("boom"));
    await expect(internals.call("x", [])).rejects.toThrow("boom");

    await internals.close();
  });

  it("covers sendAndReceive filtering, timeout, socket error and send callback error", async () => {
    const fakeSocket = new FakeSocket();
    vi.spyOn(dgram, "createSocket").mockReturnValue(
      fakeSocket as unknown as dgram.Socket,
    );

    const transport = createTransport();
    const internals = transport as unknown as {
      sendAndReceive: (
        packet: Buffer,
        expectEncrypted: boolean,
        expectedResponseId?: number,
        options?: { timeoutMs: number },
      ) => Promise<Buffer>;
    };

    const pending = internals.sendAndReceive(Buffer.alloc(32), true, 7, {
      timeoutMs: 50,
    });
    fakeSocket.emit("message", Buffer.alloc(8));
    const wrongMagic = Buffer.alloc(40);
    wrongMagic.writeUInt16BE(0x1234, 0);
    fakeSocket.emit("message", wrongMagic);
    const shortEncrypted = Buffer.alloc(32);
    shortEncrypted.writeUInt16BE(0x2131, 0);
    fakeSocket.emit("message", shortEncrypted);
    const wrongId = Buffer.alloc(40);
    wrongId.writeUInt16BE(0x2131, 0);
    wrongId.writeUInt32BE(999, 4);
    fakeSocket.emit("message", wrongId);
    const ok = Buffer.alloc(40);
    ok.writeUInt16BE(0x2131, 0);
    ok.writeUInt32BE(7, 4);
    fakeSocket.emit("message", ok);
    await expect(pending).resolves.toBe(ok);

    const pendingErr = internals.sendAndReceive(
      Buffer.alloc(32),
      false,
      undefined,
      {
        timeoutMs: 50,
      },
    );
    fakeSocket.emit(
      "error",
      Object.assign(new Error("disconnect"), { code: "ECONNRESET" }),
    );
    await expect(pendingErr).rejects.toThrow("disconnect");

    fakeSocket.sendError = Object.assign(new Error("send-fail"), {
      code: "EPIPE",
    });
    await expect(
      internals.sendAndReceive(Buffer.alloc(32), false, undefined, {
        timeoutMs: 50,
      }),
    ).rejects.toThrow("send-fail");

    fakeSocket.sendError = null;
    await expect(
      internals.sendAndReceive(Buffer.alloc(32), false, undefined, {
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });

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

  // MIOT probe with code 0 (default) → detects miot
  vi.spyOn(internals, "call").mockResolvedValueOnce([{}]);
  await expect(internals.detectProtocolMode()).resolves.toBe("miot");

  // MIOT probe with explicit code 0 → detects miot
  vi.spyOn(internals, "call").mockResolvedValueOnce([
    { did: "0", siid: 2, piid: 2, code: 0, value: true },
  ]);
  await expect(internals.detectProtocolMode()).resolves.toBe("miot");

  // MIOT probe with non-zero item code → falls to legacy
  vi.spyOn(internals, "call")
    .mockResolvedValueOnce([{ did: "0", siid: 2, piid: 2, code: -5001 }])
    .mockResolvedValueOnce(["on"]);
  await expect(internals.detectProtocolMode()).resolves.toBe("legacy");

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
  await expect(
    internals.trySetViaMiot("set_buzzer_volume", [20]),
  ).resolves.toBe(true);
  await expect(internals.trySetViaMiot("set_level_fan", [0])).resolves.toBe(
    true,
  );

  await transport.close();
});

it("tries alternate MIOT buzzer mappings before falling back to legacy", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockResolvedValueOnce([{ code: -4001 }])
    .mockResolvedValueOnce([{ code: 0 }]);

  await expect(
    internals.trySetViaMiot("set_buzzer_volume", [100]),
  ).resolves.toBe(true);

  expect(call).toHaveBeenNthCalledWith(1, "set_properties", [
    { did: "0", siid: 5, piid: 1, value: true },
  ]);
  expect(call).toHaveBeenNthCalledWith(2, "set_properties", [
    { did: "0", siid: 5, piid: 2, value: 100 },
  ]);

  await transport.close();
});

it("returns false for buzzer MIOT write when all candidate mappings fail non-retryably", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("candidate-1"))
    .mockResolvedValueOnce([{ code: -4001 }])
    .mockResolvedValueOnce([{ code: -4001 }])
    .mockResolvedValueOnce([{ code: -4001 }]);

  await expect(internals.trySetViaMiot("set_buzzer_volume", [0])).resolves.toBe(
    false,
  );

  await transport.close();
});

it("rethrows retryable error while trying alternate buzzer MIOT mappings", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  const timeout = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  vi.spyOn(internals, "call").mockRejectedValueOnce(timeout);

  await expect(
    internals.trySetViaMiot("set_buzzer_volume", [100]),
  ).rejects.toBe(timeout);

  await transport.close();
});

it("covers close() catch branches and retryable MIOT batch errors", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    socket: { close: (cb?: () => void) => void };
    close: () => Promise<void>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
  };

  internals.socket = {
    close: () => {
      throw Object.assign(new Error("not running"), {
        code: "ERR_SOCKET_DGRAM_NOT_RUNNING",
      });
    },
  };
  await expect(internals.close()).resolves.toBeUndefined();

  const transport2 = createTransport();
  const i2 = transport2 as unknown as {
    socket: { close: (cb?: () => void) => void };
    close: () => Promise<void>;
  };
  i2.socket = {
    close: () => {
      throw new Error("close boom");
    },
  };
  await expect(i2.close()).rejects.toThrow("close boom");

  const transport3 = createTransport();
  const i3 = transport3 as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
  };
  const retryable = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  vi.spyOn(i3, "call").mockRejectedValue(retryable);
  await expect(i3.readViaMiotBatch(["power"])).rejects.toMatchObject({
    code: "ETIMEDOUT",
  });

  await transport3.close();
});

it("covers skipped MIOT batch payload entries and handshake short response", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
    handshake: () => Promise<void>;
  };

  vi.spyOn(internals, "call").mockResolvedValueOnce([
    { siid: 2, piid: 2, code: 0, value: true },
    { did: "0", siid: 10, piid: 10, code: 1, value: 9 },
    { did: "0", siid: 2, piid: 5, code: 0, value: 0 },
  ]);
  const map = await internals.readViaMiotBatch(["power", "fan_level", "mode"]);
  expect(map.get("power")).toBeUndefined();
  expect(map.get("fan_level")).toBeUndefined();
  expect(map.get("mode")).toBe(0);

  vi.spyOn(internals, "sendAndReceive").mockResolvedValueOnce(Buffer.alloc(12));
  await expect(internals.handshake()).rejects.toThrow(
    "Invalid handshake response from device",
  );

  await transport.close();
});

it("treats MIIO command errors as non-transport for retry logic", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    session: {
      deviceId: number;
      deviceStamp: number;
      handshakeAtEpochSec: number;
    } | null;
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
    encrypt: (payload: Buffer) => Buffer;
    sendCommand: (
      method: string,
      params: readonly unknown[],
    ) => Promise<unknown>;
    isTransportError: (error: unknown) => boolean;
  };

  internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
  const errPayload = internals.encrypt(
    Buffer.from(
      JSON.stringify({ error: { code: -123, message: "bad" } }),
      "utf8",
    ),
  );
  vi.spyOn(internals, "sendAndReceive").mockResolvedValueOnce(
    Buffer.concat([Buffer.alloc(32), errPayload]),
  );

  try {
    await internals.sendCommand("set_power", ["on"]);
  } catch (error: unknown) {
    expect(internals.isTransportError(error)).toBe(false);
  }

  await transport.close();
});

it("covers toMode direct string branch and legacy-empty fallback null path", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: () => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
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
  // readViaMiot supplements missing props via legacy
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(new Map());
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

it("covers suppressed error formatting branches and MIIO error without code", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    reportSuppressedError: (context: string, error: unknown) => void;
    session: {
      deviceId: number;
      deviceStamp: number;
      handshakeAtEpochSec: number;
    } | null;
    encrypt: (payload: Buffer) => Buffer;
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
    sendCommand: (
      method: string,
      params: readonly unknown[],
    ) => Promise<unknown>;
  };

  const emitWarning = vi
    .spyOn(process, "emitWarning")
    .mockImplementation(() => undefined);
  internals.reportSuppressedError("custom", "string-error");
  internals.reportSuppressedError("custom", new Error("no-code"));
  expect(emitWarning).toHaveBeenCalled();

  internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
  const errPayload = internals.encrypt(
    Buffer.from(JSON.stringify({ error: { message: undefined } }), "utf8"),
  );
  vi.spyOn(internals, "sendAndReceive").mockResolvedValueOnce(
    Buffer.concat([Buffer.alloc(32), errPayload]),
  );
  await expect(internals.sendCommand("x", [])).rejects.toThrow(
    "MIIO error: Unknown",
  );

  await transport.close();
});

it("accepts encrypted response with messageId 0 when response id is expected", async () => {
  const fakeSocket = new FakeSocket();
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    fakeSocket as unknown as dgram.Socket,
  );
  const transport = createTransport();
  const internals = transport as unknown as {
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
  };

  const pending = internals.sendAndReceive(Buffer.alloc(32), true, 99, {
    timeoutMs: 50,
  });
  const response = Buffer.alloc(40);
  response.writeUInt16BE(0x2131, 0);
  response.writeUInt32BE(0, 4);
  fakeSocket.emit("message", response);
  await expect(pending).resolves.toBe(response);

  await transport.close();
});

it("covers additional branch cases for set_led, call with existing session, and id-optional receive", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
  };

  vi.spyOn(internals, "call").mockResolvedValue([{ code: 0 }]);
  await expect(internals.trySetViaMiot("set_led", ["on"])).resolves.toBe(true);
  await transport.close();

  const transportCall = createTransport();
  const callInternals = transportCall as unknown as {
    session: {
      deviceId: number;
      deviceStamp: number;
      handshakeAtEpochSec: number;
    } | null;
    sendCommand: (
      method: string,
      params: readonly unknown[],
    ) => Promise<unknown>;
    handshake: () => Promise<void>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
  };
  callInternals.session = {
    deviceId: 1,
    deviceStamp: 1,
    handshakeAtEpochSec: 1,
  };
  const handshake = vi.spyOn(callInternals, "handshake").mockResolvedValue();
  vi.spyOn(callInternals, "sendCommand").mockResolvedValue("ok");
  await expect(callInternals.call("get_prop", [])).resolves.toBe("ok");
  expect(handshake).not.toHaveBeenCalled();
  await transportCall.close();

  const fakeSocket = new FakeSocket();
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    fakeSocket as unknown as dgram.Socket,
  );
  const transport2 = createTransport();
  const i2 = transport2 as unknown as {
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
  };
  const pending = i2.sendAndReceive(Buffer.alloc(32), true, undefined, {
    timeoutMs: 50,
  });
  const response = Buffer.alloc(40);
  response.writeUInt16BE(0x2131, 0);
  fakeSocket.emit("message", response);
  await expect(pending).resolves.toBe(response);
  await transport2.close();
});

it("covers remaining branch variants in MIOT helpers", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readMiotOne: (
      candidates: readonly Array<{ did: string; siid: number; piid: number }>,
    ) => Promise<unknown>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    session: {
      deviceId: number;
      deviceStamp: number;
      handshakeAtEpochSec: number;
    } | null;
    decrypt: (payload: Buffer) => Buffer;
    sendAndReceive: (
      packet: Buffer,
      expectEncrypted: boolean,
      expectedResponseId?: number,
      options?: { timeoutMs: number },
    ) => Promise<Buffer>;
    sendCommand: (
      method: string,
      params: readonly unknown[],
    ) => Promise<unknown>;
  };

  vi.spyOn(internals, "call").mockRejectedValue(new Error("batch-fail"));
  const unknownMap = await internals.readViaMiotBatch(["unknown" as never]);
  expect(unknownMap.get("unknown" as never)).toBeUndefined();

  vi.spyOn(internals, "call").mockResolvedValueOnce([
    { did: "0", siid: 2, piid: 2, code: 1, value: false },
  ]);
  await expect(
    internals.readMiotOne([{ did: "0", siid: 2, piid: 2 }]),
  ).resolves.toBeUndefined();

  vi.spyOn(internals, "call").mockResolvedValueOnce([{ code: undefined }]);
  await expect(internals.trySetViaMiot("set_power", ["on"])).resolves.toBe(
    false,
  );

  internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
  vi.spyOn(internals, "sendAndReceive").mockResolvedValueOnce(
    Buffer.concat([Buffer.alloc(32), Buffer.from([1, 2, 3])]),
  );
  vi.spyOn(internals, "decrypt").mockImplementation(() => {
    throw "not-an-error";
  });
  await expect(internals.sendCommand("x", [])).rejects.toThrow(
    "Malformed MIIO JSON response",
  );

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
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
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
  // readViaMiot supplements missing props via legacy
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(new Map());
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

it("falls back to legacy for current call when trySetViaMiot throws a non-retryable error (keeps miot mode)", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  internals.protocolMode = "miot";
  vi.spyOn(internals, "trySetViaMiot").mockRejectedValueOnce(
    new Error("MIIO error -5001: command error"),
  );
  const call = vi.spyOn(internals, "call").mockResolvedValue(null);

  await internals.setProperty("set_power", ["on"]);
  // protocolMode stays "miot" (no permanent switch)
  expect(internals.protocolMode).toBe("miot");
  expect(call).toHaveBeenCalledWith("set_power", ["on"]);

  await transport.close();
});

it("re-throws retryable error from trySetViaMiot without falling back to legacy", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  internals.protocolMode = "miot";
  const retryable = Object.assign(new Error("timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "trySetViaMiot").mockRejectedValueOnce(retryable);
  const call = vi.spyOn(internals, "call").mockResolvedValue(null);

  await expect(internals.setProperty("set_power", ["on"])).rejects.toBe(
    retryable,
  );
  expect(internals.protocolMode).toBe("miot");
  expect(call).not.toHaveBeenCalled();

  await transport.close();
});

it("setViaLegacy tries pro-specific set_buzzer_volume payload variants before set_buzzer", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("numeric volume unsupported"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer_volume", ["on"]);
  expect(call).toHaveBeenNthCalledWith(3, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);

  await transport.close();
});

it("setViaLegacy uses OFF payload variant for pro-specific set_buzzer_volume fallback", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("numeric volume unsupported"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""]);

  await internals.setViaLegacy("set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer_volume", ["off"]);
  expect(call).toHaveBeenNthCalledWith(3, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);

  await transport.close();
});

it("setViaLegacy falls back from set_buzzer_volume to set_buzzer string payload", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  // When set_buzzer_volume fails with command error, fall back to set_buzzer
  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("command error"))
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer", ["on"]);

  // Turn off buzzer
  call
    .mockRejectedValueOnce(new Error("command error"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);
  await internals.setViaLegacy("set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(4, "set_buzzer", ["off"]);

  await transport.close();
});

it("setViaLegacy retries set_buzzer with boolean payload when string payload fails", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(new Error("string unsupported"))
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer", ["on"]);
  expect(call).toHaveBeenNthCalledWith(3, "set_buzzer", [true]);

  await transport.close();
});

it("setViaLegacy retries set_buzzer with numeric payload when string/boolean payloads fail", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(new Error("string unsupported"))
    .mockRejectedValueOnce(new Error("boolean unsupported"))
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer", ["off"]);
  expect(call).toHaveBeenNthCalledWith(3, "set_buzzer", [false]);
  expect(call).toHaveBeenNthCalledWith(4, "set_buzzer", [0]);

  await transport.close();
});

it("setViaLegacy tries set_sound after set_buzzer variants fail", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(new Error("buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("buzzer no-arg unsupported"))
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(6, "set_sound", ["on"]);

  await transport.close();
});

it("setViaLegacy tries set_mute with inverse semantics when sound variants fail", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(new Error("buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("sound string unsupported"))
    .mockRejectedValueOnce(new Error("sound bool unsupported"))
    .mockRejectedValueOnce(new Error("sound numeric unsupported"))
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(9, "set_mute", ["off"]);

  await transport.close();
});

it("setViaLegacy re-throws retryable error from set_buzzer fallback chain", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const retryable = Object.assign(new Error("network timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(retryable);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    retryable,
  );

  await transport.close();
});
it("setViaLegacy surfaces last non-retryable error when all buzzer fallbacks fail", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalError = new Error("key tone numeric unsupported");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("volume unsupported"))
    .mockRejectedValueOnce(new Error("buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("sound string unsupported"))
    .mockRejectedValueOnce(new Error("sound bool unsupported"))
    .mockRejectedValueOnce(new Error("sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("mute string unsupported"))
    .mockRejectedValueOnce(new Error("mute bool unsupported"))
    .mockRejectedValueOnce(new Error("mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(finalError)
    .mockResolvedValueOnce([]);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalError,
  );

  await transport.close();
});

it("setViaLegacy uses dynamic set_<alias> fallback derived from get_prop", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    // static fallback matrix fails
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValue(new Error("static unsupported"));

  // After static chain, probe aliases, then dynamic set_buzzer succeeds.
  call.mockReset();
  call
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""])
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(18, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);
  expect(call).toHaveBeenNthCalledWith(19, "set_buzzer", ["on"]);

  await transport.close();
});

it("setViaLegacy re-throws retryable error from dynamic get_prop probe", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const retryable = Object.assign(new Error("probe timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "call")
    // static fallback matrix fails with non-retryable errors
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    // dynamic probe fails retryably -> must be re-thrown
    .mockRejectedValueOnce(retryable);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    retryable,
  );

  await transport.close();
});

it("setViaLegacy ignores non-retryable error from dynamic get_prop probe", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalStaticError = new Error("set_key_tone numeric unsupported");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(finalStaticError)
    .mockRejectedValueOnce(new Error("probe command error"));

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalStaticError,
  );

  await transport.close();
});

it("setViaLegacy re-throws retryable error from dynamic set_<alias> execution", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const retryable = Object.assign(new Error("dynamic write timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["", "", "", "", "", "on", "", ""])
    .mockRejectedValueOnce(retryable);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    retryable,
  );

  await transport.close();
});

it("setViaLegacy updates last error from non-retryable dynamic fallback failure", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalError = new Error("dynamic numeric unsupported");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(finalError)
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""]);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalError,
  );

  await transport.close();
});

it("setViaLegacy ignores dynamic probe entries without alias mapping", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalError = new Error("no dynamic alias matched");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(finalError)
    // extra element at index 8 has no alias and must be ignored
    .mockResolvedValueOnce(["", "", "", "", "", "", "", "", "on"]);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalError,
  );

  await transport.close();
});

it("setViaLegacy handles non-array dynamic probe response", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalError = new Error("set_key_tone numeric unsupported");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(finalError)
    // non-array result -> no dynamic calls added
    .mockResolvedValueOnce({ ok: true });

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalError,
  );

  await transport.close();
});

it("setViaLegacy on Pro continues fallback chain when first command succeeds but state stays unchanged", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    // set_buzzer_volume reports success but state is still off
    .mockResolvedValueOnce(["ok"])
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""])
    // fallback command applies new state
    .mockResolvedValueOnce(["ok"])
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(2, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);
  expect(call).toHaveBeenNthCalledWith(3, "set_buzzer_volume", ["on"]);
  expect(call).toHaveBeenNthCalledWith(4, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);

  await transport.close();
});

it("setViaLegacy treats Pro command-error writes as success when probe already matches target state", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(new Error("dynamic numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  expect(call).toHaveBeenNthCalledWith(21, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);

  await transport.close();
});

it("setViaLegacy verifies Pro buzzer state via mute alias semantics", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  vi.spyOn(internals, "call").mockImplementation(async (method: string) => {
    if (method === "get_prop") {
      return ["", "", "", "", "", "off", "", ""];
    }

    throw new Error(`${method} unsupported`);
  });

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  await transport.close();
});

it("setViaLegacy verifies Pro buzzer state via sound_volume alias", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  vi.spyOn(internals, "call").mockImplementation(async (method: string) => {
    if (method === "get_prop") {
      return ["", "", "", 20, "", "", "", ""];
    }

    throw new Error(`${method} unsupported`);
  });

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  await transport.close();
});

it("setViaLegacy verifies Pro buzzer state via sound_volume and volume aliases", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  vi.spyOn(internals, "call").mockImplementation(async (method: string) => {
    if (method === "get_prop") {
      return ["", "", "", "", 50, "", "", ""];
    }

    throw new Error(`${method} unsupported`);
  });

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  await transport.close();
});

it("setViaLegacy re-probes Pro buzzer state after dynamic command errors", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(new Error("dynamic numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();
  await transport.close();
});

it("setViaLegacy ignores non-retryable error from Pro re-probe", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(new Error("dynamic numeric unsupported"))
    .mockRejectedValueOnce(new Error("second probe unsupported"));

  await expect(
    internals.setViaLegacy("set_buzzer_volume", [100]),
  ).resolves.toBeUndefined();

  await transport.close();
});

it("setViaLegacy re-throws retryable error from Pro re-probe", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const timeoutError = new Error("MIIO timeout after 20ms");
  Reflect.set(timeoutError, "code", "ETIMEDOUT");

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(new Error("dynamic numeric unsupported"))
    .mockRejectedValueOnce(timeoutError);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    timeoutError,
  );

  await transport.close();
});

it("setViaLegacy keeps failing on Pro when probe state does not match requested buzzer state", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const finalError = new Error("dynamic numeric unsupported");
  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer_volume numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""])
    .mockRejectedValueOnce(new Error("dynamic set_buzzer failed"))
    .mockRejectedValueOnce(new Error("dynamic bool unsupported"))
    .mockRejectedValueOnce(finalError)
    .mockResolvedValueOnce(["off", "", "", "", "", "", "", ""]);

  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    finalError,
  );
  await transport.close();
});

it("setViaLegacy applies dynamic mute alias with OFF semantics", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["", "", "", "", "", "on", "", ""])
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(19, "set_mute", ["on"]);

  await transport.close();
});

it("setViaLegacy applies generic dynamic alias with OFF payload mapping", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("set_buzzer_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer string unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer bool unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_buzzer no-arg unsupported"))
    .mockRejectedValueOnce(new Error("set_sound string unsupported"))
    .mockRejectedValueOnce(new Error("set_sound bool unsupported"))
    .mockRejectedValueOnce(new Error("set_sound numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_mute string unsupported"))
    .mockRejectedValueOnce(new Error("set_mute bool unsupported"))
    .mockRejectedValueOnce(new Error("set_mute numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_sound_volume unsupported"))
    .mockRejectedValueOnce(new Error("set_voice string unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone string unsupported"))
    .mockRejectedValueOnce(new Error("set_voice numeric unsupported"))
    .mockRejectedValueOnce(new Error("set_key_tone numeric unsupported"))
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""])
    .mockResolvedValueOnce(null);

  await internals.setViaLegacy("set_buzzer_volume", [0]);
  expect(call).toHaveBeenNthCalledWith(19, "set_buzzer", ["off"]);

  await transport.close();
});

it("setViaLegacy succeeds directly with set_buzzer_volume when supported", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi.spyOn(internals, "call").mockResolvedValue(null);
  await internals.setViaLegacy("set_buzzer_volume", [50]);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("set_buzzer_volume", [50]);

  await transport.close();
});

it("setViaLegacy re-throws retryable error from set_buzzer_volume without fallback", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const retryable = Object.assign(new Error("timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "call").mockRejectedValueOnce(retryable);
  await expect(internals.setViaLegacy("set_buzzer_volume", [100])).rejects.toBe(
    retryable,
  );

  await transport.close();
});

it("setViaLegacy passes non-buzzer methods through directly", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setViaLegacy: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  const call = vi.spyOn(internals, "call").mockResolvedValue(null);
  await internals.setViaLegacy("set_led", ["on"]);
  expect(call).toHaveBeenCalledWith("set_led", ["on"]);

  await transport.close();
});

it("Pro model detects as MIOT when probe item code is 0", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
  };

  const call = vi
    .spyOn(internals, "call")
    .mockResolvedValueOnce([
      { did: "0", siid: 2, piid: 2, code: 0, value: true },
    ]);
  await expect(internals.detectProtocolMode()).resolves.toBe("miot");
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("get_properties", [
    { did: "0", siid: 2, piid: 2 },
  ]);

  await transport.close();
});

it("Pro model falls to legacy when MIOT probe item code is non-zero", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
  };

  const call = vi
    .spyOn(internals, "call")
    // MIOT probe returns non-zero code
    .mockResolvedValueOnce([
      { did: "0", siid: 2, piid: 2, code: -5001, value: null },
    ])
    // Legacy probe succeeds
    .mockResolvedValueOnce(["on"]);
  await expect(internals.detectProtocolMode()).resolves.toBe("legacy");
  expect(call).toHaveBeenCalledTimes(2);

  await transport.close();
});

it("returns null for Pro model when both MIOT and legacy detection fail", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
  };

  vi.spyOn(internals, "call")
    .mockRejectedValueOnce(new Error("miot-fail"))
    .mockRejectedValueOnce(new Error("legacy-fail"));
  await expect(internals.detectProtocolMode()).resolves.toBeNull();

  await transport.close();
});

it("Pro model end-to-end: MIOT set for buzzer fails, falls back to legacy set_buzzer", async () => {
  const transport = createProTransport();
  const internals = transport as unknown as {
    protocolMode: "unknown" | "miot" | "legacy";
    detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
    trySetViaMiot: (
      method: string,
      params: readonly unknown[],
    ) => Promise<boolean>;
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    setProperty: (method: string, params: readonly unknown[]) => Promise<void>;
  };

  internals.protocolMode = "miot";
  // MIOT set returns false (unsupported)
  vi.spyOn(internals, "trySetViaMiot").mockResolvedValueOnce(false);
  const call = vi
    .spyOn(internals, "call")
    // set_buzzer_volume fails → falls back to legacy payload variant then verify state
    .mockRejectedValueOnce(new Error("command error"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(["on", "", "", "", "", "", "", ""]);

  await internals.setProperty("set_buzzer_volume", [100]);
  // protocolMode stays "miot" (no permanent switch)
  expect(internals.protocolMode).toBe("miot");
  expect(call).toHaveBeenNthCalledWith(1, "set_buzzer_volume", [100]);
  expect(call).toHaveBeenNthCalledWith(2, "set_buzzer_volume", ["on"]);
  expect(call).toHaveBeenNthCalledWith(3, "get_prop", [
    "buzzer",
    "buzzer_volume",
    "sound",
    "sound_volume",
    "volume",
    "mute",
    "voice",
    "key_tone",
  ]);

  await transport.close();
});

it("readViaMiot supplements missing props from legacy and converts buzzer via toBuzzerVolume", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
  };

  // MIOT batch returns most properties but NOT buzzer_volume
  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 5],
      ["mode", "auto"],
      ["temperature", 22],
      ["humidity", 45],
      ["aqi", 15],
      ["filter1_life", 80],
      ["child_lock", false],
      ["led", 0],
      ["motor1_speed", 900],
      ["use_time", 200],
      ["purify_volume", 500],
    ]),
  );
  // Legacy supplement returns buzzer value as "on"
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([["buzzer_volume", "on"]]),
  );
  const state = await internals.readViaMiot();
  expect(state.buzzer_volume).toBe(100);
  expect(state.power).toBe(true);

  await transport.close();
});

it("readViaMiot rethrows retryable error from legacy supplement", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
  };

  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 5],
      ["mode", "auto"],
    ]),
  );
  const retryable = Object.assign(new Error("timeout"), {
    code: "ETIMEDOUT",
  });
  vi.spyOn(internals, "readViaLegacyBatch").mockRejectedValue(retryable);
  await expect(internals.readViaMiot()).rejects.toBe(retryable);

  await transport.close();
});

it("readViaMiot ignores non-retryable legacy supplement errors", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaMiotBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaMiot: () => Promise<DeviceState>;
  };

  vi.spyOn(internals, "readViaMiotBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 5],
      ["mode", "auto"],
    ]),
  );
  vi.spyOn(internals, "readViaLegacyBatch").mockRejectedValue(
    new Error("command error"),
  );
  // Should NOT throw - just use defaults for missing properties
  const state = await internals.readViaMiot();
  expect(state.power).toBe(true);
  expect(state.buzzer_volume).toBe(0); // default

  await transport.close();
});

it("readViaLegacy converts buzzer 'on'/'off' values via toBuzzerVolume", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
    readViaLegacyBatch: (
      props: readonly string[],
    ) => Promise<Map<string, unknown>>;
    readViaLegacy: (props: readonly string[]) => Promise<DeviceState>;
  };

  // Test "on" → 100
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["buzzer_volume", "on"],
    ]),
  );
  const onState = await internals.readViaLegacy(["power"]);
  expect(onState.buzzer_volume).toBe(100);

  // Test "off" → 0
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["buzzer_volume", "off"],
    ]),
  );
  const offState = await internals.readViaLegacy(["power"]);
  expect(offState.buzzer_volume).toBe(0);

  // Test true → 100
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["buzzer_volume", true],
    ]),
  );
  const trueState = await internals.readViaLegacy(["power"]);
  expect(trueState.buzzer_volume).toBe(100);

  // Test false → 0
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["buzzer_volume", false],
    ]),
  );
  const falseState = await internals.readViaLegacy(["power"]);
  expect(falseState.buzzer_volume).toBe(0);

  // Test numeric 50 still works
  vi.spyOn(internals, "readViaLegacyBatch").mockResolvedValue(
    new Map<string, unknown>([
      ["power", true],
      ["fan_level", 2],
      ["mode", "auto"],
      ["buzzer_volume", 50],
    ]),
  );
  const numericState = await internals.readViaLegacy(["power"]);
  expect(numericState.buzzer_volume).toBe(50);

  await transport.close();
});
