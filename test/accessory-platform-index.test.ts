import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { ModernMiioTransport } from "../src/core/miio-transport";
import { ACCESSORY_NAME, PLUGIN_NAME, XiaomiAirPurifierAccessoryPlugin } from "../src/platform";

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
  vi.spyOn(ModernMiioTransport.prototype, "getProperties").mockResolvedValue({
    power: true,
    fan_level: 8,
    mode: "auto",
    temperature: 21,
    humidity: 40,
    aqi: 10,
    filter1_life: 90,
    child_lock: false,
    led: true,
    buzzer_volume: 50,
    motor1_speed: 1000,
    use_time: 10,
    purify_volume: 10,
  });
  vi.spyOn(ModernMiioTransport.prototype, "setProperty").mockResolvedValue();
  vi.spyOn(ModernMiioTransport.prototype, "close").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class FakeCharacteristic {
  public onSetHandler: ((value: unknown) => Promise<void> | void) | null = null;
  public onGetHandler: (() => unknown) | null = null;
  public constructor(public readonly UUID: string) {}
  public onGet(handler: () => unknown): this {
    this.onGetHandler = handler;
    return this;
  }
  public onSet(handler: (value: unknown) => Promise<void> | void): this {
    this.onSetHandler = handler;
    return this;
  }
}

class FakeService {
  public readonly UUID: string;
  public readonly subtype: string | undefined;
  public updates: Array<{ characteristic: string; value: unknown }> = [];
  public readonly setCalls: Array<{ characteristic: string; value: unknown }> = [];
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  public constructor(
    public readonly name: string,
    subtype?: string,
  ) {
    this.UUID = name;
    this.subtype = subtype;
  }

  public setCharacteristic(characteristic: { UUID: string }, value: unknown): this {
    this.setCalls.push({ characteristic: characteristic.UUID, value });
    return this;
  }

  public getCharacteristic(characteristic: { UUID: string }): FakeCharacteristic {
    const existing = this.characteristics.get(characteristic.UUID);
    if (existing) {
      return existing;
    }
    const created = new FakeCharacteristic(characteristic.UUID);
    this.characteristics.set(characteristic.UUID, created);
    return created;
  }

  public updateCharacteristic(characteristic: { UUID: string }, value: unknown): this {
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
        ContactSensor: class extends FakeService {
          public constructor(name: string, subtype?: string) {
            super(`Contact:${name}`, subtype);
          }
        },
      },
      Characteristic: {
        Manufacturer: { UUID: "manufacturer" },
        Model: { UUID: "model" },
        Name: { UUID: "name" },
        ...(withConfiguredName ? { ConfiguredName: { UUID: "configuredName" } } : {}),
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
        ContactSensorState: {
          UUID: "contactState",
          CONTACT_DETECTED: 0, // matches real HAP value
          CONTACT_NOT_DETECTED: 1, // matches real HAP value
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
  public readonly connectionListeners: Array<
    (event: { state: "connected" | "disconnected" | "reconnected" }) => void
  > = [];
  public readonly calls: string[] = [];
  public onStateUpdate(listener: (state: typeof baseState) => void): void {
    this.listeners.push(listener);
  }
  public onConnectionEvent(
    listener: (event: { state: "connected" | "disconnected" | "reconnected" }) => void,
  ): void {
    this.connectionListeners.push(listener);
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
  it("publishes Power, Child Lock, LED and separate AUTO/NIGHT mode switches", async () => {
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
      "Switch:Mode AUTO ON/OFF",
      "Switch:Mode NIGHT ON/OFF",
    ]);

    for (const service of accessory.getServices()) {
      const typed = service as unknown as FakeService;
      if (!typed.name.startsWith("Switch:")) {
        continue;
      }
      expect(typed.setCalls.some((call) => call.characteristic === "name")).toBe(true);
      expect(typed.setCalls.some((call) => call.characteristic === "configuredName")).toBe(true);
    }

    const modeAutoService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Mode AUTO ON/OFF",
      ) as unknown as FakeService;
    const modeNightService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Mode NIGHT ON/OFF",
      ) as unknown as FakeService;
    const modeAutoSetter = modeAutoService.getCharacteristic(
      api.hap.Characteristic.On,
    ).onSetHandler;
    const modeNightSetter = modeNightService.getCharacteristic(
      api.hap.Characteristic.On,
    ).onSetHandler;

    const powerService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Power",
      ) as unknown as FakeService;
    const childService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Child Lock",
      ) as unknown as FakeService;
    const ledService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:LED Night Mode",
      ) as unknown as FakeService;

    await powerService.getCharacteristic(api.hap.Characteristic.On).onSetHandler?.(false);
    await childService.getCharacteristic(api.hap.Characteristic.On).onSetHandler?.(true);
    await ledService.getCharacteristic(api.hap.Characteristic.On).onSetHandler?.(false);
    await modeAutoSetter?.(true);
    await modeAutoSetter?.(false);
    await modeNightSetter?.(true);
    await modeNightSetter?.(false);
    expect(client.calls).toEqual(
      expect.arrayContaining(["power:false", "child:true", "led:false", "mode:auto", "mode:sleep"]),
    );

    client.state = { ...baseState, power: false, mode: "sleep" };
    await modeAutoSetter?.(false);
    await modeNightSetter?.(true);
    expect(client.calls.filter((entry) => entry.startsWith("mode:"))).toHaveLength(4);
    expect(logger.debug).toHaveBeenCalledWith("Ignoring mode change while device power is OFF.");

    api.emit("shutdown");
    expect(client.calls).toContain("shutdown");
  });

  it("logs shutdown error instead of leaving unhandled rejection", async () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();
    client.shutdown = vi.fn().mockRejectedValue(new Error("close-failed"));

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
    api.emit("shutdown");
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith("Shutdown error: close-failed");
  });

  it("logs non-Error shutdown rejection", async () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();
    client.shutdown = vi.fn().mockRejectedValue("raw-shutdown-error");

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
    api.emit("shutdown");
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith("Shutdown error: raw-shutdown-error");
  });

  it("updates AUTO and NIGHT mode switches based on current state and avoids duplicate pushes", () => {
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
    for (const listener of client.connectionListeners) {
      listener({ state: "connected" });
    }
    for (const listener of client.listeners) {
      listener(client.state);
    }
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const modeAutoService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Mode AUTO ON/OFF",
      ) as unknown as FakeService;
    const modeNightService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Switch:Mode NIGHT ON/OFF",
      ) as unknown as FakeService;

    expect(logger.info).toHaveBeenCalledWith('Connected to "Office" @ 10.0.0.1!');

    for (const listener of client.connectionListeners) {
      listener({ state: "disconnected" });
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'Disconnected from "Office" @ 10.0.0.1 (code UNKNOWN): Unknown error',
    );

    for (const listener of client.connectionListeners) {
      listener({ state: "reconnected" });
    }
    expect(logger.info).toHaveBeenCalledWith('Reconnected to "Office" @ 10.0.0.1.');

    expect(modeAutoService.updates.every((update) => update.characteristic === "on")).toBe(true);
    expect(modeNightService.updates.every((update) => update.characteristic === "on")).toBe(true);

    client.state = { ...baseState, power: false, mode: "sleep" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    expect(modeAutoService.updates.some((update) => update.value === false)).toBe(true);
    expect(modeNightService.updates.some((update) => update.value === true)).toBe(true);
  });

  it("toggles FilterChangeIndication when filter life crosses threshold", () => {
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
      true,
    );

    const filterService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Filter:Filter Life",
      ) as unknown as FakeService;

    client.state = { ...baseState, filter1_life: 5 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    client.state = { ...baseState, filter1_life: 100 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const indicationUpdates = filterService.updates.filter(
      (update) => update.characteristic === "filterIndication",
    );
    const alertService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Contact:Filter Replace Alert",
      ) as unknown as FakeService;
    const contactUpdates = alertService.updates.filter(
      (update) => update.characteristic === "contactState",
    );

    expect(indicationUpdates.some((update) => update.value === 1)).toBe(true);
    expect(indicationUpdates.some((update) => update.value === 0)).toBe(true);
    expect(contactUpdates.some((update) => update.value === 1)).toBe(true);
    expect(contactUpdates.some((update) => update.value === 0)).toBe(true);
  });

  it("uses numeric fallbacks for FilterChangeIndication enum values", () => {
    const api = makeApi();
    const filterCharacteristic = (
      api as unknown as {
        hap: {
          Characteristic: { FilterChangeIndication: Record<string, unknown> };
        };
      }
    ).hap.Characteristic.FilterChangeIndication;
    delete filterCharacteristic.CHANGE_FILTER;
    delete filterCharacteristic.FILTER_OK;
    const contactCharacteristic = (
      api as unknown as {
        hap: {
          Characteristic: { ContactSensorState: Record<string, unknown> };
        };
      }
    ).hap.Characteristic.ContactSensorState;
    delete contactCharacteristic.CONTACT_DETECTED;
    delete contactCharacteristic.CONTACT_NOT_DETECTED;

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
      true,
    );

    const filterService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Filter:Filter Life",
      ) as unknown as FakeService;

    client.state = { ...baseState, filter1_life: 5 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    client.state = { ...baseState, filter1_life: 100 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const indicationUpdates = filterService.updates.filter(
      (update) => update.characteristic === "filterIndication",
    );
    const alertService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Contact:Filter Replace Alert",
      ) as unknown as FakeService;
    const contactUpdates = alertService.updates.filter(
      (update) => update.characteristic === "contactState",
    );

    expect(indicationUpdates.some((update) => update.value === 1)).toBe(true);
    expect(indicationUpdates.some((update) => update.value === 0)).toBe(true);
    expect(contactUpdates.some((update) => update.value === 1)).toBe(true);
    expect(contactUpdates.some((update) => update.value === 0)).toBe(true);
  });

  it("uses numeric fallbacks for FilterChangeIndication when ContactSensor alert is enabled", () => {
    const api = makeApi();
    const filterCharacteristic = (
      api as unknown as {
        hap: {
          Characteristic: { FilterChangeIndication: Record<string, unknown> };
        };
      }
    ).hap.Characteristic.FilterChangeIndication;
    delete filterCharacteristic.CHANGE_FILTER;
    delete filterCharacteristic.FILTER_OK;

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
      true,
    );

    const filterService = accessory
      .getServices()
      .find(
        (service) => (service as unknown as FakeService).name === "Filter:Filter Life",
      ) as unknown as FakeService;

    client.state = { ...baseState, filter1_life: 4 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    client.state = { ...baseState, filter1_life: 100 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const indicationUpdates = filterService.updates.filter(
      (update) => update.characteristic === "filterIndication",
    );

    expect(indicationUpdates.some((update) => update.value === 1)).toBe(true);
    expect(indicationUpdates.some((update) => update.value === 0)).toBe(true);
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
        service.setCalls.some((call) => call.characteristic === "configuredName"),
      ),
    ).toBe(false);
  });

  it("onGet handlers return current state values", () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();
    client.state = { ...baseState, power: true, mode: "sleep", filter1_life: 5 };

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
      true,
    );

    const Char = (api as unknown as { hap: { Characteristic: Record<string, { UUID: string }> } })
      .hap.Characteristic;

    const findService = (name: string) =>
      accessory
        .getServices()
        .find((s) => (s as unknown as FakeService).name === name) as unknown as FakeService;

    const getHandler = (service: FakeService, char: { UUID: string }) =>
      service.getCharacteristic(char).onGetHandler;

    const powerService = findService("Switch:Power");
    expect(getHandler(powerService, Char.On)?.()).toBe(true);

    const airQualityService = findService("AirQuality:Office Air Quality");
    expect(getHandler(airQualityService, Char.AirQuality)?.()).toBe(1);

    const tempService = findService("Temp:Office Temperature");
    expect(getHandler(tempService, Char.CurrentTemperature)?.()).toBe(21);

    const humidityService = findService("Humidity:Office Humidity");
    expect(getHandler(humidityService, Char.CurrentRelativeHumidity)?.()).toBe(38);

    const childLockService = findService("Switch:Child Lock");
    expect(getHandler(childLockService, Char.On)?.()).toBe(false);

    const ledService = findService("Switch:LED Night Mode");
    expect(getHandler(ledService, Char.On)?.()).toBe(true);

    const modeAutoService = findService("Switch:Mode AUTO ON/OFF");
    expect(getHandler(modeAutoService, Char.On)?.()).toBe(false);

    const modeNightService = findService("Switch:Mode NIGHT ON/OFF");
    expect(getHandler(modeNightService, Char.On)?.()).toBe(true);

    const filterService = findService("Filter:Filter Life");
    expect(getHandler(filterService, Char.FilterLifeLevel)?.()).toBe(5);
    expect(getHandler(filterService, Char.FilterChangeIndication)?.()).toBe(1);

    const alertService = findService("Contact:Filter Replace Alert");
    expect(getHandler(alertService, Char.ContactSensorState)?.()).toBe(1);

    // Test fallback values when state is null
    client.state = null;
    expect(getHandler(powerService, Char.On)?.()).toBe(false);
    expect(getHandler(airQualityService, Char.AirQuality)?.()).toBe(1);
    expect(getHandler(tempService, Char.CurrentTemperature)?.()).toBe(0);
    expect(getHandler(humidityService, Char.CurrentRelativeHumidity)?.()).toBe(0);
    expect(getHandler(childLockService, Char.On)?.()).toBe(false);
    expect(getHandler(ledService, Char.On)?.()).toBe(false);
    expect(getHandler(modeAutoService, Char.On)?.()).toBe(false);
    expect(getHandler(modeNightService, Char.On)?.()).toBe(false);
    expect(getHandler(filterService, Char.FilterLifeLevel)?.()).toBe(0);
    expect(getHandler(filterService, Char.FilterChangeIndication)?.()).toBe(0);
    expect(getHandler(alertService, Char.ContactSensorState)?.()).toBe(0);
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
    expect(logger.warn).toHaveBeenCalledWith("Initial device connection failed: offline");
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
  expect(logger.warn).toHaveBeenCalledWith("Initial device connection failed: raw-error");

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
      plugin
        ?.getServices()
        .some(
          (service) =>
            (service as unknown as { name?: string }).name === "Contact:Filter Replace Alert",
        ),
    ).toBe(false);
    expect(
      (
        plugin as unknown as {
          delegate: { filterChangeThreshold: number };
        }
      ).delegate.filterChangeThreshold,
    ).toBe(10);

    const pluginWithAlert = new XiaomiAirPurifierAccessoryPlugin(
      logger as never,
      {
        name: "AlertEnabled",
        address: "1.1.1.4",
        token: "00112233445566778899aabbccddeeff",
        model: "zhimi.airpurifier.3h",
        exposeFilterReplaceAlertSensor: true,
      } as never,
      api as never,
    );
    expect(
      pluginWithAlert
        .getServices()
        .some(
          (service) =>
            (service as unknown as { name?: string }).name === "Contact:Filter Replace Alert",
        ),
    ).toBe(true);

    expect(
      (
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "StringThreshold",
            address: "1.1.1.3",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
            filterChangeThreshold: "9.6",
          } as never,
          api as never,
        ) as unknown as {
          delegate: { filterChangeThreshold: number };
        }
      ).delegate.filterChangeThreshold,
    ).toBe(10);

    expect(
      (
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "InvalidStringThreshold",
            address: "1.1.1.4",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
            filterChangeThreshold: "not-a-number",
          } as never,
          api as never,
        ) as unknown as {
          delegate: { filterChangeThreshold: number };
        }
      ).delegate.filterChangeThreshold,
    ).toBe(10);

    expect(
      (
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "DefaultThreshold",
            address: "1.1.1.5",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          } as never,
          api as never,
        ) as unknown as {
          delegate: { filterChangeThreshold: number };
        }
      ).delegate.filterChangeThreshold,
    ).toBe(10);
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
            connectTimeoutMs: 50.4,
            operationTimeoutMs: 80.2,
            reconnectDelayMs: 99.9,
            keepAliveIntervalMs: 500,
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

    expect(
      () =>
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "Bad Token",
            address: "1.1.1.1",
            token: "not-a-hex-token!!!",
            model: "zhimi.airpurifier.3h",
          } as never,
          api as never,
        ),
    ).toThrow("Config field 'token' must be a 32-character hexadecimal string");

    const warnLogger = makeLogger();
    new XiaomiAirPurifierAccessoryPlugin(
      warnLogger as never,
      {
        name: "Unknown Model",
        address: "1.1.1.9",
        token: "00112233445566778899aabbccddeeff",
        model: "zhimi.airpurifier.unknown",
      } as never,
      api as never,
    );
    expect(warnLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unrecognized model "zhimi.airpurifier.unknown"'),
    );
  });
});
