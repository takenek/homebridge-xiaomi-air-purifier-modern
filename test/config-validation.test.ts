import { describe, expect, it } from "vitest";
import {
  assertHexToken,
  assertString,
  maskAddress,
  normalizeBoolean,
  normalizeModel,
  normalizeThreshold,
  normalizeTimeout,
} from "../src/platform";
import { makeLogger } from "./helpers/fake-homekit";

describe("config validation helpers", () => {
  it("assertString rejects empty and non-string values", () => {
    expect(() => assertString("", "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(() => assertString(undefined, "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(() => assertString(123, "field")).toThrow(
      "Invalid or missing config field: field",
    );
    expect(assertString("valid", "field")).toBe("valid");
  });

  it("assertHexToken rejects invalid tokens", () => {
    expect(() => assertHexToken("xyz")).toThrow(
      "token must be a 32-character hexadecimal string",
    );
    expect(() => assertHexToken("short")).toThrow(
      "token must be a 32-character hexadecimal string",
    );
    expect(assertHexToken("00112233445566778899aabbccddeeff")).toBe(
      "00112233445566778899aabbccddeeff",
    );
  });

  it("normalizeModel rejects unsupported models", () => {
    const logger = makeLogger();
    expect(() => normalizeModel("unknown.model", logger as never)).toThrow(
      "Unsupported model",
    );
    expect(logger.error).toHaveBeenCalled();
    expect(normalizeModel("zhimi.airpurifier.3h", logger as never)).toBe(
      "zhimi.airpurifier.3h",
    );
  });

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
