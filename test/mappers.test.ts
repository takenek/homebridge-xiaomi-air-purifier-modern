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
    expect(fanLevelToRotationSpeed(14)).toBe(87);
  });

  it("maps rotation speed back to fan level", () => {
    expect(rotationSpeedToFanLevel(0)).toBe(1);
    expect(rotationSpeedToFanLevel(100)).toBe(16);
    expect(rotationSpeedToFanLevel(87)).toBe(14);
  });

  it("clamps out-of-range fan levels", () => {
    expect(fanLevelToRotationSpeed(0)).toBe(0);
    expect(fanLevelToRotationSpeed(-5)).toBe(0);
    expect(fanLevelToRotationSpeed(20)).toBe(100);
    expect(fanLevelToRotationSpeed(999)).toBe(100);
  });

  it("clamps out-of-range rotation speeds", () => {
    expect(rotationSpeedToFanLevel(-10)).toBe(1);
    expect(rotationSpeedToFanLevel(150)).toBe(16);
  });

  it("handles non-integer rotation speeds", () => {
    expect(rotationSpeedToFanLevel(50.5)).toBe(9);
    expect(rotationSpeedToFanLevel(33.3)).toBe(6);
  });
});

describe("aqi mapping", () => {
  it("maps thresholds", () => {
    expect(aqiToHomeKitAirQuality(10)).toBe(1);
    expect(aqiToHomeKitAirQuality(40)).toBe(2);
    expect(aqiToHomeKitAirQuality(80)).toBe(3);
    expect(aqiToHomeKitAirQuality(110)).toBe(3);
    expect(aqiToHomeKitAirQuality(150)).toBe(4);
    expect(aqiToHomeKitAirQuality(151)).toBe(5);
  });

  it("maps invalid AQI values to unknown", () => {
    expect(aqiToHomeKitAirQuality(Number.NaN)).toBe(0);
    expect(aqiToHomeKitAirQuality(-1)).toBe(0);
  });

  it("maps exact boundary AQI values correctly", () => {
    expect(aqiToHomeKitAirQuality(0)).toBe(1);
    expect(aqiToHomeKitAirQuality(35)).toBe(1);
    expect(aqiToHomeKitAirQuality(36)).toBe(2);
    expect(aqiToHomeKitAirQuality(75)).toBe(2);
    expect(aqiToHomeKitAirQuality(76)).toBe(3);
    expect(aqiToHomeKitAirQuality(115)).toBe(3);
    expect(aqiToHomeKitAirQuality(116)).toBe(4);
    expect(aqiToHomeKitAirQuality(150)).toBe(4);
    expect(aqiToHomeKitAirQuality(151)).toBe(5);
  });

  it("handles edge numeric values", () => {
    expect(aqiToHomeKitAirQuality(Number.POSITIVE_INFINITY)).toBe(0);
    expect(aqiToHomeKitAirQuality(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(aqiToHomeKitAirQuality(0.5)).toBe(1);
    expect(aqiToHomeKitAirQuality(999999)).toBe(5);
  });
});
