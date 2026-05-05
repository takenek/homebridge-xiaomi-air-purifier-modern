export type AirPurifierModel =
  | "zhimi.airpurifier.2h"
  | "zhimi.airpurifier.3"
  | "zhimi.airpurifier.3h"
  | "zhimi.airpurifier.4"
  | "zhimi.airpurifier.pro";

export type DeviceMode = "auto" | "sleep" | "idle" | "favorite";

export interface DeviceState {
  power: boolean;
  fan_level: number;
  mode: DeviceMode;
  temperature: number;
  humidity: number;
  aqi: number;
  filter1_life: number;
  child_lock: boolean;
  led: boolean;

  motor1_speed: number;
  use_time: number;
  purify_volume: number;
}

export const READ_PROPERTIES = [
  "power",
  "fan_level",
  "mode",
  "temperature",
  "humidity",
  "aqi",
  "filter1_life",
  "child_lock",
  "led",

  "motor1_speed",
  "use_time",
  "purify_volume",
] as const;

export type ReadProperty = (typeof READ_PROPERTIES)[number];

export interface MiioTransport {
  getProperties(props: readonly ReadProperty[]): Promise<DeviceState>;
  setProperty(method: string, params: readonly unknown[]): Promise<void>;
  close(): Promise<void>;
}
