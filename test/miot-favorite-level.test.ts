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

interface MiotItem {
  did: string;
  siid: number;
  piid: number;
  value?: unknown;
}

// MIOT purifier on the wire (see FakeMiioDevice), modelled on the 3H
// (zhimi.airpurifier.mb3): its favorite level, siid 10 piid 10, accepts 0-14
// and any other value is refused per item. Legacy commands (get_prop,
// set_mode, ...) get -5001 "command error", which is what the maintainer's 3H
// answered after plugin 1.1.2 switched it to legacy on a 100 % Rotation Speed.
class FakeMiotPurifier extends FakeMiioDevice {
  public readonly props: Record<string, unknown> = {
    "2.2": true,
    "2.5": 0,
    "2.4": 1,
    "3.6": 7,
    "3.7": 48,
    "3.8": 23,
    "4.1": 200,
    "4.2": 100,
    "4.3": 80,
    "6.1": 0,
    "7.1": false,
    "10.8": 900,
    "10.10": 10,
  };
  public readonly refused = new Set<string>();
  public readonly missing = new Set<string>();

  public constructor(private readonly maxFavoriteLevel = 14) {
    super();
  }

  public favoriteLevelWrites(): unknown[] {
    return this.requests
      .filter((request) => request.method === "set_properties")
      .flatMap((request) => request.params as MiotItem[])
      .filter((item) => item.siid === 10 && item.piid === 10)
      .map((item) => item.value);
  }

  protected handle({ method, params }: MiioRequest): MiioReply {
    const items = params as MiotItem[];
    switch (method) {
      case "get_properties":
        return {
          result: items.map((item) => ({
            ...item,
            code: 0,
            value: this.props[`${item.siid}.${item.piid}`],
          })),
        };
      case "set_properties":
        return {
          result: items.map(({ did, siid, piid, value }) => {
            const key = `${siid}.${piid}`;
            const outOfRange =
              key === "10.10" &&
              (Number(value) < 0 || Number(value) > this.maxFavoriteLevel);
            if (this.missing.has(key)) {
              return { did, siid, piid, code: -4003 };
            }
            if (outOfRange || this.refused.has(key)) {
              return { did, siid, piid, code: -4005 };
            }
            this.props[key] = value;
            return { did, siid, piid, code: 0 };
          }),
        };
      default:
        return { error: { code: -5001, message: "command error" } };
    }
  }
}

const connect = (device: FakeMiotPurifier): ModernMiioTransport =>
  connectFakeDevice(device, "zhimi.airpurifier.3h");

const LEGACY_METHODS = ["get_prop", "set_mode", "set_level_favorite"];

describe("Rotation Speed on MIOT purifiers whose favorite level stops at 14 (3H)", () => {
  it("steps down to 14 and stays on MIOT instead of switching to legacy", async () => {
    const device = new FakeMiotPurifier();
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [16]);

    expect(device.favoriteLevelWrites()).toEqual([16, 15, 14]);
    expect(device.props).toMatchObject({ "2.5": 2, "10.10": 14 });
    await expect(transport.getProperties([])).resolves.toMatchObject({
      power: true,
      mode: "favorite",
      fan_level: 14,
    });
    expect(
      device.methods().filter((method) => LEGACY_METHODS.includes(method)),
    ).toEqual([]);

    await transport.close();
  });

  it("clamps later writes to the ceiling it found", async () => {
    const device = new FakeMiotPurifier();
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [16]);
    device.requests.length = 0;

    await transport.setProperty("set_level_fan", [16]);
    await transport.setProperty("set_level_fan", [9]);

    expect(device.favoriteLevelWrites()).toEqual([14, 9]);
    expect(device.props["10.10"]).toBe(9);

    await transport.close();
  });

  it("learns the ceiling when it steps down to a level the purifier took before", async () => {
    const device = new FakeMiotPurifier();
    const transport = connect(device);
    await transport.setProperty("set_level_fan", [14]);

    await transport.setProperty("set_level_fan", [16]);
    await transport.setProperty("set_level_fan", [16]);

    expect(device.favoriteLevelWrites()).toEqual([14, 16, 15, 14, 14]);

    await transport.close();
  });

  it("steps below level 10 on MIOT, where a refusal is explicit (Pro H spec: 0-9)", async () => {
    const device = new FakeMiotPurifier(9);
    const transport = connect(device);

    await transport.setProperty("set_level_fan", [12]);
    device.requests.length = 0;
    await transport.setProperty("set_level_fan", [16]);

    expect(device.props["10.10"]).toBe(9);
    expect(device.favoriteLevelWrites()).toEqual([9]);

    await transport.close();
  });

  it("does not step down when the favorite level property does not exist", async () => {
    const device = new FakeMiotPurifier();
    device.missing.add("10.10");
    const transport = connect(device);

    await expect(
      transport.setProperty("set_level_fan", [16]),
    ).rejects.toMatchObject({
      code: "-4003",
      message: "MIOT property 10.10 rejected the value (code -4003)",
    });
    expect(device.favoriteLevelWrites()).toEqual([16]);

    await transport.close();
  });

  it("surfaces a refused value of another property and keeps reading over MIOT", async () => {
    const device = new FakeMiotPurifier();
    device.refused.add("7.1");
    const transport = connect(device);

    await expect(
      transport.setProperty("set_child_lock", ["on"]),
    ).rejects.toMatchObject({
      code: "-4005",
      message: "MIOT property 7.1 rejected the value (code -4005)",
    });
    await expect(transport.getProperties([])).resolves.toMatchObject({
      power: true,
      child_lock: false,
    });
    expect(
      device.methods().filter((method) => LEGACY_METHODS.includes(method)),
    ).toEqual([]);

    await transport.close();
  });

  it("keeps the purifier controllable from HomeKit after Rotation Speed 100 %", async () => {
    const device = new FakeMiotPurifier();
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
      "Office",
      "127.0.0.1",
      client,
      "zhimi.airpurifier.3h",
      10,
    );
    await vi.waitFor(() => expect(client.state).not.toBeNull());
    const purifier = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "AirPurifier:Office",
      ) as unknown as FakeService;

    await purifier
      .getCharacteristic(api.hap.Characteristic.RotationSpeed)
      .onSetHandler?.(100);
    expect(device.props).toMatchObject({ "2.5": 2, "10.10": 14 });

    // The write that froze the accessory on 1.1.2: power must still work.
    await purifier
      .getCharacteristic(api.hap.Characteristic.Active)
      .onSetHandler?.(api.hap.Characteristic.Active.INACTIVE);
    expect(device.props["2.2"]).toBe(false);
    expect(client.state?.power).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();

    await client.shutdown();
  });
});
