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
