import { describe, expect, it } from "vitest";
import {
  aqiToHomeKitAirQuality,
  fanLevelToRotationSpeed,
  rotationSpeedToFanLevel,
} from "../src/core/mappers";

describe("fan level mapping", () => {
  it("maps fan_level 1..16 to 0..100", () => {
    expect(fanLevelToRotationSpeed(1)).toBe(0);
    expect(fanLevelToRotationSpeed(16)).toBe(100);
    expect(fanLevelToRotationSpeed(8)).toBeGreaterThan(40);
  });

  it("maps rotation speed back to fan level", () => {
    expect(rotationSpeedToFanLevel(0)).toBe(1);
    expect(rotationSpeedToFanLevel(100)).toBe(16);
    expect(rotationSpeedToFanLevel(50)).toBeGreaterThanOrEqual(8);
  });
});

describe("aqi mapping", () => {
  it("maps thresholds", () => {
    expect(aqiToHomeKitAirQuality(10)).toBe(1);
    expect(aqiToHomeKitAirQuality(40)).toBe(2);
    expect(aqiToHomeKitAirQuality(80)).toBe(3);
    expect(aqiToHomeKitAirQuality(150)).toBe(4);
  });
});
