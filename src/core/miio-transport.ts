import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import dgram, { type Socket } from "node:dgram";
import type { DeviceState, MiioTransport, ReadProperty } from "./types";

export interface MiioTransportOptions {
  address: string;
  token: string;
  model: string;
  timeoutMs?: number;
}

interface MiioSession {
  deviceId: number;
  deviceStamp: number;
  handshakeAtEpochSec: number;
}

interface MiioResponsePayload {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

class MiioCommandError extends Error {
  public constructor(
    public readonly miioCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "MiioCommandError";
    if (miioCode !== null) {
      Reflect.set(this, "code", String(miioCode));
    }
  }
}

const MIIO_PORT = 54321;
const MIIO_MAGIC = 0x2131;

const toMd5 = (...chunks: Buffer[]): Buffer => {
  const hash = createHash("md5");
  for (const chunk of chunks) {
    hash.update(chunk);
  }

  return hash.digest();
};

const toBoolean = (value: unknown): boolean =>
  value === "on" || value === true || value === 1;
const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const toMode = (value: unknown): DeviceState["mode"] => {
  if (
    value === "auto" ||
    value === "sleep" ||
    value === "idle" ||
    value === "favorite"
  ) {
    return value;
  }

  return "idle";
};

export class ModernMiioTransport implements MiioTransport {
  private readonly timeoutMs: number;
  private readonly token: Buffer;
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private readonly socket: Socket;
  private session: MiioSession | null = null;
  private nextMessageId = 1;

  public constructor(private readonly options: MiioTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.token = Buffer.from(options.token, "hex");
    if (this.token.length !== 16) {
      throw new Error("Token must be a 32-char hex string.");
    }
    this.key = toMd5(this.token);
    this.iv = toMd5(this.key, this.token);
    this.socket = dgram.createSocket("udp4");
  }

  public async getProperties(
    props: readonly ReadProperty[],
  ): Promise<DeviceState> {
    const values = new Map<ReadProperty, unknown>();

    try {
      const response = await this.call("get_prop", props);
      if (!Array.isArray(response)) {
        throw new Error("Invalid get_prop response payload.");
      }

      for (const [index, prop] of props.entries()) {
        values.set(prop, response[index]);
      }
    } catch (error: unknown) {
      if (
        !(error instanceof MiioCommandError) ||
        error.miioCode === null ||
        error.miioCode >= 0
      ) {
        throw error;
      }

      // Some models reject batched get_prop with -5001 for unsupported fields.
      // Fall back to single-property reads and keep defaults for unavailable props.
      for (const prop of props) {
        try {
          const singleResponse = await this.call("get_prop", [prop]);
          if (Array.isArray(singleResponse)) {
            values.set(prop, singleResponse[0]);
          }
        } catch {
          values.set(prop, undefined);
        }
      }
    }

    return {
      power: toBoolean(values.get("power")),
      fan_level: toNumber(values.get("fan_level")),
      mode: toMode(values.get("mode")),
      temperature: toNumber(values.get("temperature")),
      humidity: toNumber(values.get("humidity")),
      aqi: toNumber(values.get("aqi")),
      filter1_life: toNumber(values.get("filter1_life")),
      child_lock: toBoolean(values.get("child_lock")),
      led: toBoolean(values.get("led")),
      buzzer_volume: toNumber(values.get("buzzer_volume")),
      motor1_speed: toNumber(values.get("motor1_speed")),
      use_time: toNumber(values.get("use_time")),
      purify_volume: toNumber(values.get("purify_volume")),
    };
  }

  public async setProperty(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    await this.call(method, params);
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.socket.close(() => resolve());
    });
  }

  private async call(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    if (!this.session) {
      await this.handshake();
    }

    try {
      return await this.sendCommand(method, params);
    } catch (error: unknown) {
      this.session = null;
      if (error instanceof Error && this.isTransportError(error)) {
        await this.handshake();
        return this.sendCommand(method, params);
      }

      throw error;
    }
  }

  private isTransportError(error: Error): boolean {
    const code = Reflect.get(error, "code");
    return typeof code === "string";
  }

  private async handshake(): Promise<void> {
    const packet = Buffer.alloc(32, 0xff);
    packet.writeUInt16BE(MIIO_MAGIC, 0);
    packet.writeUInt16BE(32, 2);

    const response = await this.sendAndReceive(packet, false);
    if (response.length < 32) {
      throw new Error("Invalid handshake response from device.");
    }

    const deviceId = response.readUInt32BE(8);
    const deviceStamp = response.readUInt32BE(12);
    this.session = {
      deviceId,
      deviceStamp,
      handshakeAtEpochSec: Math.floor(Date.now() / 1000),
    };
  }

  private async sendCommand(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    const session = this.session;
    if (!session) {
      throw new Error("MIIO session not initialized.");
    }

    const payload = JSON.stringify({
      id: this.nextMessageId++,
      method,
      params,
    });
    const encrypted = this.encrypt(Buffer.from(payload, "utf8"));

    const header = Buffer.alloc(32, 0);
    header.writeUInt16BE(MIIO_MAGIC, 0);
    header.writeUInt16BE(32 + encrypted.length, 2);
    header.writeUInt32BE(session.deviceId, 8);

    const elapsed = Math.max(
      0,
      Math.floor(Date.now() / 1000) - session.handshakeAtEpochSec,
    );
    const stamp = session.deviceStamp + elapsed;
    header.writeUInt32BE(stamp, 12);

    const checksum = toMd5(header.subarray(0, 16), this.token, encrypted);
    checksum.copy(header, 16);

    const response = await this.sendAndReceive(
      Buffer.concat([header, encrypted]),
      true,
    );
    if (response.length < 32) {
      throw new Error("Invalid MIIO command response.");
    }

    const encryptedPayload = response.subarray(32);
    if (encryptedPayload.length === 0) {
      return null;
    }

    const decrypted = this.decrypt(encryptedPayload);
    const parsed = JSON.parse(
      decrypted.toString("utf8"),
    ) as MiioResponsePayload;

    if (parsed.error) {
      throw new MiioCommandError(
        parsed.error.code ?? null,
        `MIIO error${parsed.error.code ? ` ${parsed.error.code}` : ""}: ${parsed.error.message ?? "Unknown"}`,
      );
    }

    return parsed.result;
  }

  private encrypt(payload: Buffer): Buffer {
    const cipher = createCipheriv("aes-128-cbc", this.key, this.iv);
    return Buffer.concat([cipher.update(payload), cipher.final()]);
  }

  private decrypt(payload: Buffer): Buffer {
    const decipher = createDecipheriv("aes-128-cbc", this.key, this.iv);
    return Buffer.concat([decipher.update(payload), decipher.final()]);
  }

  private async sendAndReceive(
    packet: Buffer,
    expectEncrypted: boolean,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off("message", onMessage);
        const error = new Error(`MIIO timeout after ${this.timeoutMs}ms`);
        Reflect.set(error, "code", "ETIMEDOUT");
        reject(error);
      }, this.timeoutMs);

      const onMessage = (message: Buffer) => {
        if (message.length < 16) {
          return;
        }

        const magic = message.readUInt16BE(0);
        if (magic !== MIIO_MAGIC) {
          return;
        }

        if (expectEncrypted && message.length <= 32) {
          return;
        }

        clearTimeout(timeout);
        this.socket.off("message", onMessage);
        resolve(message);
      };

      this.socket.on("message", onMessage);
      this.socket.send(packet, MIIO_PORT, this.options.address, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.socket.off("message", onMessage);
          reject(error);
        }
      });
    });
  }
}
