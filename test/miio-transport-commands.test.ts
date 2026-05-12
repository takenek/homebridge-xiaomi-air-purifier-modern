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

const createTransport = () =>
  new ModernMiioTransport({
    address: "127.0.0.1",
    token: "00112233445566778899aabbccddeeff",
    model: "zhimi.airpurifier.4",
    connectTimeoutMs: 20,
    operationTimeoutMs: 20,
  });

describe("ModernMiioTransport commands and low-level transport", () => {
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

  it("covers call/handshake/sendCommand happy and error paths", async () => {
    const transport = createTransport();
    const internals = transport as unknown as {
      session: {
        deviceId: number;
        deviceStamp: number;
        handshakeAtEpochSec: number;
      } | null;
      shouldRehandshake: (error: unknown) => boolean;
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

    expect(internals.shouldRehandshake(new Error("x"))).toBe(false);
    expect(
      internals.shouldRehandshake(
        Object.assign(new Error("x"), { code: "EIO" }),
      ),
    ).toBe(true);
    expect(internals.shouldRehandshake("not-an-error")).toBe(false);

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

it("does not re-handshake for unrecoverable MIIO command errors", async () => {
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
    shouldRehandshake: (error: unknown) => boolean;
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
    // -123 is not in MIIO_COMMAND_RETRY_CODES, so no re-handshake.
    expect(internals.shouldRehandshake(error)).toBe(false);
  }

  await transport.close();
});

it("does re-handshake for recoverable MIIO command errors (-5001)", async () => {
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
    shouldRehandshake: (error: unknown) => boolean;
  };

  internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
  const errPayload = internals.encrypt(
    Buffer.from(
      JSON.stringify({ error: { code: -5001, message: "command error" } }),
      "utf8",
    ),
  );
  vi.spyOn(internals, "sendAndReceive").mockResolvedValueOnce(
    Buffer.concat([Buffer.alloc(32), errPayload]),
  );

  try {
    await internals.sendCommand("set_power", ["on"]);
  } catch (error: unknown) {
    expect(internals.shouldRehandshake(error)).toBe(true);
  }

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
      candidates: readonly { did: string; siid: number; piid: number }[],
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

it("reports suppressed error on response checksum mismatch", async () => {
  const transport = createTransport();
  const internals = transport as unknown as {
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
    reportSuppressedError: (context: string, error: unknown) => void;
  };

  internals.session = { deviceId: 1, deviceStamp: 1, handshakeAtEpochSec: 1 };
  const okPayload = internals.encrypt(
    Buffer.from(JSON.stringify({ result: ["ok"] }), "utf8"),
  );
  // Build a response with correct header but corrupted checksum (bytes 16-32)
  const header = Buffer.alloc(32, 0);
  header.fill(0xff, 16, 32); // wrong checksum
  const corruptResponse = Buffer.concat([header, okPayload]);

  vi.spyOn(internals, "sendAndReceive").mockResolvedValue(corruptResponse);
  const spy = vi.spyOn(internals, "reportSuppressedError");

  await internals.sendCommand("get_prop", []);
  expect(spy).toHaveBeenCalledWith(
    "checksum",
    expect.objectContaining({ message: expect.stringContaining("checksum") }),
  );

  await transport.close();
});
