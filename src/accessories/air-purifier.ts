import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from "homebridge";
import type { DeviceClient } from "../core/device-client";
import {
  aqiToHomeKitAirQuality,
  fanLevelToRotationSpeed,
  rotationSpeedToFanLevel,
} from "../core/mappers";
import { resolveModeOnSwitchToggle } from "../core/mode-policy";
import type { DeviceMode } from "../core/types";
import type { XiaomiAirPurifierPlatform } from "../platform";

interface AccessoryConfig {
  name: string;
}

export class AirPurifierAccessory {
  private readonly fanService: Service;
  private readonly airQualityService: Service;
  private readonly temperatureService: Service;
  private readonly humidityService: Service;
  private readonly childLockService: Service;
  private readonly ledService: Service;
  private readonly autoModeService: Service;
  private readonly sleepModeService: Service;
  private readonly batteryService: Service;

  public constructor(
    private readonly platform: XiaomiAirPurifierPlatform,
    accessory: PlatformAccessory,
    private readonly client: DeviceClient,
    config: AccessoryConfig,
  ) {
    this.fanService =
      accessory.getService(this.platform.api.hap.Service.Fanv2) ??
      accessory.addService(this.platform.api.hap.Service.Fanv2, config.name);
    this.airQualityService =
      accessory.getService(this.platform.api.hap.Service.AirQualitySensor) ??
      accessory.addService(
        this.platform.api.hap.Service.AirQualitySensor,
        `${config.name} Air Quality`,
      );
    this.temperatureService =
      accessory.getService(this.platform.api.hap.Service.TemperatureSensor) ??
      accessory.addService(
        this.platform.api.hap.Service.TemperatureSensor,
        `${config.name} Temperature`,
      );
    this.humidityService =
      accessory.getService(this.platform.api.hap.Service.HumiditySensor) ??
      accessory.addService(
        this.platform.api.hap.Service.HumiditySensor,
        `${config.name} Humidity`,
      );
    this.childLockService =
      accessory.getService("Child Lock") ??
      accessory.addService(
        this.platform.api.hap.Service.Switch,
        "Child Lock",
        "child_lock",
      );
    this.ledService =
      accessory.getService("LED Night Mode") ??
      accessory.addService(
        this.platform.api.hap.Service.Switch,
        "LED Night Mode",
        "led",
      );
    this.autoModeService =
      accessory.getService("Auto Mode") ??
      accessory.addService(
        this.platform.api.hap.Service.Switch,
        "Auto Mode",
        "mode_auto",
      );
    this.sleepModeService =
      accessory.getService("Sleep Mode") ??
      accessory.addService(
        this.platform.api.hap.Service.Switch,
        "Sleep Mode",
        "mode_sleep",
      );
    this.batteryService =
      accessory.getService(this.platform.api.hap.Service.Battery) ??
      accessory.addService(
        this.platform.api.hap.Service.Battery,
        "Filter Life",
      );

    this.bindHandlers();
    this.client.onStateUpdate(() => this.refreshCharacteristics());
    void this.client.init().then(() => this.refreshCharacteristics());

    this.platform.api.on("shutdown", () => {
      void this.client.shutdown();
    });
  }

  private bindHandlers(): void {
    this.fanService
      .getCharacteristic(this.platform.api.hap.Characteristic.Active)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setPower(Number(value) === 1),
      );

    this.fanService
      .getCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        await this.client.setFanLevel(rotationSpeedToFanLevel(Number(value)));
      });

    this.childLockService
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setChildLock(Boolean(value)),
      );

    this.ledService
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setLed(Boolean(value)),
      );

    this.autoModeService
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.handleModeSwitch(Boolean(value), "auto"),
      );

    this.sleepModeService
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.handleModeSwitch(Boolean(value), "sleep"),
      );
  }

  private async handleModeSwitch(
    enabled: boolean,
    mode: DeviceMode,
  ): Promise<void> {
    const currentMode = this.client.state?.mode ?? "idle";
    const nextMode = resolveModeOnSwitchToggle(
      enabled,
      mode as "auto" | "sleep",
      currentMode,
    );
    if (nextMode) {
      await this.client.setMode(nextMode);
    }
  }

  private refreshCharacteristics(): void {
    const state = this.client.state;
    if (!state) {
      return;
    }

    this.fanService.updateCharacteristic(
      this.platform.api.hap.Characteristic.Active,
      state.power ? 1 : 0,
    );
    this.fanService.updateCharacteristic(
      this.platform.api.hap.Characteristic.RotationSpeed,
      fanLevelToRotationSpeed(state.fan_level),
    );
    this.airQualityService.updateCharacteristic(
      this.platform.api.hap.Characteristic.AirQuality,
      aqiToHomeKitAirQuality(state.aqi),
    );
    this.temperatureService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CurrentTemperature,
      state.temperature,
    );
    this.humidityService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CurrentRelativeHumidity,
      state.humidity,
    );

    this.childLockService.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      state.child_lock,
    );
    this.ledService.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      state.led,
    );
    this.autoModeService.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      state.mode === "auto",
    );
    this.sleepModeService.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      state.mode === "sleep",
    );

    this.batteryService.updateCharacteristic(
      this.platform.api.hap.Characteristic.BatteryLevel,
      state.filter1_life,
    );
    this.batteryService.updateCharacteristic(
      this.platform.api.hap.Characteristic.StatusLowBattery,
      state.filter1_life < 10
        ? this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_LOW
        : this.platform.api.hap.Characteristic.StatusLowBattery
            .BATTERY_LEVEL_NORMAL,
    );
    this.batteryService.updateCharacteristic(
      this.platform.api.hap.Characteristic.ChargingState,
      this.platform.api.hap.Characteristic.ChargingState.NOT_CHARGEABLE,
    );
  }
}
