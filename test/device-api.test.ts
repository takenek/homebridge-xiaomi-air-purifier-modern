import { describe, expect, it } from "vitest";
import { DeviceClient } from "../src/core/device-client";
import type { DeviceState, MiioTransport } from "../src/core/types";

const baseState: DeviceState = {
  power: true,
  fan_level: 8,
  mode: "auto",
  temperature: 23,
  humidity: 40,
  aqi: 31,
  filter1_life: 77,
  child_lock: false,
  led: true,
  buzzer_volume: 50,
  motor1_speed: 890,
  use_time: 100,
  purify_volume: 200,
};

class FakeTransport implements MiioTransport {
  public methods: Array<{ method: string; params: readonly unknown[] }> = [];
  public async getProperties(): Promise<DeviceState> {
    return baseState;
  }
  public async setProperty(method: string, params: readonly unknown[]): Promise<void> {
    this.methods.push({ method, params });
  }
  public async close(): Promise<void> {}
}

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("device API read/write", () => {
  it("reads mandatory properties", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    await client.init();
    const state = client.state;
    expect(state).toBeTruthy();
    expect(state?.power).toBeTypeOf("boolean");
    expect(state?.fan_level).toBeTypeOf("number");
    expect(state?.mode).toBeTypeOf("string");
    expect(state?.temperature).toBeTypeOf("number");
    expect(state?.humidity).toBeTypeOf("number");
    expect(state?.aqi).toBeTypeOf("number");
    expect(state?.filter1_life).toBeTypeOf("number");
    expect(state?.child_lock).toBeTypeOf("boolean");
    expect(state?.led).toBeTypeOf("boolean");
    expect(state?.buzzer_volume).toBeTypeOf("number");
    expect(state?.motor1_speed).toBeTypeOf("number");
    expect(state?.use_time).toBeTypeOf("number");
    expect(state?.purify_volume).toBeTypeOf("number");
    await client.shutdown();
  });

  it("writes mandatory methods", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    await client.init();
    await client.setPower(true);
    await client.setFanLevel(10);
    await client.setMode("sleep");
    await client.setChildLock(true);
    await client.setLed(false);
    await client.setBuzzerVolume(35);

    expect(transport.methods.map((entry) => entry.method)).toEqual([
      "set_power",
      "set_level_fan",
      "set_mode",
      "set_child_lock",
      "set_led",
      "set_buzzer_volume",
    ]);
    await client.shutdown();
  });
});
