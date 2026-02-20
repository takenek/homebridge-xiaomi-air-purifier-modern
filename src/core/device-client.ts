import {
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  computeBackoffDelay,
  isRetryableError,
} from "./retry";
import {
  type DeviceMode,
  type DeviceState,
  type MiioTransport,
  READ_PROPERTIES,
} from "./types";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DeviceClientOptions {
  operationPollIntervalMs?: number;
  sensorPollIntervalMs?: number;
  retryPolicy?: RetryPolicy;
  randomFn?: () => number;
}

export class DeviceClient {
  private readonly operationPollIntervalMs: number;
  private readonly sensorPollIntervalMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly randomFn: () => number;
  private operationTimer: NodeJS.Timeout | undefined;
  private sensorTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryDelayResolve: (() => void) | undefined;
  private destroyed = false;
  private currentState: DeviceState | null = null;
  private listeners: Array<(state: DeviceState) => void> = [];
  private operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly transport: MiioTransport,
    private readonly logger: Logger,
    options: DeviceClientOptions = {},
  ) {
    this.operationPollIntervalMs = options.operationPollIntervalMs ?? 10_000;
    this.sensorPollIntervalMs = options.sensorPollIntervalMs ?? 30_000;
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.randomFn = options.randomFn ?? Math.random;
  }

  public get state(): DeviceState | null {
    return this.currentState;
  }

  public onStateUpdate(listener: (state: DeviceState) => void): void {
    this.listeners.push(listener);
  }

  public async init(): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.pollWithRetry();
    });
    if (this.destroyed) {
      return;
    }

    this.startPolling();
  }

  public async shutdown(): Promise<void> {
    this.destroyed = true;
    this.clearTimers();
    await this.transport.close();
  }

  public async setPower(value: boolean): Promise<void> {
    await this.enqueueSetAndSync("set_power", [value ? "on" : "off"]);
  }

  public async setFanLevel(fanLevel: number): Promise<void> {
    await this.enqueueSetAndSync("set_level_fan", [fanLevel]);
  }

  public async setMode(mode: DeviceMode): Promise<void> {
    await this.enqueueSetAndSync("set_mode", [mode]);
  }

  public async setChildLock(enabled: boolean): Promise<void> {
    await this.enqueueSetAndSync("set_child_lock", [enabled ? "on" : "off"]);
  }

  public async setLed(enabled: boolean): Promise<void> {
    await this.enqueueSetAndSync("set_led", [enabled ? "on" : "off"]);
  }

  public async setBuzzerVolume(volume: number): Promise<void> {
    await this.enqueueSetAndSync("set_buzzer_volume", [volume]);
  }

  private async enqueueSetAndSync(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.transport.setProperty(method, params);
      await this.pollWithRetry();
    });
  }

  private startPolling(): void {
    this.operationTimer = setInterval(() => {
      this.safePoll("operation");
    }, this.operationPollIntervalMs);

    this.sensorTimer = setInterval(() => {
      this.safePoll("sensor");
    }, this.sensorPollIntervalMs);
  }

  private safePoll(channel: "operation" | "sensor"): void {
    void this.enqueueOperation(async () => {
      await this.pollWithRetry();
    }).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown poll error";
      this.logger.warn(`[${channel}] poll failed: ${message}`);
    });
  }

  private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.operationQueue;
    this.operationQueue = previous
      .catch(() => undefined)
      .then(async () => pending);

    try {
      await previous.catch(() => undefined);
      return await operation();
    } finally {
      release?.();
    }
  }

  private async pollWithRetry(): Promise<void> {
    let attempt = 0;
    while (!this.destroyed) {
      try {
        const state = await this.transport.getProperties(READ_PROPERTIES);
        this.currentState = state;
        for (const listener of this.listeners) {
          try {
            listener(state);
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : "Unknown listener error";
            this.logger.warn(`State listener failed: ${message}`);
          }
        }
        if (attempt > 0) {
          this.logger.info(
            `Recovered device connection after ${attempt} retries.`,
          );
        }
        return;
      } catch (error: unknown) {
        attempt += 1;
        const code =
          error instanceof Error
            ? String(Reflect.get(error, "code") ?? "UNKNOWN")
            : "UNKNOWN";
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(
          `Device read failed (attempt ${attempt}, code ${code}): ${message}`,
        );

        if (!isRetryableError(error) || attempt > this.retryPolicy.maxRetries) {
          throw error;
        }

        const delay = computeBackoffDelay(
          attempt,
          this.retryPolicy,
          this.randomFn,
        );
        await this.delay(delay);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed) {
        resolve();
        return;
      }

      this.retryDelayResolve = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.retryDelayResolve = undefined;
        resolve();
      }, ms);
    });
  }

  private clearTimers(): void {
    if (this.operationTimer) {
      clearInterval(this.operationTimer);
    }

    if (this.sensorTimer) {
      clearInterval(this.sensorTimer);
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }

    if (this.retryDelayResolve) {
      const resolve = this.retryDelayResolve;
      this.retryDelayResolve = undefined;
      resolve();
    }
  }
}
