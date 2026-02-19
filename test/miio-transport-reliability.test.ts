import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernMiioTransport } from "../src/core/miio-transport";
import type { DeviceState } from "../src/core/types";

const legacyEmptyState: DeviceState = {
  power: false,
  fan_level: 0,
  mode: "idle",
  temperature: 0,
  humidity: 0,
  aqi: 0,
  filter1_life: 0,
  child_lock: false,
  led: false,
  buzzer_volume: 0,
  motor1_speed: 0,
  use_time: 0,
  purify_volume: 0,
};

describe("ModernMiioTransport reliability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not mask retryable MIOT fallback errors as null state", async () => {
    const transport = new ModernMiioTransport({
      address: "127.0.0.1",
      token: "00112233445566778899aabbccddeeff",
      model: "zhimi.airpurifier.ma4",
      timeoutMs: 50,
    });

    const retryableError = Object.assign(new Error("network timeout"), {
      code: "ETIMEDOUT",
    });

    const transportInternals = transport as unknown as {
      detectProtocolMode: () => Promise<"legacy" | "miot" | null>;
      readViaLegacy: () => Promise<DeviceState>;
      readViaMiot: () => Promise<DeviceState>;
    };

    const detectProtocolMode = vi
      .spyOn(transportInternals, "detectProtocolMode")
      .mockResolvedValue("legacy");
    const readViaLegacy = vi
      .spyOn(transportInternals, "readViaLegacy")
      .mockResolvedValue(legacyEmptyState);
    const readViaMiot = vi
      .spyOn(transportInternals, "readViaMiot")
      .mockRejectedValue(retryableError);

    await expect(transport.getProperties([])).rejects.toBe(retryableError);
    expect(detectProtocolMode).toHaveBeenCalledTimes(1);
    expect(readViaLegacy).toHaveBeenCalledTimes(1);
    expect(readViaMiot).toHaveBeenCalledTimes(1);

    await transport.close();
  });
});
