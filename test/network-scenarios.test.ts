import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirPurifierAccessory } from "../src/accessories/air-purifier";
import { DeviceClient } from "../src/core/device-client";
import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState, MiioTransport } from "../src/core/types";
import {
  FakeClient,
  type FakeService,
  makeApi,
  makeLogger,
  makeState,
} from "./helpers/fake-homekit";

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
  public resetCalls = 0;
  public async reset(): Promise<void> {
    this.resetCalls += 1;
  }
}

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
    const api = makeApi();
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
    const api = makeApi();
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
