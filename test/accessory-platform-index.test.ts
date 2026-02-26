import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { ModernMiioTransport } from "../src/core/miio-transport";
import {
  ACCESSORY_NAME,
  PLUGIN_NAME,
  XiaomiAirPurifierAccessoryPlugin,
} from "../src/platform";

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
  public onSet(handler: (value: unknown) => Promise<void> | void): this {
    this.onSetHandler = handler;
    return this;
  }
  public onGet(handler: () => unknown): this {
    this.onGetHandler = handler;
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
        ContactSensorState: {
          UUID: "contactState",
          CONTACT_NOT_DETECTED: 0,
          CONTACT_DETECTED: 1,
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
    listener: (event: {
      state: "connected" | "disconnected" | "reconnected";
    }) => void,
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
      expect(
        typed.setCalls.some((call) => call.characteristic === "name"),
      ).toBe(true);
      expect(
        typed.setCalls.some((call) => call.characteristic === "configuredName"),
      ).toBe(true);
    }

    const modeAutoService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name ===
          "Switch:Mode AUTO ON/OFF",
      ) as unknown as FakeService;
    const modeNightService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name ===
          "Switch:Mode NIGHT ON/OFF",
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
    await modeAutoSetter?.(true);
    await modeAutoSetter?.(false);
    await modeNightSetter?.(true);
    await modeNightSetter?.(false);
    expect(client.calls).toEqual(
      expect.arrayContaining([
        "power:false",
        "child:true",
        "led:false",
        "mode:auto",
        "mode:sleep",
      ]),
    );

    client.state = { ...baseState, power: false, mode: "sleep" };
    await modeAutoSetter?.(false);
    await modeNightSetter?.(true);
    expect(
      client.calls.filter((entry) => entry.startsWith("mode:")),
    ).toHaveLength(4);
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring mode change while device power is OFF.",
    );

    api.emit("shutdown");
    expect(client.calls).toContain("shutdown");
  });

  it("supports native AirPurifier service characteristics when available", async () => {
    const api = makeApi() as unknown as Record<string, unknown>;
    const serviceConstructors = (api.hap as Record<string, unknown>)
      .Service as Record<string, unknown>;
    serviceConstructors.AirPurifier = class extends FakeService {
      public constructor(name: string, subtype?: string) {
        super(`AirPurifier:${name}`, subtype);
      }
    };

    const characteristics = (api.hap as Record<string, unknown>)
      .Characteristic as Record<string, unknown>;
    characteristics.Active = { UUID: "active", ACTIVE: 1, INACTIVE: 0 };
    characteristics.CurrentAirPurifierState = {
      UUID: "currentAirPurifierState",
      INACTIVE: 0,
      PURIFYING_AIR: 2,
    };
    characteristics.TargetAirPurifierState = {
      UUID: "targetAirPurifierState",
      AUTO: 0,
      MANUAL: 1,
    };
    characteristics.RotationSpeed = { UUID: "rotationSpeed" };

    const logger = makeLogger();
    const client = new FakeClient();
    const setFanLevel = vi.fn(async (_value: number) => undefined);
    (client as unknown as { setFanLevel: typeof setFanLevel }).setFanLevel =
      setFanLevel;

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    const purifierService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "AirPurifier:Office",
      ) as unknown as FakeService;

    await purifierService
      .getCharacteristic(characteristics.Active as { UUID: string })
      .onSetHandler?.(1);
    await purifierService
      .getCharacteristic(characteristics.RotationSpeed as { UUID: string })
      .onSetHandler?.(50);

    client.state = { ...baseState, power: false, mode: "sleep", fan_level: 10 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    expect(client.calls).toContain("power:true");
    expect(setFanLevel).toHaveBeenCalled();
    expect(
      purifierService.updates.some(
        (update) =>
          update.characteristic === "active" &&
          update.value === characteristics.Active.INACTIVE,
      ),
    ).toBe(true);
    expect(
      purifierService.updates.some(
        (update) =>
          update.characteristic === "currentAirPurifierState" &&
          update.value === characteristics.CurrentAirPurifierState.INACTIVE,
      ),
    ).toBe(true);
    expect(
      purifierService.updates.some(
        (update) =>
          update.characteristic === "targetAirPurifierState" &&
          update.value === characteristics.TargetAirPurifierState.MANUAL,
      ),
    ).toBe(true);
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
    expect(logger.warn).toHaveBeenCalledWith(
      "Shutdown error: raw-shutdown-error",
    );
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
        (service) =>
          (service as unknown as FakeService).name ===
          "Switch:Mode AUTO ON/OFF",
      ) as unknown as FakeService;
    const modeNightService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name ===
          "Switch:Mode NIGHT ON/OFF",
      ) as unknown as FakeService;

    expect(logger.info).toHaveBeenCalledWith(
      'Connected to "Office" @ 10.0.0.1!',
    );

    for (const listener of client.connectionListeners) {
      listener({ state: "disconnected" });
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'Disconnected from "Office" @ 10.0.0.1 (code UNKNOWN): Unknown error',
    );

    for (const listener of client.connectionListeners) {
      listener({ state: "reconnected" });
    }
    expect(logger.info).toHaveBeenCalledWith(
      'Reconnected to "Office" @ 10.0.0.1.',
    );

    expect(
      modeAutoService.updates.every((update) => update.characteristic === "on"),
    ).toBe(true);
    expect(
      modeNightService.updates.every(
        (update) => update.characteristic === "on",
      ),
    ).toBe(true);

    client.state = { ...baseState, power: false, mode: "sleep" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    expect(
      modeAutoService.updates.some((update) => update.value === false),
    ).toBe(true);
    expect(
      modeNightService.updates.some((update) => update.value === true),
    ).toBe(true);
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
        (service) =>
          (service as unknown as FakeService).name === "Filter:Filter Life",
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
        (service) =>
          (service as unknown as FakeService).name ===
          "Contact:Filter Replace Alert",
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
        (service) =>
          (service as unknown as FakeService).name === "Filter:Filter Life",
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
        (service) =>
          (service as unknown as FakeService).name ===
          "Contact:Filter Replace Alert",
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
        (service) =>
          (service as unknown as FakeService).name === "Filter:Filter Life",
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
      plugin
        ?.getServices()
        .some(
          (service) =>
            (service as unknown as { name?: string }).name ===
            "Contact:Filter Replace Alert",
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
            (service as unknown as { name?: string }).name ===
            "Contact:Filter Replace Alert",
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

    const pluginWithoutAirServices = new XiaomiAirPurifierAccessoryPlugin(
      logger as never,
      {
        name: "NoAirSensors",
        address: "1.1.1.6",
        token: "00112233445566778899aabbccddeeff",
        model: "zhimi.airpurifier.3h",
        enableAirQuality: false,
        enableTemperature: false,
        enableHumidity: false,
        enableChildLockControl: false,
      } as never,
      api as never,
    );
    const noAirServices = pluginWithoutAirServices
      .getServices()
      .map((service) => (service as unknown as FakeService).name);
    expect(noAirServices).not.toContain("AirQuality:NoAirSensors Air Quality");
    expect(noAirServices).not.toContain("Temp:NoAirSensors Temperature");
    expect(noAirServices).not.toContain("Humidity:NoAirSensors Humidity");
    expect(noAirServices).not.toContain("Switch:Child Lock");

    expect(
      () =>
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "BadToken",
            address: "1.1.1.7",
            token: "xyz",
            model: "zhimi.airpurifier.3h",
          } as never,
          api as never,
        ),
    ).toThrow("token must be a 32-character hexadecimal string");

    expect(
      () =>
        new XiaomiAirPurifierAccessoryPlugin(
          logger as never,
          {
            name: "BadModel",
            address: "1.1.1.8",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.unknown",
          } as never,
          api as never,
        ),
    ).toThrow("Unsupported model");

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

  it("handles services without onGet and returns cached onGet values", () => {
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

    const onGetService = {
      UUID: "custom-service",
      subtype: "custom-sub",
      getCharacteristic: vi.fn(() => {
        let handler: (() => unknown) | undefined;
        return {
          onGet: (next: () => unknown) => {
            handler = next;
          },
          run: () => handler?.(),
        };
      }),
    };

    const characteristic = { UUID: "custom-characteristic" };
    (
      accessory as unknown as { bindOnGet: (...args: unknown[]) => void }
    ).bindOnGet(onGetService, characteristic, false);

    const cacheKey = `${onGetService.UUID}:${onGetService.subtype}:${characteristic.UUID}`;
    const bound = onGetService.getCharacteristic.mock.results[0]?.value as {
      run: () => unknown;
    };
    expect(bound.run()).toBe(false);
    (
      accessory as unknown as {
        characteristicCache: Map<string, unknown>;
      }
    ).characteristicCache.set(cacheKey, true);
    expect(bound.run()).toBe(true);

    const undefinedSubtypeService = {
      UUID: "custom-service-undefined-subtype",
      getCharacteristic: vi.fn(() => {
        let handler: (() => unknown) | undefined;
        return {
          onGet: (next: () => unknown) => {
            handler = next;
          },
          run: () => handler?.(),
        };
      }),
    };
    (
      accessory as unknown as {
        bindOnGet: (...args: unknown[]) => void;
        characteristicCache: Map<string, unknown>;
      }
    ).bindOnGet(undefinedSubtypeService, characteristic, false);
    (
      accessory as unknown as {
        characteristicCache: Map<string, unknown>;
      }
    ).characteristicCache.set(
      `${undefinedSubtypeService.UUID}::${characteristic.UUID}`,
      true,
    );
    const undefinedSubtypeBound = undefinedSubtypeService.getCharacteristic.mock
      .results[0]?.value as { run: () => unknown };
    expect(undefinedSubtypeBound.run()).toBe(true);

    const noOnGetService = {
      UUID: "service-no-on-get",
      subtype: undefined,
      getCharacteristic: vi.fn(() => ({})),
    };

    expect(() => {
      (
        accessory as unknown as { bindOnGet: (...args: unknown[]) => void }
      ).bindOnGet(noOnGetService, characteristic, false);
    }).not.toThrow();
  });
});
