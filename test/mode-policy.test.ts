import { describe, expect, it } from "vitest";
import {
  modeToAutoNightSwitchState,
  resolveAutoNightModeUpdate,
  resolveModeOnSwitchToggle,
} from "../src/core/mode-policy";

describe("mode switch policy", () => {
  it("enabling switch sets explicit mode", () => {
    expect(resolveModeOnSwitchToggle(true, "auto", "sleep")).toBe("auto");
    expect(resolveModeOnSwitchToggle(true, "sleep", "idle")).toBe("sleep");
  });

  it("disabling active mode goes to idle", () => {
    expect(resolveModeOnSwitchToggle(false, "auto", "auto")).toBe("idle");
  });

  it("disabling inactive mode keeps state", () => {
    expect(resolveModeOnSwitchToggle(false, "sleep", "auto")).toBeNull();
  });

  it("maps mode to unified auto/night switch state", () => {
    expect(modeToAutoNightSwitchState("auto")).toBe(true);
    expect(modeToAutoNightSwitchState("sleep")).toBe(false);
    expect(modeToAutoNightSwitchState("idle")).toBe(false);
  });

  it("blocks mode change when power is off", () => {
    expect(resolveAutoNightModeUpdate(true, false)).toBeNull();
    expect(resolveAutoNightModeUpdate(false, true)).toBe("sleep");
    expect(resolveAutoNightModeUpdate(true, true)).toBe("auto");
  });
});
