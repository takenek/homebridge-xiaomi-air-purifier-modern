import type { DeviceMode } from "./types";

export const isAutoModeSwitchOn = (mode: DeviceMode): boolean => mode === "auto";

export const isNightModeSwitchOn = (mode: DeviceMode): boolean => mode === "sleep";

export const resolveModeFromAutoSwitch = (
  enabled: boolean,
  powerOn: boolean,
): Extract<DeviceMode, "auto" | "sleep"> | null => {
  if (!powerOn) {
    return null;
  }

  return enabled ? "auto" : "sleep";
};

export const resolveModeFromNightSwitch = (
  enabled: boolean,
  powerOn: boolean,
): Extract<DeviceMode, "auto" | "sleep"> | null => {
  if (!powerOn) {
    return null;
  }

  return enabled ? "sleep" : "auto";
};
