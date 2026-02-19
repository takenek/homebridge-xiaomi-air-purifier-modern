import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceClient } from "../src/core/device-client";
import { isRetryableError } from "../src/core/retry";
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
  buzzer_volume: 60,
  motor1_speed: 1234,
  use_time: 12,
  purify_volume: 34,
};

class BranchTransport implements MiioTransport {
  public throwsUnknown = false;
  public throwsErrorOnPoll = false;
  public throwsNonRetryable = false;
  public retryableFailuresRemaining = 0;
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

    await client.init();
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
    client.onStateUpdate(listener);

    await client.init();
    expect(listener).toHaveBeenCalledWith(state);

    await client.shutdown();
  });

  it("covers all set* branches and parameter variants", async () => {
    const transport = new BranchTransport();
    const logger = makeLogger();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 600_000,
      sensorPollIntervalMs: 600_000,
    });

    await client.init();
    await client.setPower(true);
    await client.setPower(false);
    await client.setFanLevel(7);
    await client.setMode("sleep");
    await client.setChildLock(true);
    await client.setChildLock(false);
    await client.setLed(true);
    await client.setLed(false);
    await client.setBuzzerVolume(42);

    expect(transport.setCalls).toEqual([
      { method: "set_power", params: ["on"] },
      { method: "set_power", params: ["off"] },
      { method: "set_level_fan", params: [7] },
      { method: "set_mode", params: ["sleep"] },
      { method: "set_child_lock", params: ["on"] },
      { method: "set_child_lock", params: ["off"] },
      { method: "set_led", params: ["on"] },
      { method: "set_led", params: ["off"] },
      { method: "set_buzzer_volume", params: [42] },
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

    await client.init();
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

    await client.init();
    transport.throwsErrorOnPoll = true;

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[operation] poll failed: poll-error"),
    );

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
});
