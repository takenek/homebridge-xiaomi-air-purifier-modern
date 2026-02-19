import type { Socket } from "node:dgram";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceClient } from "../src/core/device-client";
import { ModernMiioTransport } from "../src/core/miio-transport";
import {
  DEFAULT_RETRY_POLICY,
  computeBackoffDelay,
  isRetryableError,
} from "../src/core/retry";
import type { DeviceState, MiioTransport } from "../src/core/types";

const state: DeviceState = {
  power: true,
  fan_level: 6,
  mode: "idle",
  temperature: 20,
  humidity: 35,
  aqi: 20,
  filter1_life: 65,
  child_lock: false,
  led: true,
  buzzer_volume: 40,
  motor1_speed: 700,
  use_time: 1234,
  purify_volume: 5678,
};

class FlakyTransport implements MiioTransport {
  public failCodes: string[] = [];
  public getCalls = 0;

  public async getProperties(): Promise<DeviceState> {
    this.getCalls += 1;
    if (this.failCodes.length > 0) {
      const code = this.failCodes.shift();
      const error = new Error(code);
      Reflect.set(error, "code", code);
      throw error;
    }
    return state;
  }

  public async setProperty(): Promise<void> {}
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

describe("retry and polling", () => {
  it("retries with backoff and recovers to polling", async () => {
    const transport = new FlakyTransport();
    transport.failCodes = ["ETIMEDOUT", "ECONNRESET"];
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10_000,
      sensorPollIntervalMs: 30_000,
      randomFn: () => 0.5,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(2_000);
    await initPromise;

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Recovered"),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.getCalls).toBeGreaterThanOrEqual(4);

    await client.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports simulated network scenarios", async () => {
    const scenarios = [1, 2, 3, 4, 5, 6, 7];
    for (const _ of scenarios) {
      const transport = new FlakyTransport();
      transport.failCodes = [
        "ETIMEDOUT",
        "ESOCKETTIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "ECONNABORTED",
        "EPIPE",
        "ENOTCONN",
        "EINTR",
        "EALREADY",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ENETDOWN",
        "ENETRESET",
        "EAI_AGAIN",
        "ENOTFOUND",
        "EADDRINUSE",
        "EADDRNOTAVAIL",
        "ERR_NETWORK_CHANGED",
      ];
      const logger = makeLogger();
      const client = new DeviceClient(transport, logger, {
        operationPollIntervalMs: 600_000,
        sensorPollIntervalMs: 600_000,
        randomFn: () => 0.5,
        retryPolicy: {
          ...DEFAULT_RETRY_POLICY,
          baseDelayMs: 1,
          maxDelayMs: 4,
          jitterFactor: 0,
          maxRetries: 20,
        },
      });

      const initPromise = client.init();
      await vi.advanceTimersByTimeAsync(200);
      await initPromise;
      expect(logger.warn).toHaveBeenCalled();
      await client.shutdown();
    }
  }, 20000);

  it("computes exponential delay with max cap", () => {
    const d1 = computeBackoffDelay(
      1,
      { ...DEFAULT_RETRY_POLICY, jitterFactor: 0 },
      () => 0.5,
    );
    const d2 = computeBackoffDelay(
      2,
      { ...DEFAULT_RETRY_POLICY, jitterFactor: 0 },
      () => 0.5,
    );
    const d9 = computeBackoffDelay(
      9,
      { ...DEFAULT_RETRY_POLICY, jitterFactor: 0, maxDelayMs: 1000 },
      () => 0.5,
    );
    expect(d2).toBeGreaterThan(d1);
    expect(d9).toBe(1000);
  });

  it("treats transient socket restart errors as retryable", () => {
    const notConnected = new Error("socket not connected");
    Reflect.set(notConnected, "code", "ENOTCONN");

    const interrupted = new Error("syscall interrupted");
    Reflect.set(interrupted, "code", "EINTR");

    const inProgress = new Error("operation already in progress");
    Reflect.set(inProgress, "code", "EALREADY");

    expect(isRetryableError(notConnected)).toBe(true);
    expect(isRetryableError(interrupted)).toBe(true);
    expect(isRetryableError(inProgress)).toBe(true);
  });

  it("dgram socket has an error listener to prevent process crash", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "ffffffffffffffffffffffffffffffff",
      model: "zhimi.airpurifier.3h",
    });

    const socket = Reflect.get(transport, "socket") as Socket;
    expect(socket.listenerCount("error")).toBeGreaterThanOrEqual(1);

    // Emitting 'error' must not throw (no unhandled EventEmitter error)
    expect(() => {
      socket.emit("error", new Error("ENETUNREACH"));
    }).not.toThrow();

    await transport.close();
  });
});
