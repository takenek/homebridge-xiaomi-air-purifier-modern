export const FAN_LEVEL_MIN = 1;
export const FAN_LEVEL_MAX = 16;

export const fanLevelToRotationSpeed = (fanLevel: number): number => {
  const clamped = Math.max(FAN_LEVEL_MIN, Math.min(FAN_LEVEL_MAX, fanLevel));
  const ratio = (FAN_LEVEL_MAX - clamped) / (FAN_LEVEL_MAX - FAN_LEVEL_MIN);
  return Math.round(ratio * 100);
};

export const rotationSpeedToFanLevel = (speed: number): number => {
  const clamped = Math.max(0, Math.min(100, speed));
  const ratio = clamped / 100;
  return Math.round(FAN_LEVEL_MAX - ratio * (FAN_LEVEL_MAX - FAN_LEVEL_MIN));
};

export type HomeKitAirQuality = 1 | 2 | 3 | 4 | 5;

export const aqiToHomeKitAirQuality = (aqi: number): HomeKitAirQuality => {
  if (aqi <= 35) {
    return 1;
  }

  if (aqi <= 70) {
    return 2;
  }

  if (aqi <= 100) {
    return 3;
  }

  return 4;
};
