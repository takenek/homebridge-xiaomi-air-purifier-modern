export const FAN_LEVEL_MIN = 1;
export const FAN_LEVEL_MAX = 16;

// fan_level 1 = minimum speed, 16 = maximum speed.
// Maps to HomeKit RotationSpeed: 1 → 0%, 16 → 100%.
export const fanLevelToRotationSpeed = (fanLevel: number): number => {
  const clamped = Math.max(FAN_LEVEL_MIN, Math.min(FAN_LEVEL_MAX, fanLevel));
  const ratio = (clamped - FAN_LEVEL_MIN) / (FAN_LEVEL_MAX - FAN_LEVEL_MIN);
  return Math.round(ratio * 100);
};

// Maps HomeKit RotationSpeed 0–100% back to fan_level 1–16.
export const rotationSpeedToFanLevel = (speed: number): number => {
  const clamped = Math.max(0, Math.min(100, speed));
  const ratio = clamped / 100;
  return Math.round(FAN_LEVEL_MIN + ratio * (FAN_LEVEL_MAX - FAN_LEVEL_MIN));
};

export type HomeKitAirQuality = 1 | 2 | 3 | 4 | 5;

// AQI thresholds based on Chinese GB3095-2012 PM2.5 μg/m³ scale used by Xiaomi devices.
export const aqiToHomeKitAirQuality = (aqi: number): HomeKitAirQuality => {
  if (aqi <= 35) {
    return 1; // Excellent
  }

  if (aqi <= 75) {
    return 2; // Good
  }

  if (aqi <= 115) {
    return 3; // Fair
  }

  if (aqi <= 150) {
    return 4; // Poor
  }

  return 5; // Hazardous
};
