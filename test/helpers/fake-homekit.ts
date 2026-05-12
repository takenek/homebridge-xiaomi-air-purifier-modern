import { vi } from "vitest";
import type { DeviceState } from "../../src/core/types";

export const makeState = (
  overrides: Partial<DeviceState> = {},
): DeviceState => ({
  power: true,
  fan_level: 8,
  mode: "auto",
  temperature: 23,
  humidity: 40,
  aqi: 30,
  filter1_life: 85,
  child_lock: false,
  led: true,
  motor1_speed: 1000,
  use_time: 100,
  purify_volume: 200,
  ...overrides,
});

export const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export class FakeCharacteristic {
  public onSetHandler: ((value: unknown) => Promise<void> | void) | null = null;
  public onGetHandler: (() => unknown) | null = null;
  public constructor(public readonly UUID: string) {}
  public onSet(handler: (value: unknown) => Promise<void> | void): this {
    this.onSetHandler = handler;
    return this;
  }
  public onGet(handler: () => unknown): this {
    this.onGetHandler = handler;
    return this;
  }
}

export class FakeService {
  public readonly UUID: string;
  public readonly subtype: string | undefined;
  public displayName: string;
  public updates: Array<{ characteristic: string; value: unknown }> = [];
  public readonly setCalls: Array<{ characteristic: string; value: unknown }> =
    [];
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  public constructor(
    public readonly name: string,
    subtype?: string,
  ) {
    this.UUID = name;
    this.subtype = subtype;
    this.displayName = name;
  }

  public setCharacteristic(
    characteristic: { UUID: string },
    value: unknown,
  ): this {
    this.setCalls.push({ characteristic: characteristic.UUID, value });
    return this;
  }

  public getCharacteristic(characteristic: {
    UUID: string;
  }): FakeCharacteristic {
    const existing = this.characteristics.get(characteristic.UUID);
    if (existing) {
      return existing;
    }
    const created = new FakeCharacteristic(characteristic.UUID);
    this.characteristics.set(characteristic.UUID, created);
    return created;
  }

  public updateCharacteristic(
    characteristic: { UUID: string },
    value: unknown,
  ): this {
    this.updates.push({ characteristic: characteristic.UUID, value });
    return this;
  }
}

export class FakePlatformAccessory {
  public readonly UUID: string;
  public displayName: string;
  public readonly services: FakeService[] = [];
  public context: Record<string, unknown> = {};

  public constructor(displayName: string, uuid: string) {
    this.displayName = displayName;
    this.UUID = uuid;
  }

  public addService(service: FakeService): FakeService {
    this.services.push(service);
    return service;
  }

  public removeService(service: FakeService): void {
    const index = this.services.indexOf(service);
    if (index >= 0) {
      this.services.splice(index, 1);
    }
  }

  public getService(serviceConstructor: unknown): FakeService | undefined {
    return this.services.find(
      (s) =>
        s instanceof
        (serviceConstructor as new (
          ...args: unknown[]
        ) => unknown),
    );
  }

  public getServiceById(
    serviceConstructor: unknown,
    subtype: string,
  ): FakeService | undefined {
    return this.services.find(
      (s) =>
        s instanceof
          (serviceConstructor as new (
            ...args: unknown[]
          ) => unknown) && s.subtype === subtype,
    );
  }

  public updateDisplayName(name: string): void {
    this.displayName = name;
  }
}

export class FakeClient {
  public state: DeviceState | null = { ...makeState() };
  public readonly listeners: Array<(state: DeviceState) => void> = [];
  public readonly connectionListeners: Array<
    (event: { state: "connected" | "disconnected" | "reconnected" }) => void
  > = [];
  public readonly calls: string[] = [];
  public onStateUpdate(listener: (state: DeviceState) => void): void {
    this.listeners.push(listener);
  }
  public onConnectionEvent(
    listener: (event: {
      state: "connected" | "disconnected" | "reconnected";
    }) => void,
  ): void {
    this.connectionListeners.push(listener);
  }
  public async init(): Promise<void> {}
  public async shutdown(): Promise<void> {
    this.calls.push("shutdown");
  }
  public async setPower(value: boolean): Promise<void> {
    this.calls.push(`power:${value}`);
  }
  public async setChildLock(value: boolean): Promise<void> {
    this.calls.push(`child:${value}`);
  }
  public async setLed(value: boolean): Promise<void> {
    this.calls.push(`led:${value}`);
  }
  public async setMode(value: string): Promise<void> {
    this.calls.push(`mode:${value}`);
  }
  public async setFanLevel(value: number): Promise<void> {
    this.calls.push(`fan:${value}`);
  }
}

export const makeApi = (withConfiguredName = true) => {
  const events = new Map<string, Array<() => void>>();
  const api = {
    hap: {
      Service: {
        AccessoryInformation: class extends FakeService {
          public constructor() {
            super("AccessoryInformation");
          }
        },
        AirPurifier: class extends FakeService {
          public constructor(name: string, subtype?: string) {
            super(`AirPurifier:${name}`, subtype);
          }
        },
        Switch: class extends FakeService {
          public constructor(name: string, subtype?: string) {
            super(`Switch:${name}`, subtype);
          }
        },
        AirQualitySensor: class extends FakeService {
          public constructor(name: string) {
            super(`AirQuality:${name}`);
          }
        },
        TemperatureSensor: class extends FakeService {
          public constructor(name: string) {
            super(`Temp:${name}`);
          }
        },
        HumiditySensor: class extends FakeService {
          public constructor(name: string) {
            super(`Humidity:${name}`);
          }
        },
        FilterMaintenance: class extends FakeService {
          public constructor(name: string) {
            super(`Filter:${name}`);
          }
        },
        ContactSensor: class extends FakeService {
          public constructor(name: string, subtype?: string) {
            super(`Contact:${name}`, subtype);
          }
        },
      },
      Characteristic: {
        Manufacturer: { UUID: "manufacturer" },
        Model: { UUID: "model" },
        Name: { UUID: "name" },
        ...(withConfiguredName
          ? { ConfiguredName: { UUID: "configuredName" } }
          : {}),
        SerialNumber: { UUID: "serial" },
        On: { UUID: "on" },
        Active: { UUID: "active", ACTIVE: 1, INACTIVE: 0 },
        CurrentAirPurifierState: {
          UUID: "currentAirPurifierState",
          INACTIVE: 0,
          IDLE: 1,
          PURIFYING_AIR: 2,
        },
        TargetAirPurifierState: {
          UUID: "targetAirPurifierState",
          AUTO: 0,
          MANUAL: 1,
        },
        RotationSpeed: { UUID: "rotationSpeed" },
        AirQuality: { UUID: "airQuality", UNKNOWN: 0 },
        PM2_5Density: { UUID: "pm25" },
        CurrentTemperature: { UUID: "temp" },
        CurrentRelativeHumidity: { UUID: "humidity" },
        FilterLifeLevel: { UUID: "filterLife" },
        FilterChangeIndication: {
          UUID: "filterIndication",
          CHANGE_FILTER: 1,
          FILTER_OK: 0,
        },
        ContactSensorState: {
          UUID: "contactState",
          CONTACT_NOT_DETECTED: 0,
          CONTACT_DETECTED: 1,
        },
      },
      uuid: {
        generate: (input: string) => `uuid-${input}`,
      },
    },
    on: (event: string, cb: () => void) => {
      const arr = events.get(event) ?? [];
      arr.push(cb);
      events.set(event, arr);
    },
    emit: (event: string) => {
      for (const cb of events.get(event) ?? []) {
        cb();
      }
    },
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    platformAccessory: FakePlatformAccessory,
  };

  return api as unknown as {
    hap: unknown;
    on: (event: string, cb: () => void) => void;
    emit: (event: string) => void;
    registerPlatformAccessories: ReturnType<typeof vi.fn>;
    unregisterPlatformAccessories: ReturnType<typeof vi.fn>;
    updatePlatformAccessories: ReturnType<typeof vi.fn>;
    platformAccessory: typeof FakePlatformAccessory;
  };
};
