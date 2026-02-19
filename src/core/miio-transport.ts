import type { DeviceState, MiioTransport, ReadProperty } from "./types";

export interface MiioTransportOptions {
  address: string;
  token: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Lightweight transport abstraction.
 *
 * This implementation intentionally keeps I/O isolated behind an interface so it can be
 * replaced by a protocol adapter without changing Homebridge logic.
 */
export class ModernMiioTransport implements MiioTransport {
  public constructor(private readonly options: MiioTransportOptions) {}

  public async getProperties(
    _props: readonly ReadProperty[],
  ): Promise<DeviceState> {
    throw new Error(
      `No live protocol adapter configured for ${this.options.model} at ${this.options.address}. Use tests/mocks or provide adapter implementation.`,
    );
  }

  public async setProperty(
    _method: string,
    _params: readonly unknown[],
  ): Promise<void> {
    throw new Error(
      `No live protocol adapter configured for ${this.options.model} at ${this.options.address}.`,
    );
  }

  public async close(): Promise<void> {
    return Promise.resolve();
  }
}
