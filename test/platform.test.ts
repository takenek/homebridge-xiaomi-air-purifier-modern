import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { ModernMiioTransport } from "../src/core/miio-transport";
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  XiaomiAirPurifierPlatform,
} from "../src/platform";
import {
  FakeClient,
  FakePlatformAccessory,
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
      'Failed to configure device #1 ("x"): non-error-string',
    );
    setupDevice.mockRestore();
  });

  it("registers three valid devices alongside one empty default entry", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Oczyszczacz komputerowy",
            address: "10.10.1.17",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
          {
            name: "Oczyszczacz Hania",
            address: "10.10.1.16",
            token: "aabbccddeeff00112233445566778899",
            model: "zhimi.airpurifier.3h",
          },
          {
            name: "Oczyszczacz jadalnia",
            address: "10.10.1.24",
            token: "112233445566778899aabbccddeeff00",
            model: "zhimi.airpurifier.3h",
          },
          { name: "Air Purifier" },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to configure device #4 ("Air Purifier"): missing required config fields: address, token, model',
    );
  });

  it("logs index when name is missing on the broken entry", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [{}],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to configure device #1: missing required config fields: name, address, token, model",
    );
  });

  it("flags empty string address with the missing-field message", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Air Purifier",
            address: "",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to configure device #1 ("Air Purifier"): missing required config field: address',
    );
  });

  it("flags whitespace-only address with the missing-field message", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Air Purifier",
            address: "   ",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to configure device #1 ("Air Purifier"): missing required config field: address',
    );
  });

  it("flags an invalid IPv4 address", () => {
    const api = makeApi();
    const logger = makeLogger();

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Air Purifier",
            address: "999.999.999.999",
            token: "00112233445566778899aabbccddeeff",
            model: "zhimi.airpurifier.3h",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to configure device #1 ("Air Purifier"): invalid config field: address',
    );
  });

  it("never logs the token, even when the token is the broken field", () => {
    const api = makeApi();
    const logger = makeLogger();
    const secretToken = "deadbeefcafebabe1234567890abcdef";

    new XiaomiAirPurifierPlatform(
      logger as never,
      {
        platform: PLATFORM_NAME,
        devices: [
          {
            name: "Air Purifier",
            address: "10.10.1.17",
            token: secretToken,
            model: "not-a-real-model",
          },
        ],
      } as never,
      api as never,
    );

    api.emit("didFinishLaunching");

    expect(logger.error).toHaveBeenCalled();
    for (const call of logger.error.mock.calls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain(secretToken);
        }
      }
    }
    for (const call of logger.warn.mock.calls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain(secretToken);
        }
      }
    }
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
