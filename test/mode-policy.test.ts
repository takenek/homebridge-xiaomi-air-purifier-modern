import { describe, expect, it } from "vitest";
import {
  isAutoModeSwitchOn,
  isNightModeSwitchOn,
  resolveModeFromAutoSwitch,
  resolveModeFromNightSwitch,
} from "../src/core/mode-policy";

describe("mode switch policy", () => {
  it("maps mode to AUTO switch state", () => {
    expect(isAutoModeSwitchOn("auto")).toBe(true);
    expect(isAutoModeSwitchOn("sleep")).toBe(false);
    expect(isAutoModeSwitchOn("idle")).toBe(false);
  });

  it("maps mode to NIGHT switch state", () => {
    expect(isNightModeSwitchOn("sleep")).toBe(true);
    expect(isNightModeSwitchOn("auto")).toBe(false);
    expect(isNightModeSwitchOn("idle")).toBe(false);
  });

  it("resolves AUTO switch toggles to auto/sleep", () => {
    expect(resolveModeFromAutoSwitch(true, true)).toBe("auto");
    expect(resolveModeFromAutoSwitch(false, true)).toBe("sleep");
    expect(resolveModeFromAutoSwitch(true, false)).toBeNull();
  });

  it("resolves NIGHT switch toggles to sleep/auto", () => {
    expect(resolveModeFromNightSwitch(true, true)).toBe("sleep");
    expect(resolveModeFromNightSwitch(false, true)).toBe("auto");
    expect(resolveModeFromNightSwitch(false, false)).toBeNull();
  });
});
