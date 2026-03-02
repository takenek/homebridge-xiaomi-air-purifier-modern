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
  public async setProperty(
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
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

  it("serializes concurrent writes via operation queue", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    await client.init();

    await Promise.all([
      client.setPower(false),
      client.setFanLevel(3),
      client.setMode("auto"),
    ]);

    const methods = transport.methods.map((entry) => entry.method);
    expect(methods).toContain("set_power");
    expect(methods).toContain("set_level_fan");
    expect(methods).toContain("set_mode");
    await client.shutdown();
  });

  it("passes correct parameter encodings for boolean and numeric values", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    await client.init();

    await client.setPower(true);
    await client.setPower(false);
    await client.setChildLock(true);
    await client.setChildLock(false);
    await client.setLed(true);
    await client.setLed(false);
    await client.setBuzzerVolume(0);
    await client.setBuzzerVolume(100);
    await client.setFanLevel(1);
    await client.setFanLevel(16);

    expect(transport.methods).toEqual(
      expect.arrayContaining([
        { method: "set_power", params: ["on"] },
        { method: "set_power", params: ["off"] },
        { method: "set_child_lock", params: ["on"] },
        { method: "set_child_lock", params: ["off"] },
        { method: "set_led", params: ["on"] },
        { method: "set_led", params: ["off"] },
        { method: "set_buzzer_volume", params: [0] },
        { method: "set_buzzer_volume", params: [100] },
        { method: "set_level_fan", params: [1] },
        { method: "set_level_fan", params: [16] },
      ]),
    );
    await client.shutdown();
  });

  it("re-reads state after every write (set-and-sync)", async () => {
    let readCount = 0;
    const transport = new FakeTransport();
    const origGetProperties = transport.getProperties.bind(transport);
    transport.getProperties = async () => {
      readCount++;
      return origGetProperties();
    };
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    await client.init();
    const readsAfterInit = readCount;

    await client.setPower(true);
    expect(readCount).toBe(readsAfterInit + 1);

    await client.setFanLevel(5);
    expect(readCount).toBe(readsAfterInit + 2);

    await client.shutdown();
  });

  it("returns null state before init and populated state after init", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    expect(client.state).toBeNull();

    await client.init();
    expect(client.state).not.toBeNull();
    expect(client.state).toEqual(baseState);
    await client.shutdown();
  });

  it("notifies state listeners after init and writes", async () => {
    const transport = new FakeTransport();
    const client = new DeviceClient(transport, logger, {
      operationPollIntervalMs: 999999,
      sensorPollIntervalMs: 999999,
    });
    const updates: DeviceState[] = [];
    client.onStateUpdate((state) => updates.push({ ...state }));

    await client.init();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.power).toBe(true);

    await client.setPower(false);
    expect(updates).toHaveLength(2);
    await client.shutdown();
  });
});
