import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { DeviceClient } from "../src/core/device-client";
import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState, MiioTransport } from "../src/core/types";

const makeState = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  power: true,
  fan_level: 8,
  mode: "auto",
  temperature: 23,
  humidity: 40,
  aqi: 30,
  filter1_life: 85,
  child_lock: false,
  led: true,
  motor1_speed: 1000,
  use_time: 100,
  purify_volume: 200,
  ...overrides,
});

class ScriptedTransport implements MiioTransport {
  public reads: Array<DeviceState | string> = [];
  public writeCalls: Array<{ method: string; params: readonly unknown[] }> = [];

  public async getProperties(): Promise<DeviceState> {
    const next = this.reads.shift() ?? makeState();
    if (typeof next === "string") {
      const error = new Error(next);
      Reflect.set(error, "code", next);
      throw error;
    }
    return next;
  }

  public async setProperty(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    this.writeCalls.push({ method, params });
  }

  public async close(): Promise<void> {}
}

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("network/status scenarios", () => {
  it("[S1] Given purifier restart, When it comes back, Then plugin refreshes without HB restart", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [
      "ECONNRESET",
      makeState({ power: false, mode: "sleep" }),
    ];
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 3,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
      operationPollIntervalMs: 50,
      sensorPollIntervalMs: 5000,
    });
    const updates: DeviceState[] = [];
    client.onStateUpdate((state) => updates.push(state));

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;

    expect(updates.at(-1)?.power).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Recovered"),
    );
    await client.shutdown();
  });

  it("[S2] Given router restart, When network returns, Then reconnect and sync state", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [
      makeState(),
      "ENETDOWN",
      "ENETUNREACH",
      makeState({ mode: "sleep" }),
    ];
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 4,
        jitterFactor: 0,
      },
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });

    await client.init();
    const changePromise = client.setPower(true);
    await vi.advanceTimersByTimeAsync(20);
    await changePromise;
    expect(client.state?.mode).toBe("sleep");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ENETDOWN"),
    );
    await client.shutdown();
  });

  it("[S3] Given packet loss, When random timeouts happen, Then retry/backoff without flapping", async () => {
    const transport = new ScriptedTransport();
    transport.reads = ["ETIMEDOUT", "ESOCKETTIMEDOUT", makeState({ aqi: 11 })];
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      retryPolicy: {
        baseDelayMs: 2,
        maxDelayMs: 2,
        maxRetries: 3,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
      operationPollIntervalMs: 500,
      sensorPollIntervalMs: 500,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(10);
    await initPromise;

    expect(client.state?.aqi).toBe(11);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await client.shutdown();
  });

  it("[S4] Given homebridge restart, When plugin boots, Then publishes stable state", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [makeState({ power: false, mode: "idle" })];
    const client = new DeviceClient(transport, makeLogger(), {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });

    await client.init();
    expect(client.state).toMatchObject({ power: false, mode: "idle" });
    await client.shutdown();
  });

  it("[S5] Given plugin hot-reload, When shutdown/init cycle repeats, Then no timer leaks", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [makeState(), makeState()];
    const client = new DeviceClient(transport, makeLogger(), {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 10,
    });

    await client.init();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await client.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[S6] Given short Wi-Fi outage, When connectivity returns quickly, Then state is restored", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [
      makeState(),
      "EAI_AGAIN",
      makeState({ child_lock: true }),
    ];
    const client = new DeviceClient(transport, makeLogger(), {
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 2,
        jitterFactor: 0,
      },
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });

    await client.init();
    const changePromise = client.setChildLock(true);
    await vi.advanceTimersByTimeAsync(20);
    await changePromise;
    expect(client.state?.child_lock).toBe(true);
    await client.shutdown();
  });

  it("[S7] Given long Wi-Fi outage, When retries are exhausted and later recovered, Then process remains stable", async () => {
    const transport = new ScriptedTransport();
    transport.reads = [
      makeState(),
      "ENETDOWN",
      "ENETDOWN",
      "ENETDOWN",
      makeState({ led: false }),
    ];
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 1,
        jitterFactor: 0,
      },
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 5000,
    });

    await client.init();
    await vi.advanceTimersByTimeAsync(120);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("poll failed"),
    );
    await client.setLed(false);
    expect(transport.writeCalls.at(-1)).toEqual({
      method: "set_led",
      params: ["off"],
    });
    await client.shutdown();
  });
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

const makeFilterApi = () => {
  const events = new Map<string, Array<() => void>>();
  return {
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
        ConfiguredName: { UUID: "configuredName" },
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
  } as unknown as {
    hap: unknown;
    on: (event: string, cb: () => void) => void;
    emit: (event: string) => void;
  };
};

class FakeClient {
  public state: DeviceState | null = { ...makeState() };
  public readonly listeners: Array<(state: DeviceState) => void> = [];
  public readonly connectionListeners: Array<
    (event: { state: "connected" | "disconnected" | "reconnected" }) => void
  > = [];
  public readonly calls: string[] = [];
  public onStateUpdate(listener: (state: DeviceState) => void): void {
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
  public async setMode(value: string): Promise<void> {
    this.calls.push(`mode:${value}`);
  }
}

describe("filter status scenarios", () => {
  beforeEach(() => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    vi.spyOn(ModernMiioTransport.prototype, "getProperties").mockResolvedValue(
      makeState(),
    );
    vi.spyOn(ModernMiioTransport.prototype, "setProperty").mockResolvedValue();
    vi.spyOn(ModernMiioTransport.prototype, "close").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[S8] Given filter life drops to 4%, When state refresh runs, Then FilterChangeIndication is set to 1 (CHANGE_FILTER)", () => {
    const api = makeFilterApi();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      makeLogger() as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    // Simulate filter life dropping to 4%
    client.state = { ...makeState(), filter1_life: 4 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const filterService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Filter:Filter Life",
      ) as unknown as FakeService;

    const indicationUpdates = filterService.updates.filter(
      (update) => update.characteristic === "filterIndication",
    );
    expect(indicationUpdates.some((update) => update.value === 1)).toBe(true);
  });

  it("[S9] Given filter replacement (4% -> 100%), When state refresh runs, Then FilterChangeIndication resets to 0 (FILTER_OK)", () => {
    const api = makeFilterApi();
    const client = new FakeClient();

    const accessory = new AirPurifierAccessory(
      api as never,
      makeLogger() as never,
      "Office",
      "10.0.0.1",
      client as never,
      "zhimi.airpurifier.3h",
      10,
    );

    // First: filter at 4% -> CHANGE_FILTER (1)
    client.state = { ...makeState(), filter1_life: 4 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    // Then: filter replaced -> 100% -> FILTER_OK (0)
    client.state = { ...makeState(), filter1_life: 100 };
    for (const listener of client.listeners) {
      listener(client.state);
    }

    const filterService = accessory
      .getServices()
      .find(
        (service) =>
          (service as unknown as FakeService).name === "Filter:Filter Life",
      ) as unknown as FakeService;

    const indicationUpdates = filterService.updates.filter(
      (update) => update.characteristic === "filterIndication",
    );
    // Should have both: first 1 (CHANGE_FILTER), then 0 (FILTER_OK)
    expect(indicationUpdates.some((update) => update.value === 1)).toBe(true);
    expect(indicationUpdates.some((update) => update.value === 0)).toBe(true);
  });
});
