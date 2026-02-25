import { describe, expect, it } from "vitest";
import { toBoolean, toMode, toNumber } from "../src/core/miio-converters";

describe("toBoolean", () => {
  it('returns true for "on", true, and 1', () => {
    expect(toBoolean("on")).toBe(true);
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(1)).toBe(true);
  });

  it("returns false for other values", () => {
    expect(toBoolean("off")).toBe(false);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(undefined)).toBe(false);
    expect(toBoolean("")).toBe(false);
  });
});

describe("toNumber", () => {
  it("returns numbers as-is", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-5)).toBe(-5);
    expect(toNumber(3.14)).toBe(3.14);
  });

  it("parses numeric strings", () => {
    expect(toNumber("100")).toBe(100);
    expect(toNumber("3.14")).toBe(3.14);
    expect(toNumber("0")).toBe(0);
  });

  it("returns 0 for non-finite strings", () => {
    expect(toNumber("not-a-number")).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("Infinity")).toBe(0);
  });

  it("returns 0 for non-number non-string values", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(true)).toBe(0);
    expect(toNumber(false)).toBe(0);
    expect(toNumber({})).toBe(0);
  });
});

describe("toMode", () => {
  it("passes through valid string modes", () => {
    expect(toMode("auto")).toBe("auto");
    expect(toMode("sleep")).toBe("sleep");
    expect(toMode("idle")).toBe("idle");
    expect(toMode("favorite")).toBe("favorite");
  });

  it("maps numeric MIOT mode values", () => {
    expect(toMode(0)).toBe("auto");
    expect(toMode(1)).toBe("sleep");
    expect(toMode(2)).toBe("favorite");
  });

  it('returns "idle" for unknown values', () => {
    expect(toMode(3)).toBe("idle");
    expect(toMode(-1)).toBe("idle");
    expect(toMode("unknown")).toBe("idle");
    expect(toMode(null)).toBe("idle");
    expect(toMode(undefined)).toBe("idle");
    expect(toMode(true)).toBe("idle");
  });
});
