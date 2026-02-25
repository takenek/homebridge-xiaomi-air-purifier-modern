import type { DeviceState } from "./types";

export const toBoolean = (value: unknown): boolean =>
  value === "on" || value === true || value === 1;

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

export const toMode = (value: unknown): DeviceState["mode"] => {
  if (value === "auto" || value === "sleep" || value === "idle" || value === "favorite") {
    return value;
  }

  if (value === 0) {
    return "auto";
  }

  if (value === 1) {
    return "sleep";
  }

  if (value === 2) {
    return "favorite";
  }

  return "idle";
};
