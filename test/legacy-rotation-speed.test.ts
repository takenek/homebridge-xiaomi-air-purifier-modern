import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { DeviceClient } from "../src/core/device-client";
import { ModernMiioTransport } from "../src/core/miio-transport";
import { type FakeService, makeApi, makeLogger } from "./helpers/fake-homekit";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TOKEN = "00112233445566778899aabbccddeeff";
const DEVICE_ID = 0x0a1b2c3d;

const md5 = (...chunks: Buffer[]): Buffer => {
  const hash = createHash("md5");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest();
};

interface MiioRequest {
  id: number;
  method: string;
  params: unknown[];
}

type MiioReply =
  | { result: unknown }
  | { error: { code: number; message: string } };

// Wire-level stand-in for a legacy miIO purifier, plugged in as the
// transport's UDP socket: it answers the handshake, drops command frames whose
// device id or checksum is wrong (as real firmware does), decrypts the rest and
// replies with a correctly signed, encrypted payload. `wire` logs every
// handshake and command in the order received. Its answers replay what a
// real Mi Air Purifier 2H (zhimi.airpurifier.mc2, fw 1.4.3_23101) returned in
// #298: set_level_fan is "Method not found", favorite levels 0-16 are stored
// as sent and 17 is rejected with -5001 "invaild_arg" (sic).
class FakeLegacyPurifier extends EventEmitter {
  public readonly requests: MiioRequest[] = [];
  public readonly wire: string[] = [];
  public readonly state: Record<string, unknown> = {
    power: "on",
    mode: "auto",
    favorite_level: 11,
    temp_dec: 233,
    humidity: 48,
    aqi: 7,
    filter1_life: 81,
    child_lock: "off",
    led: "on",
  };
  private readonly token = Buffer.from(TOKEN, "hex");
  private readonly key = md5(this.token);
  private readonly iv = md5(this.key, this.token);

  public constructor(private readonly maxFavoriteLevel = 16) {
    super();
  }

  public send(
    packet: Buffer,
    _port: number,
    _address: string,
    callback: (error: Error | null) => void,
  ): void {
    callback(null);
    let reply: Buffer;
    if (packet.length === 32) {
      this.wire.push("hello");
      reply = this.header(32);
    } else if (this.isAuthentic(packet)) {
      reply = this.reply(packet);
    } else {
      this.wire.push("dropped");
      return;
    }
    setImmediate(() => {
      this.emit("message", reply, {
        address: "127.0.0.1",
        port: 54321,
        family: "IPv4",
        size: reply.length,
      });
    });
  }

  public close(callback?: () => void): void {
    callback?.();
  }

  public methods(): string[] {
    return this.requests.map((request) => request.method);
  }

  private header(length: number): Buffer {
    const header = Buffer.alloc(32, 0);
    header.writeUInt16BE(0x2131, 0);
    header.writeUInt16BE(length, 2);
    header.writeUInt32BE(DEVICE_ID, 8);
    header.writeUInt32BE(1000, 12);
    return header;
  }

  private isAuthentic(packet: Buffer): boolean {
    const checksum = md5(
      packet.subarray(0, 16),
      this.token,
      packet.subarray(32),
    );
    return (
      packet.readUInt32BE(8) === DEVICE_ID &&
      checksum.equals(packet.subarray(16, 32))
    );
  }

  private reply(packet: Buffer): Buffer {
    const decipher = createDecipheriv("aes-128-cbc", this.key, this.iv);
    const request = JSON.parse(
      Buffer.concat([
        decipher.update(packet.subarray(32)),
        decipher.final(),
      ]).toString("utf8"),
    ) as MiioRequest;
    this.requests.push(request);
    this.wire.push(`${request.method} ${JSON.stringify(request.params)}`);

    const cipher = createCipheriv("aes-128-cbc", this.key, this.iv);
    const payload = Buffer.concat([
      cipher.update(
        JSON.stringify({ id: request.id, ...this.handle(request) }),
      ),
      cipher.final(),
    ]);
    const header = this.header(32 + payload.length);
    md5(header.subarray(0, 16), this.token, payload).copy(header, 16);
    return Buffer.concat([header, payload]);
  }

  private handle({ method, params }: MiioRequest): MiioReply {
    switch (method) {
      case "get_prop":
        return {
          result: params.map((name) => this.state[String(name)] ?? null),
        };
      case "set_mode":
        this.state.mode = params[0];
        return { result: ["ok"] };
      case "set_level_favorite": {
        const level = Number(params[0]);
        if (level < 0 || level > this.maxFavoriteLevel) {
          return { error: { code: -5001, message: "invaild_arg" } };
        }
        this.state.favorite_level = level;
        return { result: ["ok"] };
      }
      default:
        // set_level_fan, and the MIOT get_properties/set_properties probes.
        return { error: { code: -32601, message: "Method not found." } };
    }
  }
}

const connect = (device: FakeLegacyPurifier): ModernMiioTransport => {
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    device as unknown as dgram.Socket,
  );
  return new ModernMiioTransport({
    address: "127.0.0.1",
    token: TOKEN,
    model: "zhimi.airpurifier.2h",
    connectTimeoutMs: 500,
    operationTimeoutMs: 500,
  });
};

const favoriteLevelWrites = (device: FakeLegacyPurifier): unknown[] =>
  device.requests
    .filter((request) => request.method === "set_level_favorite")
    .map((request) => request.params[0]);

describe("Rotation Speed on legacy miIO purifiers (#298)", () => {
  it("fake device answers like the 2H recorded in #298", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);
    const internals = transport as unknown as {
      call: (method: string, params: readonly unknown[]) => Promise<unknown>;
    };

    await expect(internals.call("set_level_fan", [8])).rejects.toMatchObject({
      code: "-32601",
      message: "MIIO error -32601: Method not found.",
    });
    await expect(internals.call("set_level_favorite", [0])).resolves.toEqual([
      "ok",
    ]);
    await expect(internals.call("set_level_favorite", [16])).resolves.toEqual([
      "ok",
    ]);
    await expect(
      internals.call("set_level_favorite", [17]),
    ).rejects.toMatchObject({ code: "-5001" });
    await expect(
      internals.call("get_prop", ["mode", "favorite_level"]),
    ).resolves.toEqual(["auto", 16]);

    await transport.close();
  });

  it("writes Rotation Speed as favorite mode + favorite level, never set_level_fan", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [8]);

    expect(device.methods()).not.toContain("set_level_fan");
    expect(device.requests.slice(-2)).toMatchObject([
      { method: "set_mode", params: ["favorite"] },
      { method: "set_level_favorite", params: [8] },
    ]);
    expect(device.state).toMatchObject({ mode: "favorite", favorite_level: 8 });
    expect(device.wire).not.toContain("dropped");
    await expect(transport.getProperties([])).resolves.toMatchObject({
      power: true,
      mode: "favorite",
      fan_level: 8,
      temperature: 23.3,
    });

    await transport.close();
  });

  it.each([
    [0, 1],
    [1, 1],
    [16, 16],
    [99, 16],
  ])("clamps fan level %i to favorite level %i", async (requested, written) => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [requested]);

    expect(favoriteLevelWrites(device)).toEqual([written]);
    expect(device.state.favorite_level).toBe(written);

    await transport.close();
  });

  it.each([15, 16])(
    "retries at favorite level 14 when a 2S (ma2) rejects fan level %i",
    async (requested) => {
      const device = new FakeLegacyPurifier(14);
      const transport = connect(device);

      await transport.setProperty("set_level_fan", [requested]);

      // -5001 is resent once after a fresh handshake before the fallback applies.
      const setModeAt = device.wire.lastIndexOf('set_mode ["favorite"]');
      expect(device.wire.slice(setModeAt)).toEqual([
        'set_mode ["favorite"]',
        `set_level_favorite [${requested}]`,
        "hello",
        `set_level_favorite [${requested}]`,
        "set_level_favorite [14]",
      ]);
      expect(device.state).toMatchObject({
        mode: "favorite",
        favorite_level: 14,
      });

      await transport.close();
    },
  );

  it.each([
    [13, 14],
    [10, 12],
  ])(
    "surfaces the rejection when a device capped at %i refuses fan level %i",
    async (max, requested) => {
      const device = new FakeLegacyPurifier(max);
      const transport = connect(device);

      await expect(
        transport.setProperty("set_level_fan", [requested]),
      ).rejects.toMatchObject({ code: "-5001" });
      expect(favoriteLevelWrites(device)).toEqual([requested, requested]);
      expect(device.state.favorite_level).toBe(11);

      await transport.close();
    },
  );

  it("drives the device from the HomeKit Rotation Speed slider end to end", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999_999,
      sensorPollIntervalMs: 999_999,
      keepAliveIntervalMs: 999_999,
    });
    const api = makeApi();
    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Bedroom",
      "127.0.0.1",
      client,
      "zhimi.airpurifier.2h",
      10,
    );
    await vi.waitFor(() => expect(client.state).not.toBeNull());

    const purifier = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "AirPurifier:Bedroom",
      ) as unknown as FakeService;
    const rotationSpeed = purifier.getCharacteristic(
      api.hap.Characteristic.RotationSpeed,
    );

    await rotationSpeed.onSetHandler?.(100);
    expect(device.state).toMatchObject({
      mode: "favorite",
      favorite_level: 16,
    });

    await rotationSpeed.onSetHandler?.(50);
    expect(device.state.favorite_level).toBe(9);

    // The read-back after each write publishes what the device stored: level 9
    // (53 %) and favorite mode, shown as Manual.
    expect(purifier.updates).toContainEqual({
      characteristic: "rotationSpeed",
      value: 53,
    });
    expect(purifier.updates).toContainEqual({
      characteristic: "targetAirPurifierState",
      value: api.hap.Characteristic.TargetAirPurifierState.MANUAL,
    });
    expect(device.methods()).not.toContain("set_level_fan");
    expect(logger.warn).not.toHaveBeenCalled();

    await client.shutdown();
  });
});
