import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import dgram, { type Socket } from "node:dgram";
import { isRetryableError } from "./retry";
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

interface MiotProperty {
  did: string;
  siid: number;
  piid: number;
}

interface MiotValueResult {
  did?: string;
  siid?: number;
  piid?: number;
  code?: number;
  value?: unknown;
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

  if (value === 0) {
    return "auto";
  }

  if (value === 1) {
    return "sleep";
  }

  if (value === 2) {
    return "favorite";
  }

  return "idle";
};

const MIOT_DID = "0";
const MIOT_POWER_PROBE: MiotProperty = { did: MIOT_DID, siid: 2, piid: 2 };

const MIOT_MAP: Record<string, readonly MiotProperty[]> = {
  power: [MIOT_POWER_PROBE],
  fan_level: [
    { did: MIOT_DID, siid: 10, piid: 10 },
    { did: MIOT_DID, siid: 2, piid: 4 },
  ],
  mode: [{ did: MIOT_DID, siid: 2, piid: 5 }],
  temperature: [{ did: MIOT_DID, siid: 3, piid: 8 }],
  humidity: [{ did: MIOT_DID, siid: 3, piid: 7 }],
  aqi: [{ did: MIOT_DID, siid: 3, piid: 6 }],
  filter1_life: [{ did: MIOT_DID, siid: 4, piid: 3 }],
  child_lock: [{ did: MIOT_DID, siid: 7, piid: 1 }],
  led: [{ did: MIOT_DID, siid: 6, piid: 1 }],
  buzzer_volume: [{ did: MIOT_DID, siid: 5, piid: 1 }],
  motor1_speed: [{ did: MIOT_DID, siid: 10, piid: 8 }],
  use_time: [{ did: MIOT_DID, siid: 4, piid: 2 }],
  purify_volume: [{ did: MIOT_DID, siid: 4, piid: 1 }],
};

const LEGACY_MAP: Record<string, readonly string[]> = {
  power: ["power"],
  fan_level: ["fan_level", "favorite_level"],
  mode: ["mode"],
  temperature: ["temperature", "temp_dec"],
  humidity: ["humidity", "rh"],
  aqi: ["aqi", "pm25"],
  filter1_life: ["filter1_life", "filter_life"],
  child_lock: ["child_lock"],
  led: ["led", "led_b"],
  buzzer_volume: ["buzzer_volume"],
  motor1_speed: ["motor1_speed"],
  use_time: ["use_time"],
  purify_volume: ["purify_volume"],
};

export class ModernMiioTransport implements MiioTransport {
  private readonly timeoutMs: number;
  private readonly token: Buffer;
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private readonly socket: Socket;
  private session: MiioSession | null = null;
  private nextMessageId = 1;
  private protocolMode: "unknown" | "miot" | "legacy" = "unknown";

  public constructor(private readonly options: MiioTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.token = Buffer.from(options.token, "hex");
    if (this.token.length !== 16) {
      throw new Error("Token must be a 32-char hex string.");
    }
    this.key = toMd5(this.token);
    this.iv = toMd5(this.key, this.token);
    this.socket = dgram.createSocket("udp4");
    this.socket.on("error", () => {
      // Absorb socket-level errors (e.g. bind failure, OS errors).
      // These surface through sendAndReceive timeouts and are handled
      // by DeviceClient retry logic with proper logging.
    });
  }

  public async getProperties(
    _props: readonly ReadProperty[],
  ): Promise<DeviceState> {
    if (this.protocolMode === "unknown") {
      this.protocolMode = (await this.detectProtocolMode()) ?? "legacy";
    }

    const state =
      this.protocolMode === "miot"
        ? await this.readViaMiot().catch(async () => {
            this.protocolMode = "legacy";
            return this.readViaLegacy();
          })
        : await this.readViaLegacy();

    if (
      state.power === false &&
      state.fan_level === 0 &&
      state.mode === "idle"
    ) {
      // If all core fields are empty and we used legacy, retry MIOT once.
      if (this.protocolMode === "legacy") {
        const miotState = await this.readViaMiot().catch((error: unknown) => {
          if (isRetryableError(error)) {
            throw error;
          }

          return null;
        });
        if (miotState) {
          this.protocolMode = "miot";
          return miotState;
        }
      }
    }

    return state;
  }

  public async setProperty(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    if (this.protocolMode === "unknown") {
      this.protocolMode = (await this.detectProtocolMode()) ?? "legacy";
    }

    if (this.protocolMode === "miot") {
      const ok = await this.trySetViaMiot(method, params);
      if (ok) {
        return;
      }
      this.protocolMode = "legacy";
    }

    await this.call(method, params);
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.socket.close(() => resolve());
    });
  }

  private async detectProtocolMode(): Promise<"miot" | "legacy" | null> {
    const probe = MIOT_POWER_PROBE;
    try {
      const result = await this.call("get_properties", [probe]);
      if (Array.isArray(result) && result.length > 0) {
        return "miot";
      }
    } catch {
      // ignore and fallback
    }

    try {
      const result = await this.call("get_prop", ["power"]);
      if (Array.isArray(result)) {
        return "legacy";
      }
    } catch {
      return null;
    }

    return null;
  }

  private async readViaMiot(): Promise<DeviceState> {
    const valueByKey = new Map<string, unknown>();

    for (const [key, candidates] of Object.entries(MIOT_MAP)) {
      const value = await this.readMiotOne(candidates);
      valueByKey.set(key, value);
    }

    const powerRaw = valueByKey.get("power");
    const fanLevelRaw = valueByKey.get("fan_level");
    const modeRaw = valueByKey.get("mode");
    if (
      powerRaw === undefined &&
      fanLevelRaw === undefined &&
      modeRaw === undefined
    ) {
      throw new Error("MIOT core properties unavailable");
    }

    return {
      power: toBoolean(powerRaw),
      fan_level: toNumber(fanLevelRaw),
      mode: toMode(modeRaw),
      temperature: toNumber(valueByKey.get("temperature")),
      humidity: toNumber(valueByKey.get("humidity")),
      aqi: toNumber(valueByKey.get("aqi")),
      filter1_life: toNumber(valueByKey.get("filter1_life")),
      child_lock: toBoolean(valueByKey.get("child_lock")),
      led: toNumber(valueByKey.get("led")) !== 2,
      buzzer_volume: toNumber(valueByKey.get("buzzer_volume")),
      motor1_speed: toNumber(valueByKey.get("motor1_speed")),
      use_time: toNumber(valueByKey.get("use_time")),
      purify_volume: toNumber(valueByKey.get("purify_volume")),
    };
  }

  private async readViaLegacy(): Promise<DeviceState> {
    const powerRaw = await this.readLegacyOne(LEGACY_MAP.power ?? []);
    const fanLevelRaw = await this.readLegacyOne(LEGACY_MAP.fan_level ?? []);
    const modeRaw = await this.readLegacyOne(LEGACY_MAP.mode ?? []);

    if (
      powerRaw === undefined &&
      fanLevelRaw === undefined &&
      modeRaw === undefined
    ) {
      throw new Error(
        "Unable to read core properties (power/fan_level/mode). Check token, LAN access, or model compatibility.",
      );
    }

    return {
      power: toBoolean(powerRaw),
      fan_level: toNumber(fanLevelRaw),
      mode: toMode(modeRaw),
      temperature: toNumber(
        await this.readLegacyOne(LEGACY_MAP.temperature ?? []),
      ),
      humidity: toNumber(await this.readLegacyOne(LEGACY_MAP.humidity ?? [])),
      aqi: toNumber(await this.readLegacyOne(LEGACY_MAP.aqi ?? [])),
      filter1_life: toNumber(
        await this.readLegacyOne(LEGACY_MAP.filter1_life ?? []),
      ),
      child_lock: toBoolean(
        await this.readLegacyOne(LEGACY_MAP.child_lock ?? []),
      ),
      led: toBoolean(await this.readLegacyOne(LEGACY_MAP.led ?? [])),
      buzzer_volume: toNumber(
        await this.readLegacyOne(LEGACY_MAP.buzzer_volume ?? []),
      ),
      motor1_speed: toNumber(
        await this.readLegacyOne(LEGACY_MAP.motor1_speed ?? []),
      ),
      use_time: toNumber(await this.readLegacyOne(LEGACY_MAP.use_time ?? [])),
      purify_volume: toNumber(
        await this.readLegacyOne(LEGACY_MAP.purify_volume ?? []),
      ),
    };
  }

  private async readMiotOne(
    candidates: readonly MiotProperty[],
  ): Promise<unknown> {
    for (const candidate of candidates) {
      try {
        const result = await this.call("get_properties", [candidate]);
        if (!Array.isArray(result) || result.length === 0) {
          continue;
        }

        const payload = result[0] as MiotValueResult;
        if ((payload.code ?? 0) === 0) {
          return payload.value;
        }
      } catch {
        // try next candidate
      }
    }

    return undefined;
  }

  private async readLegacyOne(candidates: readonly string[]): Promise<unknown> {
    for (const candidate of candidates) {
      try {
        const response = await this.call("get_prop", [candidate]);
        if (Array.isArray(response)) {
          return response[0];
        }
      } catch {
        // try next candidate
      }
    }

    return undefined;
  }

  private async trySetViaMiot(
    method: string,
    params: readonly unknown[],
  ): Promise<boolean> {
    const did = MIOT_DID;

    const send = async (
      items: readonly MiotValueResult[],
    ): Promise<boolean> => {
      const result = await this.call("set_properties", items);
      if (!Array.isArray(result)) {
        return false;
      }

      return result.every((item) => {
        const typed = item as MiotValueResult;
        return (typed.code ?? -1) === 0;
      });
    };

    if (method === "set_power") {
      return send([{ did, siid: 2, piid: 2, value: params[0] === "on" }]);
    }

    if (method === "set_mode") {
      const mode = params[0];
      const value =
        mode === "auto"
          ? 0
          : mode === "sleep"
            ? 1
            : mode === "favorite"
              ? 2
              : 3;
      return send([{ did, siid: 2, piid: 5, value }]);
    }

    if (method === "set_child_lock") {
      return send([{ did, siid: 7, piid: 1, value: params[0] === "on" }]);
    }

    if (method === "set_led") {
      return send([
        { did, siid: 6, piid: 1, value: params[0] === "on" ? 0 : 2 },
      ]);
    }

    if (method === "set_buzzer_volume") {
      return send([{ did, siid: 5, piid: 1, value: toNumber(params[0]) > 0 }]);
    }

    if (method === "set_level_fan") {
      const level = Math.max(1, Math.min(16, toNumber(params[0])));
      return send([
        { did, siid: 2, piid: 5, value: 2 },
        { did, siid: 10, piid: 10, value: level },
      ]);
    }

    return false;
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
      if (this.isTransportError(error)) {
        await this.handshake();
        return this.sendCommand(method, params);
      }

      throw error;
    }
  }

  private isTransportError(error: unknown): boolean {
    if (!(error instanceof Error) || error instanceof MiioCommandError) {
      return false;
    }

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

    const requestId = this.nextMessageId++;
    const payload = JSON.stringify({
      id: requestId,
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
      requestId,
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
    expectedResponseId?: number,
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

        if (expectEncrypted && typeof expectedResponseId === "number") {
          const encryptedPayload = message.subarray(32);
          try {
            const decrypted = this.decrypt(encryptedPayload);
            const parsed = JSON.parse(
              decrypted.toString("utf8"),
            ) as MiioResponsePayload;
            if (parsed.id !== expectedResponseId) {
              return;
            }
          } catch {
            return;
          }
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
