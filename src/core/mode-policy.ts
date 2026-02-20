import type { DeviceMode } from "./types";

export const resolveModeOnSwitchToggle = (
  enabled: boolean,
  targetMode: Extract<DeviceMode, "auto" | "sleep">,
  currentMode: DeviceMode,
): DeviceMode | null => {
  if (enabled) {
    return targetMode;
  }

  if (currentMode === targetMode) {
    return "idle";
  }

  return null;
};

export const modeToAutoNightSwitchState = (mode: DeviceMode): boolean =>
  mode === "auto";

export const resolveAutoNightModeUpdate = (
  enabled: boolean,
  powerOn: boolean,
): Extract<DeviceMode, "auto" | "sleep"> | null => {
  if (!powerOn) {
    return null;
  }

  return enabled ? "auto" : "sleep";
};
