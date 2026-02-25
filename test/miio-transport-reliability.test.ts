import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState } from "../src/core/types";

const legacyEmptyState: DeviceState = {
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

describe("ModernMiioTransport reliability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not mask retryable MIOT fallback errors as null state", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 50,
      operationTimeoutMs: 50,
    });

    const retryableError = Object.assign(new Error("network timeout"), {
      code: "ETIMEDOUT",
    });

    const transportInternals = transport as unknown as {
      detectProtocolMode: () => Promise<"legacy" | "miot" | null>;
      readViaLegacy: () => Promise<DeviceState>;
      readViaMiot: () => Promise<DeviceState>;
    };

    const detectProtocolMode = vi
      .spyOn(transportInternals, "detectProtocolMode")
      .mockResolvedValue("legacy");
    const readViaLegacy = vi
      .spyOn(transportInternals, "readViaLegacy")
      .mockResolvedValue(legacyEmptyState);
    const readViaMiot = vi
      .spyOn(transportInternals, "readViaMiot")
      .mockRejectedValue(retryableError);

    await expect(transport.getProperties([])).rejects.toBe(retryableError);
    expect(detectProtocolMode).toHaveBeenCalledTimes(1);
    expect(readViaLegacy).toHaveBeenCalledTimes(1);
    expect(readViaMiot).toHaveBeenCalledTimes(1);

    await transport.close();
  });

  it("close is idempotent after socket shutdown", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 50,
      operationTimeoutMs: 50,
    });

    await expect(transport.close()).resolves.toBeUndefined();
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it("does not downgrade retryable MIOT read errors to legacy fallback", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 50,
      operationTimeoutMs: 50,
    });

    const retryableError = Object.assign(new Error("temporary wifi loss"), {
      code: "EHOSTUNREACH",
    });

    const transportInternals = transport as unknown as {
      detectProtocolMode: () => Promise<"legacy" | "miot" | null>;
      readViaMiot: () => Promise<DeviceState>;
      readViaLegacy: () => Promise<DeviceState>;
    };

    vi.spyOn(transportInternals, "detectProtocolMode").mockResolvedValue("miot");
    vi.spyOn(transportInternals, "readViaMiot").mockRejectedValue(retryableError);
    const readViaLegacy = vi
      .spyOn(transportInternals, "readViaLegacy")
      .mockResolvedValue(legacyEmptyState);

    await expect(transport.getProperties([])).rejects.toBe(retryableError);
    expect(readViaLegacy).not.toHaveBeenCalled();

    await transport.close();
  });

  it("does not mask retryable legacy property read errors", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 50,
      operationTimeoutMs: 50,
    });

    const retryableError = Object.assign(new Error("router restart"), {
      code: "ETIMEDOUT",
    });

    const transportInternals = transport as unknown as {
      detectProtocolMode: () => Promise<"legacy" | "miot" | null>;
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    };

    vi.spyOn(transportInternals, "detectProtocolMode").mockResolvedValue("legacy");
    vi.spyOn(transportInternals, "call").mockRejectedValue(retryableError);

    await expect(transport.getProperties([])).rejects.toBe(retryableError);

    await transport.close();
  });

  it("fails fast on socket error without waiting for timeout", async () => {
    class FakeSocket extends EventEmitter {
      public send(
        _packet: Buffer,
        _port: number,
        _address: string,
        callback: (error: Error | null) => void,
      ): void {
        callback(null);
      }

      public close(callback?: () => void): void {
        callback?.();
      }
    }

    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    });

    const fakeSocket = new FakeSocket();
    const transportInternals = transport as unknown as {
      socket: FakeSocket;
      sendAndReceive: (
        packet: Buffer,
        expectEncrypted: boolean,
        expectedResponseId?: number,
      ) => Promise<Buffer>;
    };
    transportInternals.socket = fakeSocket;

    const failure = Object.assign(new Error("wifi disconnected"), {
      code: "ENETUNREACH",
    });

    const pending = transportInternals.sendAndReceive(Buffer.alloc(32), false);
    fakeSocket.emit("error", failure);

    await expect(pending).rejects.toBe(failure);

    await transport.close();
  });

  it("emits diagnostics for suppressed socket and detection errors", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    class FakeSocket extends EventEmitter {
      public send(
        _packet: Buffer,
        _port: number,
        _address: string,
        callback: (error: Error | null) => void,
      ): void {
        callback(null);
      }

      public close(callback?: () => void): void {
        callback?.();
      }
    }

    const fakeSocket = new FakeSocket();
    vi.spyOn(dgram, "createSocket").mockReturnValue(fakeSocket as unknown as dgram.Socket);

    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      connectTimeoutMs: 50,
      operationTimeoutMs: 50,
    });
    const transportInternals = transport as unknown as {
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
      detectProtocolMode: () => Promise<"miot" | "legacy" | null>;
    };

    fakeSocket.emit("error", Object.assign(new Error("wifi blip"), { code: "ENETDOWN" }));

    vi.spyOn(transportInternals, "call").mockRejectedValue(
      Object.assign(new Error("router unavailable"), { code: "EHOSTUNREACH" }),
    );
    await expect(transportInternals.detectProtocolMode()).resolves.toBeNull();

    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining("[miio-transport:socket]"));
    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringContaining("[miio-transport:detect-miot]"),
    );
    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringContaining("[miio-transport:detect-legacy]"),
    );

    await transport.close();
  });
});

it("uses MIOT batch read to minimize round-trips", async () => {
  const transport = new ModernMiioTransport({
    address: "127.0.0.1",
    token: "00112233445566778899aabbccddeeff",
    model: "zhimi.airpurifier.pro",
    connectTimeoutMs: 50,
    operationTimeoutMs: 50,
  });

  const transportInternals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiot: () => Promise<DeviceState>;
  };

  const call = vi.spyOn(transportInternals, "call").mockImplementation(async (_method, params) => {
    const items = params as Array<{
      did: string;
      siid: number;
      piid: number;
    }>;
    return items.map((item) => ({
      did: item.did,
      siid: item.siid,
      piid: item.piid,
      code: 0,
      value:
        item.siid === 2 && item.piid === 2
          ? true
          : item.siid === 10 && item.piid === 10
            ? 9
            : item.siid === 2 && item.piid === 5
              ? 0
              : item.siid === 3 && item.piid === 8
                ? 24
                : item.siid === 3 && item.piid === 7
                  ? 41
                  : item.siid === 3 && item.piid === 6
                    ? 12
                    : item.siid === 4 && item.piid === 3
                      ? 70
                      : item.siid === 7 && item.piid === 1
                        ? false
                        : item.siid === 6 && item.piid === 1
                          ? 0
                          : item.siid === 5 && item.piid === 1
                            ? 50
                            : item.siid === 10 && item.piid === 8
                              ? 1200
                              : item.siid === 4 && item.piid === 2
                                ? 30
                                : item.siid === 4 && item.piid === 1
                                  ? 400
                                  : 0,
    }));
  });

  const state = await transportInternals.readViaMiot();

  expect(call).toHaveBeenCalledTimes(1);
  expect(state).toMatchObject({
    power: true,
    fan_level: 9,
    mode: "auto",
    temperature: 24,
    humidity: 41,
    aqi: 12,
    filter1_life: 70,
    child_lock: false,
    led: true,
    buzzer_volume: 50,
    motor1_speed: 1200,
    use_time: 30,
    purify_volume: 400,
  });

  await transport.close();
});

it("falls back to per-property MIOT reads when batch query is unsupported", async () => {
  const transport = new ModernMiioTransport({
    address: "127.0.0.1",
    token: "00112233445566778899aabbccddeeff",
    model: "zhimi.airpurifier.pro",
    connectTimeoutMs: 50,
    operationTimeoutMs: 50,
  });

  const transportInternals = transport as unknown as {
    call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    readViaMiot: () => Promise<DeviceState>;
  };

  const call = vi.spyOn(transportInternals, "call").mockImplementation(async (_method, params) => {
    const items = params as Array<{
      did: string;
      siid: number;
      piid: number;
    }>;
    if (items.length > 1) {
      throw new Error("unsupported batch get_properties");
    }

    const [item] = items;
    const value =
      item.siid === 2 && item.piid === 2
        ? true
        : item.siid === 10 && item.piid === 10
          ? 7
          : item.siid === 2 && item.piid === 5
            ? 1
            : 0;

    return [
      {
        did: item.did,
        siid: item.siid,
        piid: item.piid,
        code: 0,
        value,
      },
    ];
  });

  const state = await transportInternals.readViaMiot();

  const firstCallParams = call.mock.calls[0]?.[1] as unknown[];
  expect(firstCallParams.length).toBeGreaterThan(1);
  expect(call).toHaveBeenCalledTimes(14);
  expect(state.power).toBe(true);
  expect(state.fan_level).toBe(7);
  expect(state.mode).toBe("sleep");

  await transport.close();
});
