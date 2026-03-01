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
  await expect(
    internals.trySetViaMiot("set_buzzer_volume", [20]),
  ).resolves.toBe(true);
  await expect(internals.trySetViaMiot("set_level_fan", [0])).resolves.toBe(
    true,
  );

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
