import { describe, expect, it } from "vitest";
import { resolveModeOnSwitchToggle } from "../src/core/mode-policy";

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
});
