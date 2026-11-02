import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { DeviceClient } from "../src/core/device-client";
import type { ModernMiioTransport } from "../src/core/miio-transport";
import { type FakeService, makeApi, makeLogger } from "./helpers/fake-homekit";
import {
  connectFakeDevice,
  FakeMiioDevice,
  type MiioReply,
  type MiioRequest,
} from "./helpers/fake-miio-device";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Legacy miIO purifier on the wire (see FakeMiioDevice). Its answers replay what a
// real Mi Air Purifier 2H (zhimi.airpurifier.mc2, fw 1.4.3_23101) returned in
// #298: set_level_fan is "Method not found", favorite levels 0-16 are stored
// as sent and 17 is rejected with -5001 "invaild_arg" (sic). `maxFavoriteLevel`
// models firmware with a lower ceiling (the 2S ma2 reportedly stops at 14; its
// rejection code is unrecorded, so -5001 is assumed), `rejectNextFavoriteWrites`
// models a one-off -5001, and
// `getPropLimit` models firmware that cannot answer more than N names in one
// get_prop, either by cutting the reply short or with an error.
class FakeLegacyPurifier extends FakeMiioDevice {
  public rejectNextFavoriteWrites = 0;
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

  public constructor(
    public maxFavoriteLevel = 16,
    private readonly getPropLimit?: {
      names: number;
      overflow: "truncate" | "error";
    },
  ) {
    super();
  }

  protected handle({ method, params }: MiioRequest): MiioReply {
    switch (method) {
      case "get_prop": {
        const values = params.map((name) => this.state[String(name)] ?? null);
        const limit = this.getPropLimit;
        if (limit && params.length > limit.names) {
          return limit.overflow === "truncate"
            ? { result: values.slice(0, limit.names) }
            : { error: { code: -30001, message: "Resp invalid json." } };
        }
        return { result: values };
      }
      case "set_mode":
        this.state.mode = params[0];
        return { result: ["ok"] };
      case "set_level_favorite": {
        const level = Number(params[0]);
        if (this.rejectNextFavoriteWrites > 0) {
          this.rejectNextFavoriteWrites -= 1;
          return { error: { code: -5001, message: "invaild_arg" } };
        }
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

const connect = (device: FakeLegacyPurifier): ModernMiioTransport =>
  connectFakeDevice(device, "zhimi.airpurifier.2h");

const favoriteLevelWrites = (device: FakeLegacyPurifier): unknown[] =>
  device.requests
    .filter((request) => request.method === "set_level_favorite")
    .map((request) => request.params[0]);

const getPropSizes = (device: FakeLegacyPurifier): number[] =>
  device.requests
    .filter((request) => request.method === "get_prop")
    .map((request) => request.params.length);

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

  it("steps down one level at a time when firmware capped at 14 (as reported for the 2S ma2) rejects higher levels with -5001", async () => {
    const device = new FakeLegacyPurifier(14);
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [16]);

    // Each -5001 is resent once after a fresh handshake, then the next level
    // down is tried.
    const setModeAt = device.wire.lastIndexOf('set_mode ["favorite"]');
    expect(device.wire.slice(setModeAt)).toEqual([
      'set_mode ["favorite"]',
      "set_level_favorite [16]",
      "hello",
      "set_level_favorite [16]",
      "set_level_favorite [15]",
      "hello",
      "set_level_favorite [15]",
      "set_level_favorite [14]",
    ]);
    expect(device.state).toMatchObject({
      mode: "favorite",
      favorite_level: 14,
    });

    await transport.close();
  });

  it.each([
    [14, 15],
    [13, 16],
    [13, 14],
    [10, 16],
  ])(
    "settles on the ceiling of a device capped at %i for fan level %i",
    async (max, requested) => {
      const device = new FakeLegacyPurifier(max);
      const transport = connect(device);

      await transport.setProperty("set_level_fan", [requested]);

      expect(favoriteLevelWrites(device).at(-1)).toBe(max);
      expect(device.state.favorite_level).toBe(max);

      await transport.close();
    },
  );

  it("remembers the ceiling it found and clamps later writes to it", async () => {
    const device = new FakeLegacyPurifier(14);
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [16]);
    device.requests.length = 0;

    await transport.setProperty("set_level_fan", [16]);
    await transport.setProperty("set_level_fan", [9]);
    await transport.setProperty("set_level_fan", [15]);

    // An accepted level below the ceiling must not lower it.
    expect(favoriteLevelWrites(device)).toEqual([14, 9, 14]);
    expect(device.state.favorite_level).toBe(14);

    await transport.close();
  });

  it("keeps the full range after an ordinary lower write", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [9]);
    await transport.setProperty("set_level_fan", [16]);

    expect(favoriteLevelWrites(device)).toEqual([9, 16]);
    expect(device.state.favorite_level).toBe(16);

    await transport.close();
  });

  it("does not learn a ceiling from a one-off -5001 below a level the device already took", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [16]);

    // Both the write and its resend after a fresh handshake are rejected once.
    device.rejectNextFavoriteWrites = 2;
    await transport.setProperty("set_level_fan", [13]);
    device.requests.length = 0;
    await transport.setProperty("set_level_fan", [16]);

    expect(favoriteLevelWrites(device)).toEqual([16]);
    expect(device.state.favorite_level).toBe(16);

    await transport.close();
  });

  it("forgets the ceiling when the transport is reset", async () => {
    const device = new FakeLegacyPurifier(14);
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [16]);

    await transport.reset();
    device.requests.length = 0;
    await transport.setProperty("set_level_fan", [16]);

    expect(favoriteLevelWrites(device)[0]).toBe(16);
    expect(device.state.favorite_level).toBe(14);

    await transport.close();
  });

  it("forgets the levels a device accepted when the transport is reset", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [16]);

    // After the reset the purifier caps lower; the earlier 16 must not block
    // learning the new ceiling.
    device.maxFavoriteLevel = 14;
    await transport.reset();
    await transport.setProperty("set_level_fan", [16]);
    device.requests.length = 0;
    await transport.setProperty("set_level_fan", [16]);

    expect(favoriteLevelWrites(device)).toEqual([14]);

    await transport.close();
  });

  it("stops stepping down at level 10 and keeps the ceiling unchanged", async () => {
    const device = new FakeLegacyPurifier(8);
    const transport = connect(device);

    await expect(
      transport.setProperty("set_level_fan", [12]),
    ).rejects.toMatchObject({ code: "-5001" });
    expect(favoriteLevelWrites(device)).toEqual([12, 12, 11, 11, 10, 10]);
    expect(device.state.favorite_level).toBe(11);

    device.requests.length = 0;
    await expect(
      transport.setProperty("set_level_fan", [16]),
    ).rejects.toMatchObject({ code: "-5001" });
    expect(favoriteLevelWrites(device)[0]).toBe(16);

    await transport.close();
  });

  it("surfaces a -5001 for a level at or below 10 without stepping down", async () => {
    const device = new FakeLegacyPurifier(5);
    const transport = connect(device);

    await expect(
      transport.setProperty("set_level_fan", [8]),
    ).rejects.toMatchObject({ code: "-5001" });
    expect(favoriteLevelWrites(device)).toEqual([8, 8]);

    await transport.close();
  });

  it("reads legacy status in get_prop requests of at most 15 names", async () => {
    const device = new FakeLegacyPurifier();
    const transport = connect(device);

    await transport.getProperties([]);

    const sizes = getPropSizes(device);
    // The protocol probe asks for one name; the status read is split in two.
    expect(sizes.slice(-2)).toEqual([15, 3]);

    await transport.close();
  });

  it.each([
    [16, "truncate"],
    [16, "error"],
    // A reply cut short in the first request must not shift the second.
    [14, "truncate"],
  ] as const)(
    "reads a device that cannot answer more than %i names (%s)",
    async (names, overflow) => {
      const device = new FakeLegacyPurifier(16, { names, overflow });
      device.state.motor1_speed = 780;
      device.state.use_time = 2_160_000;
      device.state.purify_volume = 123_456;
      const transport = connect(device);

      await expect(transport.getProperties([])).resolves.toMatchObject({
        power: true,
        mode: "auto",
        fan_level: 11,
        temperature: 23.3,
        motor1_speed: 780,
        use_time: 2_160_000,
        purify_volume: 123_456,
      });

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
