import {
  computeBackoffDelay,
  DEFAULT_RETRY_POLICY,
  effectiveMaxRetries,
  isRetryableError,
  type RetryPolicy,
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
  keepAliveIntervalMs?: number;
  retryPolicy?: RetryPolicy;
  randomFn?: () => number;
  /**
   * After this many consecutive failed polls, force a full transport reset
   * (recreate UDP socket, clear MIIO session/protocol-mode/message-id).
   * Mirrors the effect of restarting Homebridge — used to recover from
   * device-side stuck states (e.g. firmware that keeps replying with
   * `MIIO error -5001` until the source port rotates).
   *
   * Set to `0` to disable. Default `12` (≈2 minutes at the default 10 s
   * operation poll cadence, allowing for sensor/keepalive polls in between).
   */
  transportResetThreshold?: number;
  /**
   * Minimum delay between two consecutive automatic transport resets, in
   * milliseconds. Prevents reset thrashing when the device is genuinely
   * unreachable. Default 5 minutes.
   */
  transportResetCooldownMs?: number;
}

const DEFAULT_TRANSPORT_RESET_THRESHOLD = 12;
const DEFAULT_TRANSPORT_RESET_COOLDOWN_MS = 5 * 60 * 1000;

export type ConnectionStateEvent = {
  state: "connected" | "disconnected" | "reconnected";
  code?: string;
  message?: string;
};

export class DeviceClient {
  private readonly operationPollIntervalMs: number;
  private readonly sensorPollIntervalMs: number;
  private readonly keepAliveIntervalMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly randomFn: () => number;
  private readonly transportResetThreshold: number;
  private readonly transportResetCooldownMs: number;
  private operationTimer: NodeJS.Timeout | undefined;
  private sensorTimer: NodeJS.Timeout | undefined;
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryDelayResolve: (() => void) | undefined;
  private destroyed = false;
  private currentState: DeviceState | null = null;
  private listeners: Array<(state: DeviceState) => void> = [];
  private connectionListeners: Array<(event: ConnectionStateEvent) => void> =
    [];
  private operationQueue: Promise<void> = Promise.resolve();
  private hasConnected = false;
  private disconnected = false;
  private consecutiveFailures = 0;
  private lastTransportResetAtMs = 0;

  private logSuppressedQueueError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.debug(
      `Suppressed previous queued operation error to keep queue alive: ${message}`,
    );
  }

  public constructor(
    private readonly transport: MiioTransport,
    private readonly logger: Logger,
    options: DeviceClientOptions = {},
  ) {
    this.operationPollIntervalMs = options.operationPollIntervalMs ?? 10_000;
    this.sensorPollIntervalMs = options.sensorPollIntervalMs ?? 30_000;
    this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? 60_000;
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.randomFn = options.randomFn ?? Math.random;
    this.transportResetThreshold =
      options.transportResetThreshold ?? DEFAULT_TRANSPORT_RESET_THRESHOLD;
    this.transportResetCooldownMs =
      options.transportResetCooldownMs ?? DEFAULT_TRANSPORT_RESET_COOLDOWN_MS;
  }

  public get state(): DeviceState | null {
    return this.currentState;
  }

  public onStateUpdate(listener: (state: DeviceState) => void): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  public onConnectionEvent(
    listener: (event: ConnectionStateEvent) => void,
  ): () => void {
    this.connectionListeners.push(listener);

    return () => {
      this.connectionListeners = this.connectionListeners.filter(
        (entry) => entry !== listener,
      );
    };
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
    this.clearTimers();
    this.operationTimer = setInterval(() => {
      this.safePoll("operation");
    }, this.operationPollIntervalMs);
    this.operationTimer.unref();

    this.sensorTimer = setInterval(() => {
      this.safePoll("sensor");
    }, this.sensorPollIntervalMs);
    this.sensorTimer.unref();

    this.keepAliveTimer = setInterval(() => {
      this.safePoll("keepalive");
    }, this.keepAliveIntervalMs);
    this.keepAliveTimer.unref();
  }

  private safePoll(channel: "operation" | "sensor" | "keepalive"): void {
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
      .catch((error: unknown) => {
        this.logSuppressedQueueError(error);
      })
      .then(async () => pending);

    try {
      await previous.catch((error: unknown) => {
        this.logSuppressedQueueError(error);
      });
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

        this.consecutiveFailures = 0;
        if (!this.hasConnected) {
          this.hasConnected = true;
          this.disconnected = false;
          this.emitConnectionEvent({ state: "connected" });
        } else if (this.disconnected) {
          this.disconnected = false;
          this.emitConnectionEvent({ state: "reconnected" });
        }

        return;
      } catch (error: unknown) {
        attempt += 1;
        const code =
          error instanceof Error
            ? String((error as unknown as { code?: string }).code ?? "UNKNOWN")
            : "UNKNOWN";
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(
          `Device read failed (attempt ${attempt}, code ${code}): ${message}`,
        );

        if (this.hasConnected && !this.disconnected) {
          this.disconnected = true;
          this.emitConnectionEvent({ state: "disconnected", code, message });
        }

        const maxRetries = effectiveMaxRetries(
          error,
          this.retryPolicy.maxRetries,
        );
        if (!isRetryableError(error) || attempt > maxRetries) {
          this.consecutiveFailures += 1;
          await this.maybeResetTransport(code);
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

  private async maybeResetTransport(lastErrorCode: string): Promise<void> {
    if (this.transportResetThreshold <= 0) {
      return;
    }

    if (this.consecutiveFailures < this.transportResetThreshold) {
      return;
    }

    const now = Date.now();
    if (
      this.lastTransportResetAtMs > 0 &&
      now - this.lastTransportResetAtMs < this.transportResetCooldownMs
    ) {
      return;
    }

    this.lastTransportResetAtMs = now;
    this.logger.warn(
      `Persistent device errors (${this.consecutiveFailures} consecutive failures, last code ${lastErrorCode}) — recreating MIIO transport (new UDP socket, fresh handshake) to break stuck device-side state.`,
    );
    try {
      await this.transport.reset();
      this.consecutiveFailures = 0;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown reset error";
      this.logger.warn(`Transport reset failed: ${message}`);
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
      this.retryTimer.unref();
    });
  }

  private clearTimers(): void {
    if (this.operationTimer) {
      clearInterval(this.operationTimer);
    }

    if (this.sensorTimer) {
      clearInterval(this.sensorTimer);
    }

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
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

  private emitConnectionEvent(event: ConnectionStateEvent): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown connection listener error";
        this.logger.warn(`Connection listener failed: ${message}`);
      }
    }
  }
}
