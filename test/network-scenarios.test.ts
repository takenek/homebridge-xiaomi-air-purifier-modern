import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceClient } from "../src/core/device-client";
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
  buzzer_volume: 50,
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
