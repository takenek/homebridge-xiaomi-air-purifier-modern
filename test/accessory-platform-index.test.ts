import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { ModernMiioTransport } from "../src/core/miio-transport";
import {
  assertHexToken,
  assertString,
  maskAddress,
  normalizeBoolean,
  normalizeModel,
  normalizeThreshold,
  normalizeTimeout,
  PLATFORM_NAME,
  PLUGIN_NAME,
  XiaomiAirPurifierPlatform,
} from "../src/platform";
import {
  FakeClient,
  FakePlatformAccessory,
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

describe("platform plugin", () => {
  it("registers platform entrypoint", async () => {
    const module = await import("../src/index");
    const register = module.default;
    const api = makeApi();
    const registerPlatform = vi.fn();
    (api as unknown as Record<string, unknown>).registerPlatform =
      registerPlatform;
    if (!register) {
      throw new Error("Missing register function");
    }
    register(api as never);

    expect(registerPlatform).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      XiaomiAirPurifierPlatform,
    );
  });

  it("discovers devices and registers new platform accessories on didFinishLaunching", () => {
    const api = makeApi();
    const logger = makeLogger();

    const platform = new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Test",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    // Verify configureAccessory works
    const fakeAccessory = new FakePlatformAccessory("OldDevice", "old-uuid");
    platform.configureAccessory(fakeAccessory as never);

    // Trigger didFinishLaunching
    api.emit("didFinishLaunching");

    // New accessory should be registered
    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      expect.any(Array),
    );

    // Old cached accessory should be unregistered
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      [fakeAccessory],
    );
  });

  it("updates existing cached accessory instead of creating new one", () => {
    const api = makeApi();
    const logger = makeLogger();

    const platform = new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Test",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    const expectedUuid = `uuid-${PLUGIN_NAME}:1.1.1.1`;
    const cached = new FakePlatformAccessory("Test", expectedUuid);
    platform.configureAccessory(cached as never);

    api.emit("didFinishLaunching");

    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cached]);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  it("handles multiple devices in config", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Living Room",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
          {
            name: "Bedroom",
            address: "1.1.1.2",
            token: "aabbccddeeff00112233445566778899",
            model: "zhimi.airpurifier.4",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2);
  });

  it("handles empty devices array gracefully", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      { platform: PLATFORM_NAME, devices: [] } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  it("handles missing devices key gracefully", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      { platform: PLATFORM_NAME } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it("logs and continues when a device config is invalid", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          { name: "", address: "1.1.1.1", token: "abc", model: "bad" },
          {
            name: "Valid",
            address: "1.1.1.2",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to configure device"),
    );
    // Second device should still be registered
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
  });

  it("removes stale cached accessories that are no longer in config", () => {
    const api = makeApi();
    const logger = makeLogger();

    const platform = new XiaomiAirPurifierPlatform(
      logger as never,
      { platform: PLATFORM_NAME, devices: [] } as never,
      api as never,
    );

    const stale1 = new FakePlatformAccessory("Stale1", "stale-uuid-1");
    const stale2 = new FakePlatformAccessory("Stale2", "stale-uuid-2");
    platform.configureAccessory(stale1 as never);
    platform.configureAccessory(stale2 as never);

    api.emit("didFinishLaunching");

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      [stale1, stale2],
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Removing %d stale cached accessory(ies).",
      2,
    );
  });

  it("validates platform config options", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Test",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
            filterChangeThreshold: Number.POSITIVE_INFINITY,
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).toHaveBeenCalled();
  });

  it("handles device config with all optional fields", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "FullConfig",
            address: "1.1.1.1",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
            enableAirQuality: false,
            enableTemperature: false,
            enableHumidity: false,
            enableChildLockControl: false,
            filterChangeThreshold: 42.4,
            connectTimeoutMs: 50.4,
            operationTimeoutMs: 80.2,
            reconnectDelayMs: 99.9,
            keepAliveIntervalMs: 500,
            operationPollIntervalMs: 2000,
            sensorPollIntervalMs: 5000,
            exposeFilterReplaceAlertSensor: true,
            maskDeviceAddressInLogs: true,
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).toHaveBeenCalled();
  });

  it("handles non-Error exception during device setup", () => {
    const api = makeApi();
    const logger = makeLogger();

    // Mock ModernMiioTransport constructor to throw a non-Error value
    vi.spyOn(ModernMiioTransport.prototype, "getProperties").mockImplementation(
      () => {
        throw "raw-string-error";
      },
    );

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "BadToken",
            address: "1.1.1.7",
            token: "xyz",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to configure device"),
    );
  });

  it("covers non-Error branch in discoverDevices catch", () => {
    const api = makeApi();
    const logger = makeLogger();

    const platform = new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [],
      } as never,
      api as never,
    );

    // Directly test the non-Error path by manually invoking discoverDevices
    // via didFinishLaunching after adding a device that causes a non-Error throw
    const setupDevice = vi
      .spyOn(platform as never, "setupDevice" as never)
      .mockImplementation(() => {
        throw "non-error-string";
      });

    // Add a dummy device
    (platform as unknown as { devices: object[] }).devices = [{ name: "x" }];
    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to configure device: non-error-string",
    );
    setupDevice.mockRestore();
  });
});

describe("config validation helpers", () => {
  it("assertString rejects empty and non-string values", () => {
    expect(() => assertString("", "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(() => assertString(undefined, "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(() => assertString(123, "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(assertString("valid", "field")).toBe("valid");
  });

  it("assertHexToken rejects invalid tokens", () => {
    expect(() => assertHexToken("xyz")).toThrow(
      "token must be a 32-character hexadecimal string",
    );
    expect(() => assertHexToken("short")).toThrow(
      "token must be a 32-character hexadecimal string",
    );
    expect(assertHexToken("00112233445566778899aabbccddeeff")).toBe(
      "00112233445566778899aabbccddeeff",
    );
  });

  it("normalizeModel rejects unsupported models", () => {
    const logger = makeLogger();
    expect(() => normalizeModel("unknown.model", logger as never)).toThrow(
      "Unsupported model",
    );
    expect(logger.error).toHaveBeenCalled();
    expect(normalizeModel("zhimi.airpurifier.3h", logger as never)).toBe(
      "zhimi.airpurifier.3h",
    );
  });

  it("normalizeThreshold handles edge cases", () => {
    expect(normalizeThreshold(Number.POSITIVE_INFINITY)).toBe(10);
    expect(normalizeThreshold("not-a-number")).toBe(10);
    expect(normalizeThreshold("9.6")).toBe(10);
    expect(normalizeThreshold(undefined)).toBe(10);
    expect(normalizeThreshold(42.4)).toBe(42);
    expect(normalizeThreshold(-5)).toBe(0);
    expect(normalizeThreshold(150)).toBe(100);
  });

  it("normalizeTimeout handles edge cases", () => {
    expect(normalizeTimeout(undefined, 5000)).toBe(5000);
    expect(normalizeTimeout("bad", 5000)).toBe(5000);
    expect(normalizeTimeout(Number.NaN, 5000)).toBe(5000);
    expect(normalizeTimeout(50, 5000)).toBe(100); // min 100
    expect(normalizeTimeout(200, 5000)).toBe(200);
    expect(normalizeTimeout(500, 5000, 1000)).toBe(1000); // custom min
  });

  it("normalizeBoolean handles edge cases", () => {
    expect(normalizeBoolean(undefined, true)).toBe(true);
    expect(normalizeBoolean("yes", false)).toBe(false);
    expect(normalizeBoolean(true, false)).toBe(true);
    expect(normalizeBoolean(false, true)).toBe(false);
  });

  it("maskAddress handles various formats", () => {
    expect(maskAddress("192.168.1.100")).toBe("192.168.*.*");
    expect(maskAddress("local-device")).toBe("[masked]");
  });
});

describe("platform accessory integration", () => {
  it("uses getOrAddService with platform accessory to reuse existing services", () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();

    const platformAccessory = new FakePlatformAccessory("Test", "test-uuid");

    const accessory = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
      {
        enableAirQuality: true,
        enableTemperature: true,
        enableHumidity: true,
        exposeFilterReplaceAlertSensor: true,
        enableChildLockControl: true,
      },
      platformAccessory as never,
    );

    // Services should have been added to the platform accessory
    expect(platformAccessory.services.length).toBeGreaterThan(0);

    // Creating another accessory with the same platformAccessory should reuse services
    const accessory2 = new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
      {
        enableAirQuality: true,
        enableTemperature: true,
        enableHumidity: true,
        exposeFilterReplaceAlertSensor: true,
        enableChildLockControl: true,
      },
      platformAccessory as never,
    );

    const serviceCount = platformAccessory.services.length;
    expect(accessory.getServices().length).toBe(
      accessory2.getServices().length,
    );
    expect(platformAccessory.services.length).toBe(serviceCount);
  });

  it("removes stale services from platform accessory when features are disabled", () => {
    const api = makeApi();
    const logger = makeLogger();
    const client = new FakeClient();

    const platformAccessory = new FakePlatformAccessory("Test", "test-uuid");

    // First create with all features enabled
    new AirPurifierAccessory(
      api as never,
      logger as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
      {
        enableAirQuality: true,
        enableTemperature: true,
        enableHumidity: true,
        exposeFilterReplaceAlertSensor: true,
        enableChildLockControl: true,
      },
      platformAccessory as never,
    );

    const initialCount = platformAccessory.services.length;

    // Now create with fewer features - stale services should be removed
    new AirPurifierAccessory(
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
      platformAccessory as never,
    );

    expect(platformAccessory.services.length).toBeLessThan(initialCount);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/Removing stale service/),
      expect.any(String),
      expect.any(String),
    );
  });
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
