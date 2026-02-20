import { describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import {
  ACCESSORY_NAME,
  PLUGIN_NAME,
  XiaomiAirPurifierAccessoryPlugin,
} from "../src/platform";

class FakeCharacteristic {
  public onSetHandler: ((value: unknown) => Promise<void> | void) | null = null;
  public constructor(public readonly UUID: string) {}
  public onSet(handler: (value: unknown) => Promise<void> | void): this {
    this.onSetHandler = handler;
    return this;
  }
}

class FakeService {
  public readonly UUID: string;
  public readonly subtype: string | undefined;
  public updates: Array<{ characteristic: string; value: unknown }> = [];
  public readonly setCalls: Array<{ characteristic: string; value: unknown }> =
    [];
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  public constructor(
    public readonly name: string,
    subtype?: string,
  ) {
    this.UUID = name;
    this.subtype = subtype;
  }

  public setCharacteristic(
    characteristic: { UUID: string },
    value: unknown,
  ): this {
    this.setCalls.push({ characteristic: characteristic.UUID, value });
    return this;
  }

  public getCharacteristic(characteristic: {
    UUID: string;
  }): FakeCharacteristic {
    const existing = this.characteristics.get(characteristic.UUID);
    if (existing) {
      return existing;
    }
    const created = new FakeCharacteristic(characteristic.UUID);
    this.characteristics.set(characteristic.UUID, created);
    return created;
  }

  public updateCharacteristic(
    characteristic: { UUID: string },
    value: unknown,
  ): this {
    this.updates.push({ characteristic: characteristic.UUID, value });
    return this;
  }
}

const makeApi = (withConfiguredName = true) => {
  const events = new Map<string, Array<() => void>>();
  const api = {
    hap: {
      Service: {
        AccessoryInformation: class extends FakeService {
          public constructor() {
            super("AccessoryInformation");
          }
        },
        Switch: class extends FakeService {
          public constructor(name: string, subtype?: string) {
            super(`Switch:${name}`, subtype);
          }
        },
        AirQualitySensor: class extends FakeService {
          public constructor(name: string) {
            super(`AirQuality:${name}`);
          }
        },
        TemperatureSensor: class extends FakeService {
          public constructor(name: string) {
            super(`Temp:${name}`);
          }
        },
        HumiditySensor: class extends FakeService {
          public constructor(name: string) {
            super(`Humidity:${name}`);
          }
        },
        FilterMaintenance: class extends FakeService {
          public constructor(name: string) {
            super(`Filter:${name}`);
          }
        },
      },
      Characteristic: {
        Manufacturer: { UUID: "manufacturer" },
        Model: { UUID: "model" },
        Name: { UUID: "name" },
        ...(withConfiguredName
          ? { ConfiguredName: { UUID: "configuredName" } }
          : {}),
        SerialNumber: { UUID: "serial" },
        On: { UUID: "on" },
        AirQuality: { UUID: "airQuality" },
        CurrentTemperature: { UUID: "temp" },
        CurrentRelativeHumidity: { UUID: "humidity" },
        FilterLifeLevel: { UUID: "filterLife" },
        FilterChangeIndication: {
          UUID: "filterIndication",
          CHANGE_FILTER: 1,
          FILTER_OK: 0,
        },
      },
    },
    on: (event: string, cb: () => void) => {
      const arr = events.get(event) ?? [];
      arr.push(cb);
      events.set(event, arr);
    },
    emit: (event: string) => {
      for (const cb of events.get(event) ?? []) {
        cb();
      }
    },
    registerAccessory: vi.fn(),
  };

  return api as unknown as {
    hap: unknown;
    on: (event: string, cb: () => void) => void;
    emit: (event: string) => void;
    registerAccessory: ReturnType<typeof vi.fn>;
  };
};

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const baseState = {
  power: true,
  fan_level: 8,
  mode: "auto" as const,
  temperature: 21,
  humidity: 38,
  aqi: 20,
  filter1_life: 80,
  child_lock: false,
  led: true,
  buzzer_volume: 30,
  motor1_speed: 600,
  use_time: 10,
  purify_volume: 20,
};

class FakeClient {
  public state: typeof baseState | null = { ...baseState };
  public readonly listeners: Array<(state: typeof baseState) => void> = [];
  public readonly calls: string[] = [];
  public onStateUpdate(listener: (state: typeof baseState) => void): void {
    this.listeners.push(listener);
  }
  public async init(): Promise<void> {}
  public async shutdown(): Promise<void> {
    this.calls.push("shutdown");
  }
  public async setPower(value: boolean): Promise<void> {
    this.calls.push(`power:${value}`);
  }
  public async setChildLock(value: boolean): Promise<void> {
    this.calls.push(`child:${value}`);
  }
  public async setLed(value: boolean): Promise<void> {
    this.calls.push(`led:${value}`);
  }
  public async setMode(value: "auto" | "sleep"): Promise<void> {
    this.calls.push(`mode:${value}`);
  }
}

describe("AirPurifierAccessory switch contract", () => {
  it("publishes only Power, Child Lock, LED and single mode switch", async () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    const switchNames = accessory
      .getServices()
      .map((service) => (service as unknown as FakeService).name)
      .filter((name) => name.startsWith("Switch:"));

    expect(switchNames).toEqual([
      "Switch:Power",
      "Switch:Child Lock",
      "Switch:LED Night Mode",
      "Switch:Mode AUTO/NIGHT",
    ]);

    for (const service of accessory.getServices()) {
      const typed = service as unknown as FakeService;
      if (!typed.name.startsWith("Switch:")) {
        continue;
      }
      expect(
        typed.setCalls.some((call) => call.characteristic === "name"),
      ).toBe(true);
      expect(
        typed.setCalls.some((call) => call.characteristic === "configuredName"),
      ).toBe(true);
    }

    const modeService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Switch:Mode AUTO/NIGHT",
      ) as unknown as FakeService;
    const modeSetter = modeService.getCharacteristic(
      api.hap.Characteristic.On,
    ).onSetHandler;

    const powerService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Switch:Power",
      ) as unknown as FakeService;
    const childService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Switch:Child Lock",
      ) as unknown as FakeService;
    const ledService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Switch:LED Night Mode",
      ) as unknown as FakeService;

    await powerService
      .getCharacteristic(api.hap.Characteristic.On)
      .onSetHandler?.(false);
    await childService
      .getCharacteristic(api.hap.Characteristic.On)
      .onSetHandler?.(true);
    await ledService
      .getCharacteristic(api.hap.Characteristic.On)
      .onSetHandler?.(false);
    await modeSetter?.(true);
    await modeSetter?.(false);
    expect(client.calls).toEqual(
      expect.arrayContaining([
        "power:false",
        "child:true",
        "led:false",
        "mode:auto",
      ]),
    );

    client.state = { ...baseState, power: false, mode: "sleep" };
    await modeSetter?.(false);
    expect(
      client.calls.filter((entry) => entry.startsWith("mode:")),
    ).toHaveLength(2);
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring mode change while device power is OFF.",
    );

    api.emit("shutdown");
    expect(client.calls).toContain("shutdown");
  });

  it("updates mode switch availability based on current power and avoids duplicate pushes", () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      90,
    );

    client.state = null;
    for (const listener of client.listeners) {
      listener(baseState);
    }

    client.state = { ...baseState, power: true, mode: "auto" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const modeService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Switch:Mode AUTO/NIGHT",
      ) as unknown as FakeService;

    expect(logger.info).toHaveBeenCalledWith(
      'Connected to "Office" @ 10.0.0.1!',
    );

    expect(
      modeService.updates.every((update) => update.characteristic === "on"),
    ).toBe(true);

    client.state = { ...baseState, power: false, mode: "sleep" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    expect(modeService.updates.some((update) => update.value === false)).toBe(
      true,
    );
  });

  it("falls back gracefully when ConfiguredName characteristic is unavailable", () => {
    const api = makeApi(false);
    const logger = makeLogger();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    const switchServices = accessory
      .getServices()
      .filter((service) =>
        (service as unknown as FakeService).name.startsWith("Switch:"),
      ) as unknown as FakeService[];

    expect(
      switchServices.every((service) =>
        service.setCalls.some((call) => call.characteristic === "name"),
      ),
    ).toBe(true);
    expect(
      switchServices.some((service) =>
        service.setCalls.some(
          (call) => call.characteristic === "configuredName",
        ),
      ),
    ).toBe(false);
  });

  it("logs initial connect failure", async () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();
    client.init = vi.fn().mockRejectedValue(new Error("offline"));

    new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(
      "Initial device connection failed: offline",
    );
  });
});

it("handles non-Error init rejection and internal cache key edge", async () => {
  const api = makeApi();
  const logger = makeLogger();
  const client = new FakeClient();
  client.init = vi.fn().mockRejectedValue("raw-error");

  const accessory = new AirPurifierAccessory(
    api as never,
    logger as never,
    "Office",
    "10.0.0.1",
    client as never,
    "zhimi.airpurifier.3h",
    10,
  );

  await Promise.resolve();
  await Promise.resolve();
  expect(logger.warn).toHaveBeenCalledWith(
    "Initial device connection failed: raw-error",
  );

  (
    accessory as unknown as {
      updateCharacteristicIfNeeded: (
        service: FakeService,
        characteristic: { UUID?: string },
        value: unknown,
      ) => void;
    }
  ).updateCharacteristicIfNeeded(new FakeService("custom"), {}, 1);
});
describe("platform and index", () => {
  it("registers accessory entrypoint", async () => {
    const module = await import("../src/index");
    const register = (module as { default?: (api: unknown) => void }).default;
    const api = makeApi();
    if (!register) {
      throw new Error("Missing register function");
    }
    register(api);

    expect(api.registerAccessory).toHaveBeenCalledWith(
      PLUGIN_NAME,
      ACCESSORY_NAME,
      XiaomiAirPurifierAccessoryPlugin,
    );
  });

  it("validates platform config", () => {
    const api = makeApi();
    const logger = makeLogger();

    let plugin: XiaomiAirPurifierAccessoryPlugin | undefined;
    expect(() => {
      plugin = new XiaomiAirPurifierAccessoryPlugin(
        logger as never,
        {
          name: "Test",
          address: "1.1.1.1",
          token: "00112233445566778899aabbccddeeff",
          model: "zhimi.airpurifier.3h",
          filterChangeThreshold: Number.POSITIVE_INFINITY,
        } as never,
        api as never,
      );
    }).not.toThrow();

    expect(plugin?.getServices()).toBeInstanceOf(Array);

    expect(
      () =>
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "Rounded",
            address: "1.1.1.2",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
            filterChangeThreshold: 42.4,
          } as never,
          api as never,
        ),
    ).not.toThrow();

    expect(
      () =>
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          } as never,
          api as never,
        ),
    ).toThrow("Invalid or missing config field: name");
  });
});
