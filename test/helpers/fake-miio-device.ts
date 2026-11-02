import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { ModernMiioTransport } from "../../src/core/miio-transport";

export const DEVICE_TOKEN = "00112233445566778899aabbccddeeff";
const DEVICE_ID = 0x0a1b2c3d;

const md5 = (...chunks: Buffer[]): Buffer => {
  const hash = createHash("md5");
  for (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest();
};

export interface MiioRequest {
  id: number;
  method: string;
  params: unknown[];
}

export type MiioReply =
  | { result: unknown }
  | { error: { code: number; message: string } };

// Wire-level stand-in for a miIO purifier, plugged in as the transport's UDP
// socket: it answers the handshake, drops command frames whose device id or
// checksum is wrong (as real firmware does), decrypts the rest and replies
// with a correctly signed, encrypted payload from `handle`. `wire` logs every
// handshake and command in the order received.
export abstract class FakeMiioDevice extends EventEmitter {
  public readonly requests: MiioRequest[] = [];
  public readonly wire: string[] = [];
  private readonly token = Buffer.from(DEVICE_TOKEN, "hex");
  private readonly key = md5(this.token);
  private readonly iv = md5(this.key, this.token);

  public send(
    packet: Buffer,
    _port: number,
    _address: string,
    callback: (error: Error | null) => void,
  ): void {
    callback(null);
    let reply: Buffer;
    if (packet.length === 32) {
      this.wire.push("hello");
      reply = this.header(32);
    } else if (this.isAuthentic(packet)) {
      reply = this.reply(packet);
    } else {
      this.wire.push("dropped");
      return;
    }
    setImmediate(() => {
      this.emit("message", reply, {
        address: "127.0.0.1",
        port: 54321,
        family: "IPv4",
        size: reply.length,
      });
    });
  }

  public close(callback?: () => void): void {
    callback?.();
  }

  public methods(): string[] {
    return this.requests.map((request) => request.method);
  }

  protected abstract handle(request: MiioRequest): MiioReply;

  private header(length: number): Buffer {
    const header = Buffer.alloc(32, 0);
    header.writeUInt16BE(0x2131, 0);
    header.writeUInt16BE(length, 2);
    header.writeUInt32BE(DEVICE_ID, 8);
    header.writeUInt32BE(1000, 12);
    return header;
  }

  private isAuthentic(packet: Buffer): boolean {
    const checksum = md5(
      packet.subarray(0, 16),
      this.token,
      packet.subarray(32),
    );
    return (
      packet.readUInt32BE(8) === DEVICE_ID &&
      checksum.equals(packet.subarray(16, 32))
    );
  }

  private reply(packet: Buffer): Buffer {
    const decipher = createDecipheriv("aes-128-cbc", this.key, this.iv);
    const request = JSON.parse(
      Buffer.concat([
        decipher.update(packet.subarray(32)),
        decipher.final(),
      ]).toString("utf8"),
    ) as MiioRequest;
    this.requests.push(request);
    this.wire.push(`${request.method} ${JSON.stringify(request.params)}`);

    const cipher = createCipheriv("aes-128-cbc", this.key, this.iv);
    const payload = Buffer.concat([
      cipher.update(
        JSON.stringify({ id: request.id, ...this.handle(request) }),
      ),
      cipher.final(),
    ]);
    const header = this.header(32 + payload.length);
    md5(header.subarray(0, 16), this.token, payload).copy(header, 16);
    return Buffer.concat([header, payload]);
  }
}

export const connectFakeDevice = (
  device: FakeMiioDevice,
  model: string,
): ModernMiioTransport => {
  vi.spyOn(dgram, "createSocket").mockReturnValue(
    device as unknown as dgram.Socket,
  );
  return new ModernMiioTransport({
    address: "127.0.0.1",
    token: DEVICE_TOKEN,
    model,
    connectTimeoutMs: 500,
    operationTimeoutMs: 500,
  });
};
