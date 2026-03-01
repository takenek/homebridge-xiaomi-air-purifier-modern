import type {
  AccessoryPlugin,
  API,
  CharacteristicValue,
  Logging,
  Service,
} from "homebridge";
import type { ConnectionStateEvent, DeviceClient } from "../core/device-client";
import {
  aqiToHomeKitAirQuality,
  fanLevelToRotationSpeed,
  rotationSpeedToFanLevel,
} from "../core/mappers";
import {
  isAutoModeSwitchOn,
  isNightModeSwitchOn,
  resolveModeFromAutoSwitch,
  resolveModeFromNightSwitch,
} from "../core/mode-policy";

export interface AccessoryFeatureFlags {
  enableAirQuality: boolean;
  enableTemperature: boolean;
  enableHumidity: boolean;
  exposeFilterReplaceAlertSensor: boolean;
  enableChildLockControl: boolean;
}

export class AirPurifierAccessory implements AccessoryPlugin {
  private readonly informationService: Service;
  private readonly purifierService: Service;
  private readonly airQualityService: Service | null;
  private readonly temperatureService: Service | null;
  private readonly humidityService: Service | null;
  private readonly childLockService: Service | null;
  private readonly ledService: Service;
  private readonly displayAddress: string;
  private readonly modeAutoService: Service;
  private readonly modeNightService: Service;
  private readonly filterService: Service;
  private readonly filterAlertService: Service | null;
  private readonly characteristicCache = new Map<string, CharacteristicValue>();
  private readonly usesNativePurifierService: boolean;

  public constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly name: string,
    _address: string,
    displayAddress: string,
    private readonly client: DeviceClient,
    model: string,
    private readonly filterChangeThreshold: number,
    featuresOrExpose: AccessoryFeatureFlags | boolean = false,
  ) {
    this.displayAddress = displayAddress;

    const features: AccessoryFeatureFlags =
      typeof featuresOrExpose === "boolean"
        ? {
            enableAirQuality: true,
            enableTemperature: true,
            enableHumidity: true,
            exposeFilterReplaceAlertSensor: featuresOrExpose,
            enableChildLockControl: true,
          }
        : featuresOrExpose;
    this.informationService = new this.api.hap.Service.AccessoryInformation()
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Xiaomi")
      .setCharacteristic(this.api.hap.Characteristic.Model, model)
      .setCharacteristic(this.api.hap.Characteristic.Name, name)
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        this.buildSerialNumber(displayAddress),
      );

    const AirPurifierService = Reflect.get(
      this.api.hap.Service as object,
      "AirPurifier",
    );
    this.usesNativePurifierService = Boolean(AirPurifierService);
    this.purifierService = this.usesNativePurifierService
      ? new (
          AirPurifierService as new (
            name: string,
            subtype: string,
          ) => Service
        )(name, "main")
      : new this.api.hap.Service.Switch("Power", "power");
    this.airQualityService = features.enableAirQuality
      ? new this.api.hap.Service.AirQualitySensor(`${name} Air Quality`)
      : null;
    this.temperatureService = features.enableTemperature
      ? new this.api.hap.Service.TemperatureSensor(`${name} Temperature`)
      : null;
    this.humidityService = features.enableHumidity
      ? new this.api.hap.Service.HumiditySensor(`${name} Humidity`)
      : null;
    this.childLockService = features.enableChildLockControl
      ? new this.api.hap.Service.Switch("Child Lock", "child_lock")
      : null;
    this.ledService = new this.api.hap.Service.Switch("LED Night Mode", "led");
    this.modeAutoService = new this.api.hap.Service.Switch(
      "Mode AUTO ON/OFF",
      "mode_auto",
    );
    this.modeNightService = new this.api.hap.Service.Switch(
      "Mode NIGHT ON/OFF",
      "mode_night",
    );
    this.filterService = new this.api.hap.Service.FilterMaintenance(
      "Filter Life",
    );
    this.filterAlertService = features.exposeFilterReplaceAlertSensor
      ? new this.api.hap.Service.ContactSensor(
          "Filter Replace Alert",
          "filter_replace_alert",
        )
      : null;

    this.applyServiceNames();
    this.log.debug(
      `Accessory initialized for device endpoint ${this.displayAddress}.`,
    );

    this.bindHandlers();
    this.client.onStateUpdate(() => this.refreshCharacteristics());
    this.client.onConnectionEvent((event) => this.logConnectionEvent(event));
    void this.client
      .init()
      .then(() => this.refreshCharacteristics())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Initial device connection failed: ${message}`);
      });

    this.api.on("shutdown", () => {
      void this.client.shutdown().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Shutdown error: ${message}`);
      });
    });
  }

  private applyServiceNames(): void {
    const namedServices: Array<{ service: Service; name: string }> = [
      { service: this.informationService, name: this.name },
      { service: this.purifierService, name: this.name },
      ...(this.airQualityService
        ? [
            {
              service: this.airQualityService,
              name: `${this.name} Air Quality`,
            },
          ]
        : []),
      ...(this.temperatureService
        ? [
            {
              service: this.temperatureService,
              name: `${this.name} Temperature`,
            },
          ]
        : []),
      ...(this.humidityService
        ? [{ service: this.humidityService, name: `${this.name} Humidity` }]
        : []),
      ...(this.childLockService
        ? [{ service: this.childLockService, name: "Child Lock" }]
        : []),
      { service: this.ledService, name: "LED Night Mode" },
      { service: this.modeAutoService, name: "Mode AUTO ON/OFF" },
      { service: this.modeNightService, name: "Mode NIGHT ON/OFF" },
      { service: this.filterService, name: "Filter Life" },
      ...(this.filterAlertService
        ? [{ service: this.filterAlertService, name: "Filter Replace Alert" }]
        : []),
    ];

    for (const { service, name } of namedServices) {
      service.setCharacteristic(this.api.hap.Characteristic.Name, name);
      const configuredName = Reflect.get(
        this.api.hap.Characteristic as object,
        "ConfiguredName",
      );
      if (configuredName) {
        service.setCharacteristic(configuredName as never, name);
      }
    }
  }

  public getServices(): Service[] {
    return [
      this.informationService,
      this.purifierService,
      ...(this.airQualityService ? [this.airQualityService] : []),
      ...(this.temperatureService ? [this.temperatureService] : []),
      ...(this.humidityService ? [this.humidityService] : []),
      ...(this.childLockService ? [this.childLockService] : []),
      this.ledService,
      this.modeAutoService,
      this.modeNightService,
      this.filterService,
      ...(this.filterAlertService ? [this.filterAlertService] : []),
    ];
  }

  private bindHandlers(): void {
    if (!this.usesNativePurifierService) {
      this.purifierService
        .getCharacteristic(this.api.hap.Characteristic.On)
        .onSet(async (value: CharacteristicValue) =>
          this.client.setPower(Boolean(value)),
        );
      this.bindOnGet(
        this.purifierService,
        this.api.hap.Characteristic.On,
        false,
      );
    } else {
      this.purifierService
        .getCharacteristic(this.api.hap.Characteristic.Active)
        .onSet(async (value: CharacteristicValue) =>
          this.client.setPower(
            Number(value) === this.api.hap.Characteristic.Active.ACTIVE,
          ),
        );
      this.bindOnGet(
        this.purifierService,
        this.api.hap.Characteristic.Active,
        Number(this.api.hap.Characteristic.Active.INACTIVE),
      );
      this.bindOnGet(
        this.purifierService,
        this.api.hap.Characteristic.CurrentAirPurifierState,
        Number(this.api.hap.Characteristic.CurrentAirPurifierState.INACTIVE),
      );
      this.bindOnGet(
        this.purifierService,
        this.api.hap.Characteristic.TargetAirPurifierState,
        Number(this.api.hap.Characteristic.TargetAirPurifierState.AUTO),
      );
      this.purifierService
        .getCharacteristic(this.api.hap.Characteristic.TargetAirPurifierState)
        .onSet(async (value: CharacteristicValue) => {
          const isAuto =
            Number(value) ===
            Number(this.api.hap.Characteristic.TargetAirPurifierState.AUTO);
          await this.client.setMode(isAuto ? "auto" : "favorite");
        });
      this.purifierService
        .getCharacteristic(this.api.hap.Characteristic.RotationSpeed)
        .onSet(async (value: CharacteristicValue) => {
          await this.client.setFanLevel(rotationSpeedToFanLevel(Number(value)));
        });
      this.bindOnGet(
        this.purifierService,
        this.api.hap.Characteristic.RotationSpeed,
        0,
      );
    }

    this.childLockService
      ?.getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setChildLock(Boolean(value)),
      );
    if (this.childLockService) {
      this.bindOnGet(
        this.childLockService,
        this.api.hap.Characteristic.On,
        false,
      );
    }

    this.ledService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) =>
        this.client.setLed(Boolean(value)),
      );
    this.bindOnGet(this.ledService, this.api.hap.Characteristic.On, false);

    this.modeAutoService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        const state = this.client.state;
        const mode = resolveModeFromAutoSwitch(
          Boolean(value),
          Boolean(state?.power),
        );
        await this.handleModeSwitch(mode);
      });
    this.bindOnGet(this.modeAutoService, this.api.hap.Characteristic.On, false);

    this.modeNightService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        const state = this.client.state;
        const mode = resolveModeFromNightSwitch(
          Boolean(value),
          Boolean(state?.power),
        );
        await this.handleModeSwitch(mode);
      });
    this.bindOnGet(
      this.modeNightService,
      this.api.hap.Characteristic.On,
      false,
    );

    if (this.airQualityService) {
      this.bindOnGet(
        this.airQualityService,
        this.api.hap.Characteristic.AirQuality,
        Number(this.api.hap.Characteristic.AirQuality.UNKNOWN),
      );
      this.bindOnGet(
        this.airQualityService,
        this.api.hap.Characteristic.PM2_5Density,
        0,
      );
    }
    if (this.temperatureService) {
      this.bindOnGet(
        this.temperatureService,
        this.api.hap.Characteristic.CurrentTemperature,
        0,
      );
    }
    if (this.humidityService) {
      this.bindOnGet(
        this.humidityService,
        this.api.hap.Characteristic.CurrentRelativeHumidity,
        0,
      );
    }

    this.bindOnGet(
      this.filterService,
      this.api.hap.Characteristic.FilterLifeLevel,
      0,
    );
    this.bindOnGet(
      this.filterService,
      this.api.hap.Characteristic.FilterChangeIndication,
      Number(this.api.hap.Characteristic.FilterChangeIndication.FILTER_OK),
    );
    if (this.filterAlertService) {
      this.bindOnGet(
        this.filterAlertService,
        this.api.hap.Characteristic.ContactSensorState,
        Number(this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED),
      );
    }
  }

  private async handleModeSwitch(
    nextMode: "auto" | "sleep" | null,
  ): Promise<void> {
    if (!nextMode) {
      this.log.debug("Ignoring mode change while device power is OFF.");
      this.refreshCharacteristics();
      return;
    }

    await this.client.setMode(nextMode);
  }

  private refreshCharacteristics(): void {
    const state = this.client.state;
    if (!state) {
      return;
    }

    if (!this.usesNativePurifierService) {
      this.updateCharacteristicIfNeeded(
        this.purifierService,
        this.api.hap.Characteristic.On,
        state.power,
      );
    } else {
      this.updateCharacteristicIfNeeded(
        this.purifierService,
        this.api.hap.Characteristic.Active,
        state.power
          ? this.api.hap.Characteristic.Active.ACTIVE
          : this.api.hap.Characteristic.Active.INACTIVE,
      );
      this.updateCharacteristicIfNeeded(
        this.purifierService,
        this.api.hap.Characteristic.CurrentAirPurifierState,
        state.power
          ? state.mode === "idle"
            ? this.api.hap.Characteristic.CurrentAirPurifierState.IDLE
            : this.api.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
          : this.api.hap.Characteristic.CurrentAirPurifierState.INACTIVE,
      );
      this.updateCharacteristicIfNeeded(
        this.purifierService,
        this.api.hap.Characteristic.TargetAirPurifierState,
        state.mode === "auto"
          ? this.api.hap.Characteristic.TargetAirPurifierState.AUTO
          : this.api.hap.Characteristic.TargetAirPurifierState.MANUAL,
      );
      this.updateCharacteristicIfNeeded(
        this.purifierService,
        this.api.hap.Characteristic.RotationSpeed,
        fanLevelToRotationSpeed(state.fan_level),
      );
    }

    if (this.airQualityService) {
      this.updateCharacteristicIfNeeded(
        this.airQualityService,
        this.api.hap.Characteristic.AirQuality,
        aqiToHomeKitAirQuality(state.aqi),
      );
      this.updateCharacteristicIfNeeded(
        this.airQualityService,
        this.api.hap.Characteristic.PM2_5Density,
        Math.min(1000, Math.max(0, state.aqi)),
      );
    }
    if (this.temperatureService) {
      this.updateCharacteristicIfNeeded(
        this.temperatureService,
        this.api.hap.Characteristic.CurrentTemperature,
        state.temperature,
      );
    }
    if (this.humidityService) {
      this.updateCharacteristicIfNeeded(
        this.humidityService,
        this.api.hap.Characteristic.CurrentRelativeHumidity,
        state.humidity,
      );
    }

    if (this.childLockService) {
      this.updateCharacteristicIfNeeded(
        this.childLockService,
        this.api.hap.Characteristic.On,
        state.child_lock,
      );
    }

    this.updateCharacteristicIfNeeded(
      this.ledService,
      this.api.hap.Characteristic.On,
      state.led,
    );
    this.updateCharacteristicIfNeeded(
      this.modeAutoService,
      this.api.hap.Characteristic.On,
      isAutoModeSwitchOn(state.mode),
    );
    this.updateCharacteristicIfNeeded(
      this.modeNightService,
      this.api.hap.Characteristic.On,
      isNightModeSwitchOn(state.mode),
    );

    this.updateCharacteristicIfNeeded(
      this.filterService,
      this.api.hap.Characteristic.FilterLifeLevel,
      state.filter1_life,
    );
    const filterChangeIndication = Reflect.get(
      this.api.hap.Characteristic.FilterChangeIndication as object,
      "CHANGE_FILTER",
    );
    const filterOkIndication = Reflect.get(
      this.api.hap.Characteristic.FilterChangeIndication as object,
      "FILTER_OK",
    );

    this.updateCharacteristicIfNeeded(
      this.filterService,
      this.api.hap.Characteristic.FilterChangeIndication,
      state.filter1_life <= this.filterChangeThreshold
        ? typeof filterChangeIndication === "number"
          ? filterChangeIndication
          : 1
        : typeof filterOkIndication === "number"
          ? filterOkIndication
          : 0,
    );

    if (this.filterAlertService) {
      const contactDetected = Reflect.get(
        this.api.hap.Characteristic.ContactSensorState as object,
        "CONTACT_DETECTED",
      );
      const contactNotDetected = Reflect.get(
        this.api.hap.Characteristic.ContactSensorState as object,
        "CONTACT_NOT_DETECTED",
      );

      this.updateCharacteristicIfNeeded(
        this.filterAlertService,
        this.api.hap.Characteristic.ContactSensorState,
        state.filter1_life <= this.filterChangeThreshold
          ? typeof contactNotDetected === "number"
            ? contactNotDetected
            : 1
          : typeof contactDetected === "number"
            ? contactDetected
            : 0,
      );
    }
  }

  private bindOnGet(
    service: Service,
    characteristic: unknown,
    fallback: CharacteristicValue,
  ): void {
    const characteristicUuid = this.resolveCharacteristicUuid(characteristic);
    if (!characteristicUuid) {
      return;
    }

    const bound = service.getCharacteristic(
      characteristic as never,
    ) as unknown as {
      onGet?: (handler: () => CharacteristicValue) => unknown;
    };
    if (typeof bound.onGet !== "function") {
      return;
    }

    bound.onGet(
      () =>
        this.characteristicCache.get(
          `${service.UUID}:${String(Reflect.get(service, "subtype") ?? "")}:${characteristicUuid}`,
        ) ?? fallback,
    );
  }

  private resolveCharacteristicUuid(characteristic: unknown): string {
    if (
      (typeof characteristic !== "object" || characteristic === null) &&
      typeof characteristic !== "function"
    ) {
      return "";
    }

    const uuid = Reflect.get(characteristic as object, "UUID");
    return typeof uuid === "string" ? uuid : "";
  }

  private buildSerialNumber(ipAddress: string): string {
    return `miap-${ipAddress.replaceAll(".", "-")}`;
  }

  private logConnectionEvent(event: ConnectionStateEvent): void {
    if (event.state === "connected") {
      this.log.info(`Connected to "${this.name}" @ ${this.displayAddress}!`);
      return;
    }

    if (event.state === "reconnected") {
      this.log.info(`Reconnected to "${this.name}" @ ${this.displayAddress}.`);
      return;
    }

    this.log.warn(
      `Disconnected from "${this.name}" @ ${this.displayAddress} (code ${event.code ?? "UNKNOWN"}): ${event.message ?? "Unknown error"}`,
    );
  }

  private updateCharacteristicIfNeeded(
    service: Service,
    characteristic: unknown,
    value: CharacteristicValue,
  ): void {
    const characteristicUuid = this.resolveCharacteristicUuid(characteristic);
    if (!characteristicUuid) {
      return;
    }
    const key = `${service.UUID}:${String(Reflect.get(service, "subtype") ?? "")}:${characteristicUuid}`;
    if (this.characteristicCache.get(key) === value) {
      return;
    }

    this.characteristicCache.set(key, value);
    service.updateCharacteristic(characteristic as never, value);
  }
}
