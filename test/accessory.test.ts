import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { ModernMiioTransport } from "../src/core/miio-transport";
import {
  FakeClient,
  FakeService,
  makeApi,
  makeLogger,
} from "./helpers/fake-homekit";

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
  motor1_speed: 600,
  use_time: 10,
  purify_volume: 20,
};

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

  it("uses display address in connection lifecycle logs and serial number", () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.*.*",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    const infoService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "AccessoryInformation",
      ) as unknown as FakeService;
    const serialCall = infoService.setCalls.find(
      (call) => call.characteristic === "serial",
    );
    expect(serialCall?.value).toBe("miap-10-0-*-*");

    client.connectionListeners[0]?.({ state: "connected" });
    client.connectionListeners[0]?.({ state: "reconnected" });
    client.connectionListeners[0]?.({
      state: "disconnected",
    });

    expect(logger.info).toHaveBeenCalledWith(
      'Connected to "Office" @ 10.0.*.*!',
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Reconnected to "Office" @ 10.0.*.*.',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Disconnected from "Office" @ 10.0.*.*'),
    );
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
      IDLE: 1,
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

    await purifierService
      .getCharacteristic(
        characteristics.TargetAirPurifierState as { UUID: string },
      )
      .onSetHandler?.(characteristics.TargetAirPurifierState.AUTO);
    expect(client.calls).toContain("mode:auto");

    await purifierService
      .getCharacteristic(
        characteristics.TargetAirPurifierState as { UUID: string },
      )
      .onSetHandler?.(characteristics.TargetAirPurifierState.MANUAL);
    expect(client.calls).toContain("mode:favorite");

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

    // H1: power=true + mode=idle → CurrentAirPurifierState.IDLE
    client.state = { ...baseState, power: true, mode: "idle" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    expect(
      purifierService.updates.some(
        (update) =>
          update.characteristic === "currentAirPurifierState" &&
          update.value === characteristics.CurrentAirPurifierState.IDLE,
      ),
    ).toBe(true);

    // power=true + mode=auto → CurrentAirPurifierState.PURIFYING_AIR
    client.state = { ...baseState, power: true, mode: "auto" };
    for (const listener of client.listeners) {
      listener(client.state);
    }
    expect(
      purifierService.updates.some(
        (update) =>
          update.characteristic === "currentAirPurifierState" &&
          update.value ===
            characteristics.CurrentAirPurifierState.PURIFYING_AIR,
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

  it("uses numeric fallbacks for FilterChangeIndication only (without ContactSensorState enums)", () => {
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

  it("getServices excludes optional services when features are disabled", () => {
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
      {
        enableAirQuality: false,
        enableTemperature: false,
        enableHumidity: false,
        exposeFilterReplaceAlertSensor: false,
        enableChildLockControl: false,
      },
    );

    const serviceNames = accessory
      .getServices()
      .map((service) => (service as unknown as FakeService).name);

    expect(serviceNames).not.toContain(expect.stringContaining("AirQuality"));
    expect(serviceNames).not.toContain(expect.stringContaining("Temp"));
    expect(serviceNames).not.toContain(expect.stringContaining("Humidity"));
    expect(serviceNames).not.toContain("Switch:Child Lock");
    expect(serviceNames).not.toContain(expect.stringContaining("Contact"));
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

describe("services without onGet and cached onGet values", () => {
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

    // Test bindOnGet with a primitive characteristic (no UUID) → early return
    (
      accessory as unknown as { bindOnGet: (...args: unknown[]) => void }
    ).bindOnGet(onGetService, 42, false);

    // Test bindOnGet with null characteristic → early return
    (
      accessory as unknown as { bindOnGet: (...args: unknown[]) => void }
    ).bindOnGet(onGetService, null, false);

    // Test bindOnGet with characteristic that has non-string UUID → early return
    (
      accessory as unknown as { bindOnGet: (...args: unknown[]) => void }
    ).bindOnGet(onGetService, { UUID: 123 }, false);

    // Test updateCharacteristicIfNeeded with a primitive characteristic (no UUID) → early return
    (
      accessory as unknown as {
        updateCharacteristicIfNeeded: (
          service: unknown,
          characteristic: unknown,
          value: unknown,
        ) => void;
      }
    ).updateCharacteristicIfNeeded(new FakeService("custom"), 42, 1);

    // Test updateCharacteristicIfNeeded with null characteristic → early return
    (
      accessory as unknown as {
        updateCharacteristicIfNeeded: (
          service: unknown,
          characteristic: unknown,
          value: unknown,
        ) => void;
      }
    ).updateCharacteristicIfNeeded(new FakeService("custom"), null, 1);
  });
});
