import { describe, expect, it } from "vitest";
import {
  formatDeviceLabel,
  maskAddress,
  normalizeBoolean,
  normalizeThreshold,
  normalizeTimeout,
  validateDeviceConfig,
} from "../src/platform";

const VALID_TOKEN = "00112233445566778899aabbccddeeff";

describe("validateDeviceConfig", () => {
  it("accepts a fully valid device config", () => {
    const result = validateDeviceConfig({
      name: "Office",
      address: "10.10.1.17",
      token: VALID_TOKEN,
      model: "zhimi.airpurifier.3h",
    });
    expect(result).toEqual({
      name: "Office",
      address: "10.10.1.17",
      token: VALID_TOKEN,
      model: "zhimi.airpurifier.3h",
    });
  });

  it("trims surrounding whitespace from string fields", () => {
    const result = validateDeviceConfig({
      name: "  Hall  ",
      address: "  10.0.0.1  ",
      token: `  ${VALID_TOKEN}  `,
      model: "  zhimi.airpurifier.3h  ",
    });
    expect(result.name).toBe("Hall");
    expect(result.address).toBe("10.0.0.1");
    expect(result.token).toBe(VALID_TOKEN);
    expect(result.model).toBe("zhimi.airpurifier.3h");
  });

  it("reports a single missing required field", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Air Purifier",
        token: VALID_TOKEN,
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("missing required config field: address");
  });

  it("reports several missing required fields together", () => {
    expect(() => validateDeviceConfig({ name: "Air Purifier" })).toThrow(
      "missing required config fields: address, token, model",
    );
  });

  it("treats a string of spaces as missing", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "   ",
        token: VALID_TOKEN,
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("missing required config field: address");
  });

  it("treats an empty string address as missing", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "",
        token: VALID_TOKEN,
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("missing required config field: address");
  });

  it("rejects a non-IPv4 address", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "not-an-ip",
        token: VALID_TOKEN,
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("invalid config field: address");
  });

  it("rejects an IPv6 address (only IPv4 is allowed)", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "::1",
        token: VALID_TOKEN,
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("invalid config field: address");
  });

  it("rejects an invalid token", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "10.0.0.1",
        token: "abc",
        model: "zhimi.airpurifier.3h",
      }),
    ).toThrow("invalid config field: token");
  });

  it("rejects an unsupported model", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Office",
        address: "10.0.0.1",
        token: VALID_TOKEN,
        model: "bad.model",
      }),
    ).toThrow("invalid config field: model");
  });

  it("aggregates missing and invalid fields in one message", () => {
    expect(() =>
      validateDeviceConfig({
        name: "Air Purifier",
        token: "abc",
        model: "bad.model",
      }),
    ).toThrow(
      "missing required config field: address; invalid config fields: token, model",
    );
  });

  it("rejects non-string types for required fields", () => {
    expect(() =>
      validateDeviceConfig({
        name: 123 as unknown as string,
        address: 456 as unknown as string,
        token: 789 as unknown as string,
        model: 0 as unknown as string,
      }),
    ).toThrow("missing required config fields: name, address, token, model");
  });

  it("never includes the token in error messages", () => {
    const secret = "deadbeefdeadbeefdeadbeefdeadbeef";
    let caught: Error | undefined;
    try {
      validateDeviceConfig({
        name: "Office",
        address: "not-an-ip",
        token: secret,
        model: "bad.model",
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).not.toContain(secret);
  });
});

describe("formatDeviceLabel", () => {
  it("includes index and quoted name when name is present", () => {
    expect(formatDeviceLabel({ name: "Air Purifier" }, 3)).toBe(
      '#4 ("Air Purifier")',
    );
  });

  it("omits parens when name is missing", () => {
    expect(formatDeviceLabel({}, 0)).toBe("#1");
  });

  it("omits parens when name is whitespace only", () => {
    expect(formatDeviceLabel({ name: "   " }, 1)).toBe("#2");
  });

  it("trims the displayed name", () => {
    expect(formatDeviceLabel({ name: "  Hania  " }, 2)).toBe('#3 ("Hania")');
  });
});

describe("normalize helpers", () => {
  it("normalizeThreshold handles edge cases", () => {
    expect(normalizeThreshold(Number.POSITIVE_INFINITY)).toBe(10);
    expect(normalizeThreshold("not-a-number")).toBe(10);
    expect(normalizeThreshold("9.6")).toBe(10);
    expect(normalizeThreshold(undefined)).toBe(10);
    expect(normalizeThreshold(42.4)).toBe(42);
    expect(normalizeThreshold(-5)).toBe(0);
    expect(normalizeThreshold(150)).toBe(100);
  });

  it("normalizeTimeout handles edge cases", () => {
    expect(normalizeTimeout(undefined, 5000)).toBe(5000);
    expect(normalizeTimeout("bad", 5000)).toBe(5000);
    expect(normalizeTimeout(Number.NaN, 5000)).toBe(5000);
    expect(normalizeTimeout(50, 5000)).toBe(100); // min 100
    expect(normalizeTimeout(200, 5000)).toBe(200);
    expect(normalizeTimeout(500, 5000, 1000)).toBe(1000); // custom min
  });

  it("normalizeBoolean handles edge cases", () => {
    expect(normalizeBoolean(undefined, true)).toBe(true);
    expect(normalizeBoolean("yes", false)).toBe(false);
    expect(normalizeBoolean(true, false)).toBe(true);
    expect(normalizeBoolean(false, true)).toBe(false);
  });

  it("maskAddress handles various formats", () => {
    expect(maskAddress("192.168.1.100")).toBe("192.168.*.*");
    expect(maskAddress("local-device")).toBe("[masked]");
  });
});
