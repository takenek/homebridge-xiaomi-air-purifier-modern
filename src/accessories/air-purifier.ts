import type { AccessoryPlugin, API, CharacteristicValue, Logging, Service } from "homebridge";
import type { ConnectionStateEvent, DeviceClient } from "../core/device-client";
import { aqiToHomeKitAirQuality } from "../core/mappers";
import {
  isAutoModeSwitchOn,
  isNightModeSwitchOn,
  resolveModeFromAutoSwitch,
  resolveModeFromNightSwitch,
} from "../core/mode-policy";

type CharacteristicLike = { UUID: string } & Record<string, unknown>;

const getEnumValue = (obj: CharacteristicLike, key: string, fallback: number): number => {
  const value = key in obj ? obj[key] : undefined;
  return typeof value === "number" ? value : fallback;
};

export class AirPurifierAccessory implements AccessoryPlugin {
  private readonly informationService: Service;
  private readonly powerService: Service;
  private readonly airQualityService: Service;
  private readonly temperatureService: Service;
  private readonly humidityService: Service;
  private readonly childLockService: Service;
  private readonly ledService: Service;
  private readonly modeAutoService: Service;
  private readonly modeNightService: Service;
  private readonly filterService: Service;
  private readonly filterAlertService: Service | null;
  private readonly characteristicCache = new Map<string, CharacteristicValue>();

  public constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly name: string,
    private readonly address: string,
    private readonly client: DeviceClient,
    model: string,
    private readonly filterChangeThreshold: number,
    private readonly exposeFilterReplaceAlertSensor = false,
  ) {
    this.informationService = new this.api.hap.Service.AccessoryInformation()
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Xiaomi")
      .setCharacteristic(this.api.hap.Characteristic.Model, model)
      .setCharacteristic(this.api.hap.Characteristic.Name, name)
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        // Derive a stable, unique serial from the device address so that
        // multiple Xiaomi purifiers in the same HomeKit home stay distinct.
        Buffer.from(address)
          .toString("base64")
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 16),
      );

    this.powerService = new this.api.hap.Service.Switch("Power", "power");
    this.airQualityService = new this.api.hap.Service.AirQualitySensor(`${name} Air Quality`);
    this.temperatureService = new this.api.hap.Service.TemperatureSensor(`${name} Temperature`);
    this.humidityService = new this.api.hap.Service.HumiditySensor(`${name} Humidity`);
    this.childLockService = new this.api.hap.Service.Switch("Child Lock", "child_lock");
    this.ledService = new this.api.hap.Service.Switch("LED Night Mode", "led");
    this.modeAutoService = new this.api.hap.Service.Switch("Mode AUTO ON/OFF", "mode_auto");
    this.modeNightService = new this.api.hap.Service.Switch("Mode NIGHT ON/OFF", "mode_night");
    this.filterService = new this.api.hap.Service.FilterMaintenance("Filter Life");
    this.filterAlertService = this.exposeFilterReplaceAlertSensor
      ? new this.api.hap.Service.ContactSensor("Filter Replace Alert", "filter_replace_alert")
      : null;

    this.applyServiceNames();

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
      { service: this.powerService, name: "Power" },
      { service: this.airQualityService, name: `${this.name} Air Quality` },
      { service: this.temperatureService, name: `${this.name} Temperature` },
      { service: this.humidityService, name: `${this.name} Humidity` },
      { service: this.childLockService, name: "Child Lock" },
      { service: this.ledService, name: "LED Night Mode" },
      { service: this.modeAutoService, name: "Mode AUTO ON/OFF" },
      { service: this.modeNightService, name: "Mode NIGHT ON/OFF" },
      { service: this.filterService, name: "Filter Life" },
      ...(this.filterAlertService
        ? [{ service: this.filterAlertService, name: "Filter Replace Alert" }]
        : []),
    ];

    const charObj = this.api.hap.Characteristic as unknown as Record<string, unknown>;
    const configuredName = "ConfiguredName" in charObj ? charObj.ConfiguredName : undefined;

    for (const { service, name } of namedServices) {
      service.setCharacteristic(this.api.hap.Characteristic.Name, name);
      if (configuredName) {
        service.setCharacteristic(configuredName as never, name);
      }
    }
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
      this.modeAutoService,
      this.modeNightService,
      this.filterService,
      ...(this.filterAlertService ? [this.filterAlertService] : []),
    ];
  }

  private bindHandlers(): void {
    const Char = this.api.hap.Characteristic;

    this.powerService
      .getCharacteristic(Char.On)
      .onGet(() => this.client.state?.power ?? false)
      .onSet(async (value: CharacteristicValue) => this.client.setPower(Boolean(value)));

    this.airQualityService
      .getCharacteristic(Char.AirQuality)
      .onGet(() => aqiToHomeKitAirQuality(this.client.state?.aqi ?? 0));

    this.temperatureService
      .getCharacteristic(Char.CurrentTemperature)
      .onGet(() => this.client.state?.temperature ?? 0);

    this.humidityService
      .getCharacteristic(Char.CurrentRelativeHumidity)
      .onGet(() => this.client.state?.humidity ?? 0);

    this.childLockService
      .getCharacteristic(Char.On)
      .onGet(() => this.client.state?.child_lock ?? false)
      .onSet(async (value: CharacteristicValue) => this.client.setChildLock(Boolean(value)));

    this.ledService
      .getCharacteristic(Char.On)
      .onGet(() => this.client.state?.led ?? false)
      .onSet(async (value: CharacteristicValue) => this.client.setLed(Boolean(value)));

    this.modeAutoService
      .getCharacteristic(Char.On)
      .onGet(() => isAutoModeSwitchOn(this.client.state?.mode ?? "idle"))
      .onSet(async (value: CharacteristicValue) => {
        const state = this.client.state;
        const mode = resolveModeFromAutoSwitch(Boolean(value), Boolean(state?.power));
        await this.handleModeSwitch(mode);
      });

    this.modeNightService
      .getCharacteristic(Char.On)
      .onGet(() => isNightModeSwitchOn(this.client.state?.mode ?? "idle"))
      .onSet(async (value: CharacteristicValue) => {
        const state = this.client.state;
        const mode = resolveModeFromNightSwitch(Boolean(value), Boolean(state?.power));
        await this.handleModeSwitch(mode);
      });

    this.filterService
      .getCharacteristic(Char.FilterLifeLevel)
      .onGet(() => this.client.state?.filter1_life ?? 0);

    this.filterService
      .getCharacteristic(Char.FilterChangeIndication)
      .onGet(() => this.getFilterChangeIndication());

    if (this.filterAlertService) {
      this.filterAlertService
        .getCharacteristic(Char.ContactSensorState)
        .onGet(() => this.getContactSensorState());
    }
  }

  private async handleModeSwitch(nextMode: "auto" | "sleep" | null): Promise<void> {
    if (!nextMode) {
      this.log.debug("Ignoring mode change while device power is OFF.");
      this.refreshCharacteristics();
      return;
    }

    await this.client.setMode(nextMode);
  }

  private getFilterChangeIndication(): number {
    const filterLife = this.client.state?.filter1_life ?? 100;
    const indication = this.api.hap.Characteristic
      .FilterChangeIndication as unknown as CharacteristicLike;
    return filterLife <= this.filterChangeThreshold
      ? getEnumValue(indication, "CHANGE_FILTER", 1)
      : getEnumValue(indication, "FILTER_OK", 0);
  }

  private getContactSensorState(): number {
    const filterLife = this.client.state?.filter1_life ?? 100;
    const contact = this.api.hap.Characteristic.ContactSensorState as unknown as CharacteristicLike;
    // In HAP: CONTACT_DETECTED = 0 (closed = normal, no alert)
    //         CONTACT_NOT_DETECTED = 1 (open = alarm state)
    // Filter needs replacement → sensor "open" → CONTACT_NOT_DETECTED (1) = alert
    // Filter is OK            → sensor "closed" → CONTACT_DETECTED (0) = no alert
    return filterLife <= this.filterChangeThreshold
      ? getEnumValue(contact, "CONTACT_NOT_DETECTED", 1)
      : getEnumValue(contact, "CONTACT_DETECTED", 0);
  }

  private refreshCharacteristics(): void {
    const state = this.client.state;
    if (!state) {
      return;
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
    this.updateCharacteristicIfNeeded(this.ledService, this.api.hap.Characteristic.On, state.led);
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
    this.updateCharacteristicIfNeeded(
      this.filterService,
      this.api.hap.Characteristic.FilterChangeIndication,
      this.getFilterChangeIndication(),
    );

    if (this.filterAlertService) {
      this.updateCharacteristicIfNeeded(
        this.filterAlertService,
        this.api.hap.Characteristic.ContactSensorState,
        this.getContactSensorState(),
      );
    }
  }

  private logConnectionEvent(event: ConnectionStateEvent): void {
    if (event.state === "connected") {
      this.log.info(`Connected to "${this.name}" @ ${this.address}!`);
      return;
    }

    if (event.state === "reconnected") {
      this.log.info(`Reconnected to "${this.name}" @ ${this.address}.`);
      return;
    }

    this.log.warn(
      `Disconnected from "${this.name}" @ ${this.address} (code ${event.code ?? "UNKNOWN"}): ${event.message ?? "Unknown error"}`,
    );
  }

  private updateCharacteristicIfNeeded(
    service: Service,
    characteristic: unknown,
    value: CharacteristicValue,
  ): void {
    const charLike = characteristic as CharacteristicLike;
    const characteristicUuid = "UUID" in charLike ? String(charLike.UUID) : "";
    const serviceLike = service as Service & { subtype?: string };
    const key = `${service.UUID}:${serviceLike.subtype ?? ""}:${characteristicUuid}`;
    if (this.characteristicCache.get(key) === value) {
      return;
    }

    this.characteristicCache.set(key, value);
    service.updateCharacteristic(characteristic as never, value);
  }
}
