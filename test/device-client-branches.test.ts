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
  public throwsNonRetryable = false;
  public callCount = 0;

  public async getProperties(): Promise<DeviceState> {
    this.callCount += 1;

    if (this.throwsUnknown) {
      throw "raw-string-error";
    }

    if (this.throwsNonRetryable) {
      const error = new Error("boom");
      Reflect.set(error, "code", "SOMETHING_ELSE");
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("device client uncovered branches", () => {
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
