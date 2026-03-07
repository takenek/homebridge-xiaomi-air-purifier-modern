import { describe, expect, it } from "vitest";
import { ModernMiioTransport } from "../src/core/miio-transport";

describe("MIIO crypto round-trip", () => {
  it("encrypts and decrypts a payload back to the original using a known token", () => {
    const token = "00112233445566778899aabbccddeeff";
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token,
      model: "zhimi.airpurifier.4",
    });

    const internals = transport as unknown as {
      encrypt: (payload: Buffer) => Buffer;
      decrypt: (payload: Buffer) => Buffer;
    };

    const original = JSON.stringify({
      id: 1,
      method: "get_prop",
      params: ["power", "mode", "fan_level"],
    });
    const plaintext = Buffer.from(original, "utf8");

    const encrypted = internals.encrypt(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = internals.decrypt(encrypted);
    expect(decrypted.toString("utf8")).toBe(original);
  });

  it("produces different ciphertext for different tokens", () => {
    const transport1 = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.4",
    });
    const transport2 = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "ffeeddccbbaa99887766554433221100",
      model: "zhimi.airpurifier.4",
    });

    const internals1 = transport1 as unknown as {
      encrypt: (payload: Buffer) => Buffer;
    };
    const internals2 = transport2 as unknown as {
      encrypt: (payload: Buffer) => Buffer;
    };

    const plaintext = Buffer.from('{"id":1,"method":"get_prop"}', "utf8");
    const cipher1 = internals1.encrypt(plaintext);
    const cipher2 = internals2.encrypt(plaintext);

    expect(cipher1).not.toEqual(cipher2);
  });

  it("round-trips various payload sizes including empty and large", () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "aabbccddeeff00112233445566778899",
      model: "zhimi.airpurifier.3h",
    });

    const internals = transport as unknown as {
      encrypt: (payload: Buffer) => Buffer;
      decrypt: (payload: Buffer) => Buffer;
    };

    // Single byte
    const single = Buffer.from([0x42]);
    expect(internals.decrypt(internals.encrypt(single))).toEqual(single);

    // Exactly one AES block (16 bytes)
    const oneBlock = Buffer.alloc(16, 0xab);
    expect(internals.decrypt(internals.encrypt(oneBlock))).toEqual(oneBlock);

    // Large payload (simulating big batch response)
    const large = Buffer.from(
      JSON.stringify({
        id: 999,
        result: Array.from({ length: 20 }, (_, i) => ({
          did: "0",
          siid: i,
          piid: 1,
          code: 0,
          value: i * 100,
        })),
      }),
      "utf8",
    );
    expect(internals.decrypt(internals.encrypt(large)).toString("utf8")).toBe(
      large.toString("utf8"),
    );
  });
});
