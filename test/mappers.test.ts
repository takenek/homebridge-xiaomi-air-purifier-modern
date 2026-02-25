import { describe, expect, it } from "vitest";
import {
  aqiToHomeKitAirQuality,
  fanLevelToRotationSpeed,
  rotationSpeedToFanLevel,
} from "../src/core/mappers";

describe("fan level mapping", () => {
  it("maps fan_level 1..16 to 0..100 (1=slowest, 16=fastest)", () => {
    expect(fanLevelToRotationSpeed(1)).toBe(0);
    expect(fanLevelToRotationSpeed(16)).toBe(100);
    expect(fanLevelToRotationSpeed(14)).toBe(87);
  });

  it("maps rotation speed back to fan level (round-trip consistent)", () => {
    expect(rotationSpeedToFanLevel(0)).toBe(1);
    expect(rotationSpeedToFanLevel(100)).toBe(16);
    expect(rotationSpeedToFanLevel(87)).toBe(14);
  });

  it("clamps out-of-range inputs", () => {
    expect(fanLevelToRotationSpeed(0)).toBe(0);
    expect(fanLevelToRotationSpeed(17)).toBe(100);
    expect(rotationSpeedToFanLevel(-1)).toBe(1);
    expect(rotationSpeedToFanLevel(101)).toBe(16);
  });
});

describe("aqi mapping", () => {
  it("maps thresholds including Hazardous level 5", () => {
    expect(aqiToHomeKitAirQuality(0)).toBe(1);
    expect(aqiToHomeKitAirQuality(35)).toBe(1); // boundary: Excellent
    expect(aqiToHomeKitAirQuality(36)).toBe(2); // Good
    expect(aqiToHomeKitAirQuality(75)).toBe(2); // boundary: Good
    expect(aqiToHomeKitAirQuality(76)).toBe(3); // Fair
    expect(aqiToHomeKitAirQuality(115)).toBe(3); // boundary: Fair
    expect(aqiToHomeKitAirQuality(116)).toBe(4); // Poor
    expect(aqiToHomeKitAirQuality(150)).toBe(4); // boundary: Poor
    expect(aqiToHomeKitAirQuality(151)).toBe(5); // Hazardous
    expect(aqiToHomeKitAirQuality(300)).toBe(5); // Hazardous (extreme)
  });
});
