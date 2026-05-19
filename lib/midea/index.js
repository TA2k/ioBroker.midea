"use strict";

const { CloudClient, CloudClientV1, createCloudClient, V1_APPS } = require("./cloud");
const { LanClient } = require("./lan");
const { discover, APPLIANCE_TYPES, parseDiscoveryReply, enumerateBroadcastTargets } = require("./discover");
const { BaseDevice } = require("./devices/base");
const { ACDevice, APPLIANCE_TYPE_AC, MODE_BY_NAME, MODE_BY_INDEX, FAN_BY_NAME, FAN_NAME_BY_VALUE } = require("./devices/ac");
const { CommercialACDevice, APPLIANCE_TYPE_COMMERCIAL_AC } = require("./devices/commercialac");
const {
    DehumidifierDevice,
    APPLIANCE_TYPE_DEHUMIDIFIER,
    MODE_BY_NAME: DH_MODE_BY_NAME,
    MODE_BY_INDEX: DH_MODE_BY_INDEX,
    FAN_BY_NAME: DH_FAN_BY_NAME,
    FAN_NAME_BY_VALUE: DH_FAN_NAME_BY_VALUE,
} = require("./devices/dehumidifier");
const {
    FanDevice,
    APPLIANCE_TYPE_FAN,
    FAN_MODES,
    FAN_OSCILLATION_ANGLES,
    FAN_TILTING_ANGLES,
    FAN_OSCILLATION_MODES,
} = require("./devices/fan");
const {
    PurifierDevice,
    APPLIANCE_TYPE_PURIFIER,
    PURIFIER_MODES,
    PURIFIER_FAN_SPEEDS,
    PURIFIER_SCREEN_DISPLAYS,
    PURIFIER_DETECT_MODES,
} = require("./devices/purifier");
const {
    HumidifierDevice,
    APPLIANCE_TYPE_HUMIDIFIER,
    HUMIDIFIER_MODES,
    HUMIDIFIER_SPEEDS_OLD,
    HUMIDIFIER_SPEEDS_NEW,
    HUMIDIFIER_SCREEN_DISPLAYS,
} = require("./devices/humidifier");

const { AirBoxDevice, APPLIANCE_TYPE_AIR_BOX } = require("./devices/airbox");
const { FreshAirDevice, APPLIANCE_TYPE_FRESH_AIR } = require("./devices/freshair");
const { HeatPumpDevice, APPLIANCE_TYPE_HEATPUMP } = require("./devices/heatpump");
const { HeatPumpWaterHeaterDevice, APPLIANCE_TYPE_HEAT_PUMP_WATER } = require("./devices/heatpumpwater");
const {
    TopLoadWasherDevice, APPLIANCE_TYPE_TOP_LOAD_WASHER,
    FrontLoadWasherDevice, APPLIANCE_TYPE_FRONT_LOAD_WASHER,
    DryerDevice, APPLIANCE_TYPE_DRYER,
} = require("./devices/laundry");
const { ElectricHeaterDevice, APPLIANCE_TYPE_ELECTRIC_HEATER } = require("./devices/electricheater");
const { GasBoilerDevice, APPLIANCE_TYPE_GAS_BOILER } = require("./devices/gasboiler");
const { GasWaterHeaterDevice, APPLIANCE_TYPE_GAS_WATER_HEATER } = require("./devices/gaswaterheater");
const { ElectricWaterHeaterDevice, APPLIANCE_TYPE_ELECTRIC_WATER_HEATER } = require("./devices/electricwaterheater");
const { DishwasherDevice, APPLIANCE_TYPE_DISHWASHER } = require("./devices/dishwasher");
const { MicrowaveDevice, APPLIANCE_TYPE_MICROWAVE } = require("./devices/microwave");
const {
    OvenDevice, APPLIANCE_TYPE_OVEN,
    SteamerDevice, APPLIANCE_TYPE_STEAMER,
    OvenSteamDevice, APPLIANCE_TYPE_OVEN_STEAM,
    IntegratedOvenDevice, APPLIANCE_TYPE_INTEGRATED_OVEN,
} = require("./devices/kitchen");
const {
    PressureCookerDevice, APPLIANCE_TYPE_PRESSURE_COOKER,
    RiceCookerEADevice, APPLIANCE_TYPE_RICE_COOKER_EA,
    RiceCookerECDevice, APPLIANCE_TYPE_RICE_COOKER_EC,
} = require("./devices/cookers");
const { RangeHoodDevice, APPLIANCE_TYPE_RANGE_HOOD } = require("./devices/rangehood");
const { VacuumDevice, APPLIANCE_TYPE_VACUUM } = require("./devices/vacuum");
const { SmartToiletDevice, APPLIANCE_TYPE_SMART_TOILET } = require("./devices/smarttoilet");
const { HeatPumpControllerDevice, APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER } = require("./devices/heatpumpctrl");
const { RefrigeratorDevice, APPLIANCE_TYPE_REFRIGERATOR } = require("./devices/refrigerator");
const { WaterPurifierDevice, APPLIANCE_TYPE_WATER_PURIFIER } = require("./devices/waterpurifier");
const {
    LightDevice, APPLIANCE_TYPE_LIGHT,
    BathroomHeaterDevice, APPLIANCE_TYPE_BATHROOM_HEATER,
    DishwasherX34Device, APPLIANCE_TYPE_DISHWASHER_X34,
    BathroomFanDevice, APPLIANCE_TYPE_BATHROOM_FAN,
} = require("./devices/bathroom");

const APPLIANCE_TYPE = {
    DEHUMIDIFIER: APPLIANCE_TYPE_DEHUMIDIFIER,
    AC: APPLIANCE_TYPE_AC,
    COMMERCIAL_AC: APPLIANCE_TYPE_COMMERCIAL_AC,
    FAN: APPLIANCE_TYPE_FAN,
    PURIFIER: APPLIANCE_TYPE_PURIFIER,
    HUMIDIFIER: APPLIANCE_TYPE_HUMIDIFIER,
    AIR_BOX: APPLIANCE_TYPE_AIR_BOX,
    FRESH_AIR: APPLIANCE_TYPE_FRESH_AIR,
    HEATPUMP: APPLIANCE_TYPE_HEATPUMP,
    HEAT_PUMP_WATER: APPLIANCE_TYPE_HEAT_PUMP_WATER,
    HEAT_PUMP_CONTROLLER: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER,
    TOP_LOAD_WASHER: APPLIANCE_TYPE_TOP_LOAD_WASHER,
    FRONT_LOAD_WASHER: APPLIANCE_TYPE_FRONT_LOAD_WASHER,
    DRYER: APPLIANCE_TYPE_DRYER,
    ELECTRIC_HEATER: APPLIANCE_TYPE_ELECTRIC_HEATER,
    GAS_BOILER: APPLIANCE_TYPE_GAS_BOILER,
    GAS_WATER_HEATER: APPLIANCE_TYPE_GAS_WATER_HEATER,
    ELECTRIC_WATER_HEATER: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
    DISHWASHER: APPLIANCE_TYPE_DISHWASHER,
    MICROWAVE: APPLIANCE_TYPE_MICROWAVE,
    OVEN: APPLIANCE_TYPE_OVEN,
    STEAMER: APPLIANCE_TYPE_STEAMER,
    OVEN_STEAM: APPLIANCE_TYPE_OVEN_STEAM,
    INTEGRATED_OVEN: APPLIANCE_TYPE_INTEGRATED_OVEN,
    PRESSURE_COOKER: APPLIANCE_TYPE_PRESSURE_COOKER,
    RICE_COOKER_EA: APPLIANCE_TYPE_RICE_COOKER_EA,
    RICE_COOKER_EC: APPLIANCE_TYPE_RICE_COOKER_EC,
    RANGE_HOOD: APPLIANCE_TYPE_RANGE_HOOD,
    VACUUM: APPLIANCE_TYPE_VACUUM,
    SMART_TOILET: APPLIANCE_TYPE_SMART_TOILET,
    REFRIGERATOR: APPLIANCE_TYPE_REFRIGERATOR,
    WATER_PURIFIER: APPLIANCE_TYPE_WATER_PURIFIER,
    LIGHT: APPLIANCE_TYPE_LIGHT,
    BATHROOM_HEATER: APPLIANCE_TYPE_BATHROOM_HEATER,
    DISHWASHER_X34: APPLIANCE_TYPE_DISHWASHER_X34,
    BATHROOM_FAN: APPLIANCE_TYPE_BATHROOM_FAN,
};

const DEVICE_CLASS_BY_TYPE = {
    [APPLIANCE_TYPE_AC]: ACDevice,
    [APPLIANCE_TYPE_COMMERCIAL_AC]: CommercialACDevice,
    [APPLIANCE_TYPE_DEHUMIDIFIER]: DehumidifierDevice,
    [APPLIANCE_TYPE_FAN]: FanDevice,
    [APPLIANCE_TYPE_PURIFIER]: PurifierDevice,
    [APPLIANCE_TYPE_HUMIDIFIER]: HumidifierDevice,
    [APPLIANCE_TYPE_AIR_BOX]: AirBoxDevice,
    [APPLIANCE_TYPE_FRESH_AIR]: FreshAirDevice,
    [APPLIANCE_TYPE_HEATPUMP]: HeatPumpDevice,
    [APPLIANCE_TYPE_HEAT_PUMP_WATER]: HeatPumpWaterHeaterDevice,
    [APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER]: HeatPumpControllerDevice,
    [APPLIANCE_TYPE_TOP_LOAD_WASHER]: TopLoadWasherDevice,
    [APPLIANCE_TYPE_FRONT_LOAD_WASHER]: FrontLoadWasherDevice,
    [APPLIANCE_TYPE_DRYER]: DryerDevice,
    [APPLIANCE_TYPE_ELECTRIC_HEATER]: ElectricHeaterDevice,
    [APPLIANCE_TYPE_GAS_BOILER]: GasBoilerDevice,
    [APPLIANCE_TYPE_GAS_WATER_HEATER]: GasWaterHeaterDevice,
    [APPLIANCE_TYPE_ELECTRIC_WATER_HEATER]: ElectricWaterHeaterDevice,
    [APPLIANCE_TYPE_DISHWASHER]: DishwasherDevice,
    [APPLIANCE_TYPE_MICROWAVE]: MicrowaveDevice,
    [APPLIANCE_TYPE_OVEN]: OvenDevice,
    [APPLIANCE_TYPE_STEAMER]: SteamerDevice,
    [APPLIANCE_TYPE_OVEN_STEAM]: OvenSteamDevice,
    [APPLIANCE_TYPE_INTEGRATED_OVEN]: IntegratedOvenDevice,
    [APPLIANCE_TYPE_PRESSURE_COOKER]: PressureCookerDevice,
    [APPLIANCE_TYPE_RICE_COOKER_EA]: RiceCookerEADevice,
    [APPLIANCE_TYPE_RICE_COOKER_EC]: RiceCookerECDevice,
    [APPLIANCE_TYPE_RANGE_HOOD]: RangeHoodDevice,
    [APPLIANCE_TYPE_VACUUM]: VacuumDevice,
    [APPLIANCE_TYPE_SMART_TOILET]: SmartToiletDevice,
    [APPLIANCE_TYPE_REFRIGERATOR]: RefrigeratorDevice,
    [APPLIANCE_TYPE_WATER_PURIFIER]: WaterPurifierDevice,
    [APPLIANCE_TYPE_LIGHT]: LightDevice,
    [APPLIANCE_TYPE_BATHROOM_HEATER]: BathroomHeaterDevice,
    [APPLIANCE_TYPE_DISHWASHER_X34]: DishwasherX34Device,
    [APPLIANCE_TYPE_BATHROOM_FAN]: BathroomFanDevice,
};

/**
 * Build the right device subclass for an appliance descriptor returned by
 * discover() or by the cloud listAppliances() call. Falls back to BaseDevice
 * for any unrecognised appliance type.
 *
 * @param {any} descriptor
 * @param {Record<string, any>} [opts]
 */
function createDevice(descriptor, opts = {}) {
    const merged = { ...descriptor, ...opts };
    const type = descriptor.applianceType ?? descriptor.type;
    const Cls = DEVICE_CLASS_BY_TYPE[type];
    if (Cls) return new Cls(merged);
    return new BaseDevice(merged);
}

module.exports = {
    APPLIANCE_TYPE,
    APPLIANCE_TYPES,
    CloudClient,
    CloudClientV1,
    createCloudClient,
    V1_APPS,
    LanClient,
    BaseDevice,
    ACDevice,
    APPLIANCE_TYPE_AC,
    APPLIANCE_TYPE_COMMERCIAL_AC,
    CommercialACDevice,
    MODE_BY_NAME,
    MODE_BY_INDEX,
    FAN_BY_NAME,
    FAN_NAME_BY_VALUE,
    DehumidifierDevice,
    APPLIANCE_TYPE_DEHUMIDIFIER,
    DH_MODE_BY_NAME,
    DH_MODE_BY_INDEX,
    DH_FAN_BY_NAME,
    DH_FAN_NAME_BY_VALUE,
    FanDevice,
    APPLIANCE_TYPE_FAN,
    FAN_MODES,
    FAN_OSCILLATION_ANGLES,
    FAN_TILTING_ANGLES,
    FAN_OSCILLATION_MODES,
    PurifierDevice,
    APPLIANCE_TYPE_PURIFIER,
    PURIFIER_MODES,
    PURIFIER_FAN_SPEEDS,
    PURIFIER_SCREEN_DISPLAYS,
    PURIFIER_DETECT_MODES,
    HumidifierDevice,
    APPLIANCE_TYPE_HUMIDIFIER,
    HUMIDIFIER_MODES,
    HUMIDIFIER_SPEEDS_OLD,
    HUMIDIFIER_SPEEDS_NEW,
    HUMIDIFIER_SCREEN_DISPLAYS,
    AirBoxDevice, APPLIANCE_TYPE_AIR_BOX,
    FreshAirDevice, APPLIANCE_TYPE_FRESH_AIR,
    HeatPumpDevice, APPLIANCE_TYPE_HEATPUMP,
    HeatPumpWaterHeaterDevice, APPLIANCE_TYPE_HEAT_PUMP_WATER,
    HeatPumpControllerDevice, APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER,
    TopLoadWasherDevice, APPLIANCE_TYPE_TOP_LOAD_WASHER,
    FrontLoadWasherDevice, APPLIANCE_TYPE_FRONT_LOAD_WASHER,
    DryerDevice, APPLIANCE_TYPE_DRYER,
    ElectricHeaterDevice, APPLIANCE_TYPE_ELECTRIC_HEATER,
    GasBoilerDevice, APPLIANCE_TYPE_GAS_BOILER,
    GasWaterHeaterDevice, APPLIANCE_TYPE_GAS_WATER_HEATER,
    ElectricWaterHeaterDevice, APPLIANCE_TYPE_ELECTRIC_WATER_HEATER,
    DishwasherDevice, APPLIANCE_TYPE_DISHWASHER,
    MicrowaveDevice, APPLIANCE_TYPE_MICROWAVE,
    OvenDevice, APPLIANCE_TYPE_OVEN,
    SteamerDevice, APPLIANCE_TYPE_STEAMER,
    OvenSteamDevice, APPLIANCE_TYPE_OVEN_STEAM,
    IntegratedOvenDevice, APPLIANCE_TYPE_INTEGRATED_OVEN,
    PressureCookerDevice, APPLIANCE_TYPE_PRESSURE_COOKER,
    RiceCookerEADevice, APPLIANCE_TYPE_RICE_COOKER_EA,
    RiceCookerECDevice, APPLIANCE_TYPE_RICE_COOKER_EC,
    RangeHoodDevice, APPLIANCE_TYPE_RANGE_HOOD,
    VacuumDevice, APPLIANCE_TYPE_VACUUM,
    SmartToiletDevice, APPLIANCE_TYPE_SMART_TOILET,
    RefrigeratorDevice, APPLIANCE_TYPE_REFRIGERATOR,
    WaterPurifierDevice, APPLIANCE_TYPE_WATER_PURIFIER,
    LightDevice, APPLIANCE_TYPE_LIGHT,
    BathroomHeaterDevice, APPLIANCE_TYPE_BATHROOM_HEATER,
    DishwasherX34Device, APPLIANCE_TYPE_DISHWASHER_X34,
    BathroomFanDevice, APPLIANCE_TYPE_BATHROOM_FAN,
    discover,
    parseDiscoveryReply,
    enumerateBroadcastTargets,
    createDevice,
};
