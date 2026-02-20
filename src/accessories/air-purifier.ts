import type {
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from "homebridge";
import type { DeviceClient } from "../core/device-client";
import { aqiToHomeKitAirQuality } from "../core/mappers";
import { modeToAutoNightSwitchState } from "../core/mode-policy";

export class AirPurifierAccessory implements AccessoryPlugin {
  private readonly informationService: Service;
  private readonly powerService: Service;
  private readonly airQualityService: Service;
  private readonly temperatureService: Service;
  private readonly humidityService: Service;
  private readonly childLockService: Service;
  private readonly ledService: Service;
  private readonly modeService: Service;
  private readonly filterService: Service;
  private readonly characteristicCache = new Map<string, CharacteristicValue>();
  private connectedLogged = false;

  public constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly name: string,
    private readonly address: string,
    private readonly client: DeviceClient,
    model: string,
    private readonly filterChangeThreshold: number,
  ) {
    this.informationService = new this.api.hap.Service.AccessoryInformation()
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Xiaomi")
      .setCharacteristic(this.api.hap.Characteristic.Model, model)
      .setCharacteristic(this.api.hap.Characteristic.Name, name)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, "unknown");

    this.powerService = new this.api.hap.Service.Switch("Power", "power");
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
    this.modeService = new this.api.hap.Service.Switch(
      "Mode AUTO/NIGHT",
      "mode_auto_night",
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
      this.powerService,
      this.airQualityService,
      this.temperatureService,
      this.humidityService,
      this.childLockService,
      this.ledService,
      this.modeService,
      this.filterService,
    ];
  }

  private bindHandlers(): void {
    this.powerService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setPower(Boolean(value)),
      );

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

    this.modeService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        await this.handleModeSwitch(Boolean(value));
      });
  }

  private async handleModeSwitch(enabled: boolean): Promise<void> {
    const state = this.client.state;
    if (!state || !state.power) {
      this.log.debug("Ignoring mode change while device power is OFF.");
      this.refreshCharacteristics();
      return;
    }

    await this.client.setMode(enabled ? "auto" : "sleep");
  }

  private refreshCharacteristics(): void {
    const state = this.client.state;
    if (!state) {
      return;
    }

    if (!this.connectedLogged) {
      this.connectedLogged = true;
      this.log.info(`Connected to "${this.name}" @ ${this.address}!`);
    }

    this.updateCharacteristicIfNeeded(
      this.powerService,
      this.api.hap.Characteristic.On,
      state.power,
    );

    this.updateCharacteristicIfNeeded(
      this.airQualityService,
      this.api.hap.Characteristic.AirQuality,
      aqiToHomeKitAirQuality(state.aqi),
    );
    this.updateCharacteristicIfNeeded(
      this.temperatureService,
      this.api.hap.Characteristic.CurrentTemperature,
      state.temperature,
    );
    this.updateCharacteristicIfNeeded(
      this.humidityService,
      this.api.hap.Characteristic.CurrentRelativeHumidity,
      state.humidity,
    );

    this.updateCharacteristicIfNeeded(
      this.childLockService,
      this.api.hap.Characteristic.On,
      state.child_lock,
    );
    this.updateCharacteristicIfNeeded(
      this.ledService,
      this.api.hap.Characteristic.On,
      state.led,
    );
    this.updateCharacteristicIfNeeded(
      this.modeService,
      this.api.hap.Characteristic.On,
      modeToAutoNightSwitchState(state.mode),
    );

    this.updateCharacteristicIfNeeded(
      this.filterService,
      this.api.hap.Characteristic.FilterLifeLevel,
      state.filter1_life,
    );
    this.updateCharacteristicIfNeeded(
      this.filterService,
      this.api.hap.Characteristic.FilterChangeIndication,
      state.filter1_life < this.filterChangeThreshold
        ? this.api.hap.Characteristic.FilterChangeIndication.CHANGE_FILTER
        : this.api.hap.Characteristic.FilterChangeIndication.FILTER_OK,
    );
  }

  private updateCharacteristicIfNeeded(
    service: Service,
    characteristic: unknown,
    value: CharacteristicValue,
  ): void {
    const characteristicUuid = String(
      Reflect.get(characteristic as object, "UUID") ?? "",
    );
    const key = `${service.UUID}:${String(Reflect.get(service, "subtype") ?? "")}:${characteristicUuid}`;
    if (this.characteristicCache.get(key) === value) {
      return;
    }

    this.characteristicCache.set(key, value);
    service.updateCharacteristic(characteristic as never, value);
  }
}
