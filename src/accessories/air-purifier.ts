import type {
  API,
  AccessoryPlugin,
  CharacteristicValue,
  Logging,
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

export class AirPurifierAccessory implements AccessoryPlugin {
  private readonly informationService: Service;
  private readonly fanService: Service;
  private readonly airQualityService: Service;
  private readonly temperatureService: Service;
  private readonly humidityService: Service;
  private readonly childLockService: Service;
  private readonly ledService: Service;
  private readonly autoModeService: Service;
  private readonly sleepModeService: Service;
  private readonly filterService: Service;

  public constructor(
    private readonly api: API,
    private readonly log: Logging,
    name: string,
    private readonly client: DeviceClient,
    model: string,
  ) {
    this.informationService = new this.api.hap.Service.AccessoryInformation()
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Xiaomi")
      .setCharacteristic(this.api.hap.Characteristic.Model, model)
      .setCharacteristic(this.api.hap.Characteristic.Name, name)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, "unknown");

    this.fanService = new this.api.hap.Service.Fanv2(name);
    this.airQualityService = new this.api.hap.Service.AirQualitySensor(
      `${name} Air Quality`,
    );
    this.temperatureService = new this.api.hap.Service.TemperatureSensor(
      `${name} Temperature`,
    );
    this.humidityService = new this.api.hap.Service.HumiditySensor(
      `${name} Humidity`,
    );
    this.childLockService = new this.api.hap.Service.Switch(
      "Child Lock",
      "child_lock",
    );
    this.ledService = new this.api.hap.Service.Switch("LED Night Mode", "led");
    this.autoModeService = new this.api.hap.Service.Switch(
      "Auto Mode",
      "mode_auto",
    );
    this.sleepModeService = new this.api.hap.Service.Switch(
      "Sleep Mode",
      "mode_sleep",
    );
    this.filterService = new this.api.hap.Service.FilterMaintenance(
      "Filter Life",
    );

    this.bindHandlers();
    this.client.onStateUpdate(() => this.refreshCharacteristics());
    void this.client
      .init()
      .then(() => this.refreshCharacteristics())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Initial device connection failed: ${message}`);
      });

    this.api.on("shutdown", () => {
      void this.client.shutdown();
    });
  }

  public getServices(): Service[] {
    return [
      this.informationService,
      this.fanService,
      this.airQualityService,
      this.temperatureService,
      this.humidityService,
      this.childLockService,
      this.ledService,
      this.autoModeService,
      this.sleepModeService,
      this.filterService,
    ];
  }

  private bindHandlers(): void {
    this.fanService
      .getCharacteristic(this.api.hap.Characteristic.Active)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setPower(Number(value) === 1),
      );

    this.fanService
      .getCharacteristic(this.api.hap.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        await this.client.setFanLevel(rotationSpeedToFanLevel(Number(value)));
      });

    this.childLockService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setChildLock(Boolean(value)),
      );

    this.ledService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setLed(Boolean(value)),
      );

    this.autoModeService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.handleModeSwitch(Boolean(value), "auto"),
      );

    this.sleepModeService
      .getCharacteristic(this.api.hap.Characteristic.On)
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
      this.api.hap.Characteristic.Active,
      state.power ? 1 : 0,
    );
    this.fanService.updateCharacteristic(
      this.api.hap.Characteristic.RotationSpeed,
      fanLevelToRotationSpeed(state.fan_level),
    );
    this.airQualityService.updateCharacteristic(
      this.api.hap.Characteristic.AirQuality,
      aqiToHomeKitAirQuality(state.aqi),
    );
    this.temperatureService.updateCharacteristic(
      this.api.hap.Characteristic.CurrentTemperature,
      state.temperature,
    );
    this.humidityService.updateCharacteristic(
      this.api.hap.Characteristic.CurrentRelativeHumidity,
      state.humidity,
    );

    this.childLockService.updateCharacteristic(
      this.api.hap.Characteristic.On,
      state.child_lock,
    );
    this.ledService.updateCharacteristic(
      this.api.hap.Characteristic.On,
      state.led,
    );
    this.autoModeService.updateCharacteristic(
      this.api.hap.Characteristic.On,
      state.mode === "auto",
    );
    this.sleepModeService.updateCharacteristic(
      this.api.hap.Characteristic.On,
      state.mode === "sleep",
    );

    this.filterService.updateCharacteristic(
      this.api.hap.Characteristic.FilterLifeLevel,
      state.filter1_life,
    );
    this.filterService.updateCharacteristic(
      this.api.hap.Characteristic.FilterChangeIndication,
      state.filter1_life < 10
        ? this.api.hap.Characteristic.FilterChangeIndication.CHANGE_FILTER
        : this.api.hap.Characteristic.FilterChangeIndication.FILTER_OK,
    );
  }
}
