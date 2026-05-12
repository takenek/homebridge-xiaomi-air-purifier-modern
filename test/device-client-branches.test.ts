import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceClient } from "../src/core/device-client";
import {
  DEVICE_UNAVAILABLE_MAX_RETRIES,
  effectiveMaxRetries,
  isRetryableError,
} from "../src/core/retry";
import type { DeviceState, MiioTransport } from "../src/core/types";

const state: DeviceState = {
  power: true,
  fan_level: 9,
  mode: "auto",
  temperature: 22,
  humidity: 41,
  aqi: 15,
  filter1_life: 90,
  child_lock: false,
  led: true,
  motor1_speed: 1234,
  use_time: 12,
  purify_volume: 34,
};

class BranchTransport implements MiioTransport {
  public throwsUnknown = false;
  public throwsErrorOnPoll = false;
  public throwsNonRetryable = false;
  public retryableFailuresRemaining = 0;
  public deviceUnavailableFailuresRemaining = 0;
  public throwErrorWithoutCode = false;
  public callCount = 0;
  public setCalls: Array<{ method: string; params: readonly unknown[] }> = [];

  public async getProperties(): Promise<DeviceState> {
    this.callCount += 1;

    if (this.throwsUnknown) {
      throw "raw-string-error";
    }

    if (this.throwErrorWithoutCode) {
      throw new Error("error-without-code");
    }

    if (this.throwsErrorOnPoll) {
      const error = new Error("poll-error");
      Reflect.set(error, "code", "ECONNRESET");
      throw error;
    }

    if (this.deviceUnavailableFailuresRemaining > 0) {
      this.deviceUnavailableFailuresRemaining -= 1;
      const error = new Error("core properties unavailable");
      Reflect.set(error, "code", "EDEVICEUNAVAILABLE");
      throw error;
    }

    if (this.retryableFailuresRemaining > 0) {
      this.retryableFailuresRemaining -= 1;
      const error = new Error("retryable");
      Reflect.set(error, "code", "ETIMEDOUT");
      throw error;
    }

    if (this.throwsNonRetryable) {
      const error = new Error("boom");
      Reflect.set(error, "code", "SOMETHING_ELSE");
      throw error;
    }

    return state;
  }

  public async setProperty(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    this.setCalls.push({ method, params });
  }

  public async close(): Promise<void> {}
  public resetCalls = 0;
  public failResetWith: unknown = null;
  public async reset(): Promise<void> {
    this.resetCalls += 1;
    if (this.failResetWith !== null) {
      throw this.failResetWith;
    }
  }
}

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("device client uncovered branches", () => {
  it("covers default options branch in constructor", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger);

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    expect(client.state).toEqual(state);
    await client.shutdown();
  });

  it("executes listener registration and listener callback path", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    const listener = vi.fn();
    const connectionListener = vi.fn();
    client.onStateUpdate(listener);
    client.onConnectionEvent(connectionListener);

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    expect(listener).toHaveBeenCalledWith(state);
    expect(connectionListener).toHaveBeenCalledWith({ state: "connected" });

    await client.shutdown();
  });

  it("supports unsubscribing state and connection listeners", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
    });

    const stateListener = vi.fn();
    const connectionListener = vi.fn();
    const offState = client.onStateUpdate(stateListener);
    const offConnection = client.onConnectionEvent(connectionListener);

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    offState();
    offConnection();

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(connectionListener).toHaveBeenCalledTimes(1);

    await client.shutdown();
  });

  it("keeps polling when a state listener throws", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
    });

    client.onStateUpdate(() => {
      throw new Error("listener-broke");
    });
    client.onStateUpdate(() => {
      throw "raw-listener-error";
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("State listener failed: listener-broke"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("State listener failed: Unknown listener error"),
    );
    expect(transport.callCount).toBeGreaterThanOrEqual(2);

    await client.shutdown();
  });

  it("covers all set* branches and parameter variants", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    await client.setPower(true);
    await client.setPower(false);
    await client.setFanLevel(7);
    await client.setMode("sleep");
    await client.setChildLock(true);
    await client.setChildLock(false);
    await client.setLed(true);
    await client.setLed(false);

    expect(transport.setCalls).toEqual([
      { method: "set_power", params: ["on"] },
      { method: "set_power", params: ["off"] },
      { method: "set_level_fan", params: [7] },
      { method: "set_mode", params: ["sleep"] },
      { method: "set_child_lock", params: ["on"] },
      { method: "set_child_lock", params: ["off"] },
      { method: "set_led", params: ["on"] },
      { method: "set_led", params: ["off"] },
    ]);

    await client.shutdown();
  });

  it("logs unknown poll errors via safePoll catch branch", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsUnknown = true;

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown poll error"),
    );

    await client.shutdown();
  });

  it("logs Error message in safePoll catch branch", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 0,
        jitterFactor: 0,
      },
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsErrorOnPoll = true;

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[operation] poll failed: poll-error"),
    );

    await client.shutdown();
  });

  it("emits reconnect and protects connection listeners", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 3,
        jitterFactor: 0,
      },
    });

    const events: string[] = [];
    client.onConnectionEvent((event) => {
      events.push(event.state);
    });
    client.onConnectionEvent(() => {
      throw new Error("connection-listener-broke");
    });
    client.onConnectionEvent(() => {
      throw "connection-listener-raw";
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.retryableFailuresRemaining = 1;

    const setPromise = client.setPower(true);
    await vi.advanceTimersByTimeAsync(10);
    await expect(setPromise).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "Connection listener failed: connection-listener-broke",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Connection listener failed: Unknown connection listener error",
    );
    expect(events).toEqual(["connected", "disconnected", "reconnected"]);
    await client.shutdown();
  });

  it("throws immediately for non-retryable errors", async () => {
    const transport = new BranchTransport();
    transport.throwsNonRetryable = true;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 10,
        maxRetries: 3,
        jitterFactor: 0,
      },
    });

    await expect(client.init()).rejects.toBeInstanceOf(Error);
    await client.shutdown();
  });

  it("uses UNKNOWN code fallback for Error without code", async () => {
    const transport = new BranchTransport();
    transport.throwErrorWithoutCode = true;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    await expect(client.init()).rejects.toBeInstanceOf(Error);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("code UNKNOWN"),
    );

    await client.shutdown();
  });

  it("throws after retryable error exceeds maxRetries", async () => {
    const transport = new BranchTransport();
    transport.retryableFailuresRemaining = 3;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 1,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
    });

    const initPromise = client.init();
    const rejectedInit = expect(initPromise).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(10);
    await rejectedInit;

    await client.shutdown();
  });

  it("logs recovery after retry path succeeds", async () => {
    const transport = new BranchTransport();
    transport.retryableFailuresRemaining = 1;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 3,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(10);
    await initPromise;

    expect(logger.info).toHaveBeenCalledWith(
      "Recovered device connection after 1 retries.",
    );
    await client.shutdown();
  });

  it("logs suppressed queue errors when prior queued operation failed", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    const clientInternals = client as unknown as {
      operationQueue: Promise<void>;
    };
    clientInternals.operationQueue = Promise.reject(new Error("queue-broke"));

    await client.setPower(true);

    clientInternals.operationQueue = Promise.reject("queue-raw");
    await client.setLed(false);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        "Suppressed previous queued operation error to keep queue alive: queue-broke",
      ),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        "Suppressed previous queued operation error to keep queue alive: queue-raw",
      ),
    );

    await client.shutdown();
  });

  it("resolves delay immediately after shutdown without scheduling timer", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    await client.shutdown();
    await (client as unknown as { delay(ms: number): Promise<void> }).delay(
      5_000,
    );

    expect(vi.getTimerCount()).toBe(0);
  });
  it("allows init to settle when shutdown happens during retry backoff", async () => {
    const transport = new BranchTransport();
    transport.retryableFailuresRemaining = 1;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 5_000,
        maxDelayMs: 5_000,
        maxRetries: 3,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
    });

    let settled = false;
    const initPromise = client.init().finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1);
    await client.shutdown();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(settled).toBe(true);
    await initPromise;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues queued operations after previous command rejection", async () => {
    const transport = new BranchTransport();
    const originalSetProperty = transport.setProperty.bind(transport);
    let failFirst = true;
    transport.setProperty = async (method, params) => {
      if (failFirst) {
        failFirst = false;
        throw new Error("write-failed");
      }
      await originalSetProperty(method, params);
    };

    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;

    await expect(client.setPower(true)).rejects.toBeInstanceOf(Error);
    await expect(client.setLed(true)).resolves.toBeUndefined();

    expect(transport.setCalls).toEqual([{ method: "set_led", params: ["on"] }]);

    await client.shutdown();
  });

  it("covers queue recovery callback on pre-rejected queue", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    (client as unknown as { operationQueue: Promise<void> }).operationQueue =
      Promise.reject(new Error("pre-rejected"));

    await expect(client.setLed(true)).resolves.toBeUndefined();
    await client.shutdown();
  });

  it("stops retrying EDEVICEUNAVAILABLE after reduced retry cap", async () => {
    const transport = new BranchTransport();
    transport.deviceUnavailableFailuresRemaining = 10;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 8,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
    });

    const initPromise = client.init();
    const rejectedInit = expect(initPromise).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(100);
    await rejectedInit;

    // Should have been capped at DEVICE_UNAVAILABLE_MAX_RETRIES (2) + 1 initial attempt = 3 calls
    expect(transport.callCount).toBe(DEVICE_UNAVAILABLE_MAX_RETRIES + 1);

    await client.shutdown();
  });

  it("recovers after EDEVICEUNAVAILABLE retries when device becomes available", async () => {
    const transport = new BranchTransport();
    transport.deviceUnavailableFailuresRemaining = 1;
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
      retryPolicy: {
        baseDelayMs: 1,
        maxDelayMs: 1,
        maxRetries: 8,
        jitterFactor: 0,
      },
      randomFn: () => 0.5,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(10);
    await initPromise;

    expect(client.state).toEqual(state);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Recovered"),
    );

    await client.shutdown();
  });
});

describe("retry helper uncovered branches", () => {
  it("returns false for non-Error values", () => {
    expect(isRetryableError("oops")).toBe(false);
  });

  it("returns false for Error without string code", () => {
    const error = new Error("oops");
    Reflect.set(error, "code", 123);
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns reduced max for EDEVICEUNAVAILABLE", () => {
    const error = new Error("unavailable");
    Reflect.set(error, "code", "EDEVICEUNAVAILABLE");
    expect(effectiveMaxRetries(error, 8)).toBe(DEVICE_UNAVAILABLE_MAX_RETRIES);
  });

  it("returns policy max for network errors", () => {
    const error = new Error("timeout");
    Reflect.set(error, "code", "ETIMEDOUT");
    expect(effectiveMaxRetries(error, 8)).toBe(8);
  });

  it("returns policy max for non-Error values", () => {
    expect(effectiveMaxRetries("oops", 8)).toBe(8);
  });

  it("returns min of DEVICE_UNAVAILABLE_MAX_RETRIES and policy max", () => {
    const error = new Error("unavailable");
    Reflect.set(error, "code", "EDEVICEUNAVAILABLE");
    expect(effectiveMaxRetries(error, 1)).toBe(1);
  });

  it("classifies MIIO command codes (-5001, -10000) as retryable", () => {
    const e1 = new Error("command error");
    Reflect.set(e1, "code", "-5001");
    const e2 = new Error("Method execution error");
    Reflect.set(e2, "code", "-10000");
    expect(isRetryableError(e1)).toBe(true);
    expect(isRetryableError(e2)).toBe(true);
  });

  it("caps retries for MIIO command codes", () => {
    const error = new Error("command error");
    Reflect.set(error, "code", "-5001");
    expect(effectiveMaxRetries(error, 8)).toBe(2);
  });
});

describe("auto transport reset on persistent failures", () => {
  const drainPolls = async (intervalMs: number, count: number) => {
    // Run each interval slice individually so that the queued async callbacks
    // (safePoll → enqueueOperation → pollWithRetry) actually settle before
    // the next interval fires. A single bulk advance can collapse multiple
    // intervals into a single microtask flush and skip iterations.
    for (let i = 0; i < count; i++) {
      await vi.advanceTimersByTimeAsync(intervalMs);
    }
  };

  it("calls transport.reset() after threshold consecutive failures", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 3,
      transportResetCooldownMs: 60_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsNonRetryable = true;

    await drainPolls(10, 4);

    expect(transport.resetCalls).toBeGreaterThanOrEqual(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Persistent device errors"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("recreating MIIO transport"),
    );
    await client.shutdown();
  });

  it("respects cooldown between consecutive resets", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 1,
      transportResetCooldownMs: 60_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsNonRetryable = true;

    await drainPolls(10, 10);

    expect(transport.resetCalls).toBe(1);
    await client.shutdown();
  });

  it("disables auto reset when threshold is 0", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 0,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsNonRetryable = true;

    await drainPolls(10, 5);

    expect(transport.resetCalls).toBe(0);
    await client.shutdown();
  });

  it("logs a warning if transport.reset() itself fails", async () => {
    const transport = new BranchTransport();
    transport.failResetWith = new Error("socket already closed");
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 1,
      transportResetCooldownMs: 60_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsNonRetryable = true;
    await drainPolls(10, 2);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Transport reset failed: socket already closed"),
    );
    await client.shutdown();
  });

  it("logs a generic message if transport.reset() rejects with a non-Error", async () => {
    const transport = new BranchTransport();
    transport.failResetWith = "raw-string-reject";
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 1,
      transportResetCooldownMs: 60_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;
    transport.throwsNonRetryable = true;
    await drainPolls(10, 2);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Transport reset failed: Unknown reset error"),
    );
    await client.shutdown();
  });

  it("clears consecutiveFailures counter after a successful poll", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 10,
      sensorPollIntervalMs: 600_000,
      keepAliveIntervalMs: 600_000,
      transportResetThreshold: 5,
      transportResetCooldownMs: 60_000,
    });

    const initPromise = client.init();
    await vi.advanceTimersByTimeAsync(5);
    await initPromise;

    // Two failures (counter = 2)
    transport.throwsNonRetryable = true;
    await drainPolls(10, 2);
    // Recover (counter resets to 0)
    transport.throwsNonRetryable = false;
    await drainPolls(10, 1);
    // Four more failures (counter = 4) — still below threshold (5)
    transport.throwsNonRetryable = true;
    await drainPolls(10, 4);

    expect(transport.resetCalls).toBe(0);
    await client.shutdown();
  });
});
