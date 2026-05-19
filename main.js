"use strict";

const utils = require("@iobroker/adapter-core");
const Json2iob = require("json2iob");

const midea = require("./lib/midea");
const { ACDevice } = require("./lib/midea/devices/ac");

/**
 * @param {unknown} err
 * @returns {string}
 */
function errMessage(err) {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return String(err);
}

const STATUS_DESCRIPTIONS = {
    powerOn: "Power state",
    mode: "Operating mode",
    modeIndex: "Operating mode (raw index)",
    temperatureSetpoint: "Target temperature",
    temperatureUnit: "Temperature unit (0=C, 1=F)",
    fanSpeed: "Fan speed (numeric)",
    fanSpeedName: "Fan speed (named)",
    swing: "Swing direction",
    ecoMode: "Eco mode",
    turboMode: "Turbo mode",
    sleepMode: "Sleep mode",
    purify: "Purify / ionizer",
    dryClean: "Dry clean",
    selfClean: "Self clean",
    frostProtection: "Frost protection (8 °C heat)",
    indoorTemperature: "Indoor temperature",
    outdoorTemperature: "Outdoor temperature",
    humiditySetpoint: "Humidity setpoint",
    statusCode: "Device status / error code",
    powerUsage: "Total power usage",
    inError: "Device reports error",
    onTimer: "On-timer active",
    offTimer: "Off-timer active",
    onTimerHours: "On-timer hours",
    onTimerMinutes: "On-timer minutes",
    offTimerHours: "Off-timer hours",
    offTimerMinutes: "Off-timer minutes",
    smartEye: "Smart eye / motion sensor",
    cosySleep: "Cosy sleep level",
    nightLight: "Night light",
    ventilation: "Ventilation",
    ptcHeater: "PTC auxiliary heater",
    auxHeating: "Auxiliary heater (PTC)",
    naturalFan: "Natural wind",
    naturalWind: "Natural wind",
    comfortMode: "Comfort mode",
    indirectWind: "Indirect wind (no wind on me)",
    breezeless: "Breezeless",
    indoorHumidity: "Indoor humidity",
    screenDisplay: "Screen display level",
    screenDisplayAlternate: "Screen display (alternate)",
    freshAirPower: "Fresh-air power",
    freshAirFanSpeed: "Fresh-air fan speed",
    freshAirMode: "Fresh-air mode",
    freshAirTemperature: "Fresh-air temperature setpoint",
    windLrAngle: "Left/right wind angle",
    windUdAngle: "Up/down wind angle",
    currentEnergyConsumption: "Current energy consumption",
    realtimePower: "Realtime power draw",
    totalOperatingConsumption: "Total operating consumption",
    electrifyTime: "Electrified runtime",
    totalOperatingTime: "Total operating time",
    currentOperatingTime: "Current operating time",
    childSleep: "Child sleep",
    coolFan: "Cool fan",
    catchCold: "Catch cold",
    peakValleyElectricitySaving: "Peak/valley electricity saving",
    feelOwn: "Feel own",
    save: "Save energy mode",
    lowFrequencyFan: "Low-frequency fan",
    light: "Display brightness level",
    pmv: "PMV index",
    leftrightFan: "Left/right swing active",
    updownFan: "Up/down swing active",
    fastCheck: "Fast check mode",
    timerMode: "Timer mode",
    resume: "Resume after power loss",
    dustFull: "Dust filter full",
    downWindControl: "Down wind control (UD)",
    downWindControlLR: "Down wind control (LR)",
    dualControl: "Dual setpoint control",
    windBlowing: "Wind blowing",
    smartWind: "Smart wind",
    braceletControl: "Bracelet control",
    braceletSleep: "Bracelet sleep",
    keepWarm: "Keep warm",
    online: "Device reachable on LAN",
    targetHumidity: "Target humidity",
    currentHumidity: "Current humidity",
    tankLevel: "Water tank level (%)",
    tankFull: "Water tank full",
    tankWarningLevel: "Tank warning threshold",
    defrosting: "Defrosting active",
    ionMode: "Ion / anion mode",
    pumpSwitch: "Drain pump on",
    pumpSwitchFlag: "Drain pump disabled",
    filterIndicator: "Filter needs cleaning",
    verticalSwing: "Vertical swing active",
    horizontalSwing: "Horizontal swing active",
    errorCode: "Error code",
    pm25: "PM2.5 air quality",
    dust: "Dust level",
    iMode: "iMode active",
    modeFc: "Mode FC sub-state",
    rareShow: "Rare-show indicator",
    dustTime: "Dust filter runtime",
    displayClass: "Display class",
    lightClass: "Light class",
    lightValue: "Light value",
};

const STATUS_UNITS = {
    temperatureSetpoint: "°C",
    indoorTemperature: "°C",
    outdoorTemperature: "°C",
    humiditySetpoint: "%",
    targetHumidity: "%",
    currentHumidity: "%",
    tankLevel: "%",
    tankWarningLevel: "%",
    powerUsage: "kWh",
    currentEnergyConsumption: "kWh",
    totalOperatingConsumption: "kWh",
    realtimePower: "W",
    electrifyTime: "min",
    totalOperatingTime: "min",
    currentOperatingTime: "min",
    onTimerHours: "h",
    offTimerHours: "h",
    onTimerMinutes: "min",
    offTimerMinutes: "min",
};

const STATUS_STATE_ENUMS = {
    mode: { auto: "auto", cool: "cool", dry: "dry", heat: "heat", fanonly: "fanonly", customdry: "customdry", off: "off", setpoint: "setpoint", continuous: "continuous", smart: "smart", dryer: "dryer" },
    fanSpeedName: { silent: "silent", low: "low", medium: "medium", high: "high", full: "full", auto: "auto", custom: "custom" },
    swing: { off: "off", vertical: "vertical", horizontal: "horizontal", both: "both" },
    temperatureUnit: { 0: "celsius", 1: "fahrenheit" },
};

const CAPABILITY_DESCRIPTIONS = {
    activeClean: "Active clean function",
    autoMode: "Auto mode supported",
    autoSetHumidity: "Automatic humidity setting",
    breezeAway: "Breeze-Away supported",
    breezeControl: "Breeze control supported",
    breezeMild: "Breeze-Mild supported",
    breezeless: "Breezeless supported",
    buzzer: "Buzzer supported",
    coolMode: "Cool mode supported",
    decimals: "Half-degree resolution",
    downNoWindFeel: "Down-no-wind-feel supported",
    dryMode: "Dry mode supported",
    ecoMode: "Eco mode supported",
    electricAuxHeating: "Electric auxiliary heating",
    fanSpeedControl: "Fan speed control supported",
    filterReminder: "Filter cleaning reminder",
    flashCool: "Flash cool",
    frostProtectionMode: "Frost protection (8 °C heat)",
    hasAutoClearHumidity: "Auto-clear humidity supported",
    hasHandWind: "Hand wind supported",
    heatMode: "Heat mode supported",
    horizontalSwingAngle: "Horizontal swing angle adjustable",
    ieco: "iECO supported",
    indoorHumidity: "Indoor humidity sensor present",
    leftrightFan: "Left/right swing supported",
    lightControl: "Display light control",
    manualSetHumidity: "Manual humidity setting",
    maxTempAuto: "Maximum auto-mode setpoint",
    maxTempCool: "Maximum cool-mode setpoint",
    maxTempHeat: "Maximum heat-mode setpoint",
    minTempAuto: "Minimum auto-mode setpoint",
    minTempCool: "Minimum cool-mode setpoint",
    minTempHeat: "Minimum heat-mode setpoint",
    nestCheck: "Nest-check capability",
    nestNeedChange: "Nest needs change",
    oneKeyNoWindOnMe: "One-key no wind on me",
    outSilent: "Outdoor silent mode",
    powerCal: "Power calculation",
    powerCalSetting: "Power calculation setting",
    rateSelect: "Rate select",
    selfClean: "Self clean",
    silkyCool: "Silky cool",
    smartEye: "Smart eye",
    specialEco: "Special eco",
    turboCool: "Turbo cool",
    turboHeat: "Turbo heat",
    unitChangeable: "Temperature unit changeable",
    updownFan: "Up/down swing supported",
    upNoWindFeel: "Up no-wind feel",
    verticalSwingAngle: "Vertical swing angle adjustable",
    windOffMe: "Wind off me",
    windOnMe: "Wind on me",
};

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const AC_CONTROLS = [
    { id: "powerOn", common: { name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false } },
    { id: "mode", common: { name: "Operating mode", type: "string", role: "state", read: true, write: true, def: "auto", states: { auto: "auto", cool: "cool", dry: "dry", heat: "heat", fanonly: "fanonly", customdry: "customdry" } } },
    { id: "temperatureSetpoint", common: { name: "Target temperature", type: "number", role: "level.temperature", unit: "°C", read: true, write: true, min: 16, max: 31, def: 21 } },
    { id: "temperatureUnit", common: { name: "Temperature unit", type: "string", role: "state", read: true, write: true, def: "celsius", states: { celsius: "celsius", fahrenheit: "fahrenheit" } } },
    { id: "fanSpeed", common: { name: "Fan speed (numeric)", type: "number", role: "level.fan", read: true, write: true, min: 0, max: 102, def: 102 } },
    { id: "fanSpeedName", common: { name: "Fan speed (named)", type: "string", role: "state", read: true, write: true, def: "auto", states: { silent: "silent", low: "low", medium: "medium", high: "high", full: "full", auto: "auto" } } },
    { id: "swing", common: { name: "Swing", type: "string", role: "state", read: true, write: true, def: "off", states: { off: "off", vertical: "vertical", horizontal: "horizontal", both: "both" } } },
    { id: "ecoMode", common: { name: "Eco mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "turboMode", common: { name: "Turbo mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "sleepMode", common: { name: "Sleep mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "purify", common: { name: "Purify / ionizer", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "dryClean", common: { name: "Dry clean", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "frostProtection", common: { name: "Frost protection (8 °C heat)", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "smartEye", common: { name: "Smart eye / motion sensor", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "auxHeating", common: { name: "Auxiliary heater (PTC)", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "naturalWind", common: { name: "Natural wind", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "comfortMode", common: { name: "Comfort mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "indirectWind", common: { name: "Indirect wind (no wind on me)", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "breezeless", common: { name: "Breezeless", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "screenDisplayAlternate", common: { name: "Screen display (alternate)", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "freshAirPower", common: { name: "Fresh-air power", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "freshAirFanSpeed", common: { name: "Fresh-air fan speed (0–100)", type: "number", role: "level.fan", read: true, write: true, min: 0, max: 100, def: 0 } },
    { id: "windLrAngle", common: { name: "Left/right wind angle (0–100)", type: "number", role: "level", read: true, write: true, min: 0, max: 100, def: 0 } },
    { id: "windUdAngle", common: { name: "Up/down wind angle (0–100)", type: "number", role: "level", read: true, write: true, min: 0, max: 100, def: 0 } },
    { id: "toggleDisplay", common: { name: "Toggle indoor unit display", type: "boolean", role: "button", read: false, write: true, def: false } },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const DEHUMIDIFIER_CONTROLS = [
    { id: "powerOn", common: { name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false } },
    { id: "mode", common: { name: "Operating mode", type: "string", role: "state", read: true, write: true, def: "setpoint", states: { setpoint: "setpoint", continuous: "continuous", smart: "smart", dryer: "dryer" } } },
    { id: "targetHumidity", common: { name: "Target humidity", type: "number", role: "level.humidity", unit: "%", read: true, write: true, min: 0, max: 100, def: 50 } },
    { id: "fanSpeed", common: { name: "Fan speed (numeric)", type: "number", role: "level.fan", read: true, write: true, min: 0, max: 127, def: 40 } },
    { id: "fanSpeedName", common: { name: "Fan speed (named)", type: "string", role: "state", read: true, write: true, def: "low", states: { silent: "silent", low: "low", medium: "medium", high: "high", auto: "auto" } } },
    { id: "ionMode", common: { name: "Ion / anion mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "sleepMode", common: { name: "Sleep mode", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "pumpSwitch", common: { name: "Drain pump", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "verticalSwing", common: { name: "Vertical swing", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "tankWarningLevel", common: { name: "Tank warning level", type: "number", role: "level", unit: "%", read: true, write: true, min: 0, max: 100, def: 100 } },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const FAN_CONTROLS = [
    { id: "powerOn", common: { name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false } },
    { id: "childLock", common: { name: "Child lock", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "mode", common: { name: "Operating mode", type: "string", role: "state", read: true, write: true, def: "normal", states: { normal: "normal", natural: "natural", sleep: "sleep", comfort: "comfort", silent: "silent", baby: "baby", induction: "induction", circulation: "circulation", strong: "strong", soft: "soft", customize: "customize", warm: "warm", smart: "smart" } } },
    { id: "fanSpeed", common: { name: "Fan speed", type: "number", role: "level.fan", read: true, write: true, min: 1, max: 26, def: 1 } },
    { id: "oscillate", common: { name: "Oscillation", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "oscillationMode", common: { name: "Oscillation mode", type: "string", role: "state", read: true, write: true, def: "off", states: { off: "off", oscillation: "oscillation", tilting: "tilting", "curve-w": "curve-w", "curve-8": "curve-8", reserved: "reserved", both: "both" } } },
    { id: "oscillationAngle", common: { name: "Oscillation angle (deg)", type: "string", role: "state", read: true, write: true, def: "off", states: { off: "off", 30: "30", 60: "60", 90: "90", 120: "120", 180: "180", 360: "360" } } },
    { id: "tiltingAngle", common: { name: "Tilting angle (deg)", type: "string", role: "state", read: true, write: true, def: "off", states: { off: "off", 30: "30", 60: "60", 90: "90", 120: "120", 180: "180", 360: "360", "+60": "+60", "-60": "-60", 40: "40" } } },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const PURIFIER_CONTROLS = [
    { id: "powerOn", common: { name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false } },
    { id: "mode", common: { name: "Operating mode", type: "string", role: "state", read: true, write: true, def: "auto", states: { standby: "standby", auto: "auto", manual: "manual", sleep: "sleep", fast: "fast", smoke: "smoke" } } },
    { id: "fanSpeedName", common: { name: "Fan speed", type: "string", role: "state", read: true, write: true, def: "auto", states: { auto: "auto", standby: "standby", low: "low", medium: "medium", high: "high" } } },
    { id: "anion", common: { name: "Anion / ionizer", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "childLock", common: { name: "Child lock", type: "boolean", role: "switch", read: true, write: true, def: false } },
    { id: "screenDisplayName", common: { name: "Screen display", type: "string", role: "state", read: true, write: true, def: "bright", states: { bright: "bright", dim: "dim", off: "off" } } },
    { id: "detectMode", common: { name: "Detect mode", type: "string", role: "state", read: true, write: true, def: "off", states: { off: "off", pm25: "pm25", methanal: "methanal" } } },
    { id: "standby", common: { name: "Standby (auto-stop on clean air)", type: "boolean", role: "switch", read: true, write: true, def: false } },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const HUMIDIFIER_CONTROLS = [
    { id: "powerOn", common: { name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false } },
    { id: "mode", common: { name: "Operating mode", type: "string", role: "state", read: true, write: true, def: "manual", states: { manual: "manual", auto: "auto", continuous: "continuous", "living-room": "living-room", "bed-room": "bed-room", kitchen: "kitchen", sleep: "sleep" } } },
    { id: "targetHumidity", common: { name: "Target humidity", type: "number", role: "level.humidity", unit: "%", read: true, write: true, min: 0, max: 100, def: 50 } },
    { id: "fanSpeedName", common: { name: "Fan speed", type: "string", role: "state", read: true, write: true, def: "low", states: { lowest: "lowest", low: "low", medium: "medium", high: "high", auto: "auto", off: "off" } } },
    { id: "screenDisplayName", common: { name: "Screen display", type: "string", role: "state", read: true, write: true, def: "bright", states: { bright: "bright", dim: "dim", off: "off" } } },
    { id: "disinfect", common: { name: "Disinfect", type: "boolean", role: "switch", read: true, write: true, def: false } },
];

/** @returns {ioBroker.StateCommon} */
const onOff = (name) => ({ name, type: "boolean", role: "switch", read: true, write: true, def: false });
/** @returns {ioBroker.StateCommon} */
const power = () => ({ name: "Power on/off", type: "boolean", role: "switch.power", read: true, write: true, def: false });
/** @returns {ioBroker.StateCommon} */
const numLevel = (name, min, max, def, unit) => ({ name, type: "number", role: "level", read: true, write: true, min, max, def, ...(unit ? { unit } : {}) });
/** @returns {ioBroker.StateCommon} */
const numTemp = (name, min, max, def) => ({ name, type: "number", role: "level.temperature", unit: "°C", read: true, write: true, min, max, def });
/** @returns {ioBroker.StateCommon} */
const enumState = (name, states, def) => ({ name, type: "string", role: "state", read: true, write: true, def, states });

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const FRESH_AIR_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "fanSpeed", common: numLevel("Fan speed", 0, 100, 40) },
    { id: "linkToAc", common: onOff("Link to AC") },
    { id: "sleepMode", common: onOff("Sleep mode") },
    { id: "ecoMode", common: onOff("Eco mode") },
    { id: "auxHeating", common: onOff("Aux heating") },
    { id: "powerfulPurify", common: onOff("Powerful purify") },
    { id: "scheduled", common: onOff("Scheduled") },
    { id: "childLock", common: onOff("Child lock") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const HEATPUMP_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "mode", common: enumState("Mode", { off: "off", auto: "auto", cool: "cool", heat: "heat" }, "auto") },
    { id: "targetTemperature", common: numTemp("Target temperature", 5, 60, 25) },
    { id: "auxHeating", common: onOff("Aux heating") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const HEAT_PUMP_WATER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "mode", common: enumState("Mode", { off: "off", energy: "energy", standard: "standard", hot: "hot", smart: "smart", vacation: "vacation" }, "standard") },
    { id: "targetTemperature", common: numTemp("Target temperature", 30, 75, 50) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const HEAT_PUMP_CTRL_CONTROLS = [
    { id: "zone1Power", common: onOff("Zone 1 power") },
    { id: "zone2Power", common: onOff("Zone 2 power") },
    { id: "dhwPower", common: onOff("DHW power") },
    { id: "zone1Curve", common: onOff("Zone 1 climate curve") },
    { id: "zone2Curve", common: onOff("Zone 2 climate curve") },
    { id: "tbh", common: onOff("Tank booster heater (TBH)") },
    { id: "fastDhw", common: onOff("Fast DHW") },
    { id: "mode", common: numLevel("Mode (raw 1..5)", 1, 5, 2) },
    { id: "zone1TargetTemp", common: numTemp("Zone 1 target temperature", 5, 60, 25) },
    { id: "zone2TargetTemp", common: numTemp("Zone 2 target temperature", 5, 60, 25) },
    { id: "dhwTargetTemp", common: numTemp("DHW target temperature", 30, 75, 45) },
    { id: "roomTargetTemp", common: numTemp("Room target temperature", 5, 35, 22) },
    { id: "silentMode", common: onOff("Silent mode") },
    { id: "silentLevel", common: enumState("Silent level", { off: "off", silent: "silent", super_silent: "super_silent" }, "off") },
    { id: "ecoMode", common: onOff("Eco mode") },
    { id: "disinfect", common: onOff("Disinfect") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const WASHER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "start", common: onOff("Start / pause") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const ELECTRIC_HEATER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "mode", common: numLevel("Mode (raw)", 0, 5, 0) },
    { id: "heatingLevel", common: numLevel("Heating level", 0, 10, 0) },
    { id: "targetTemperature", common: numTemp("Target temperature", 5, 35, 22) },
    { id: "childLock", common: onOff("Child lock") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const GAS_BOILER_CONTROLS = [
    { id: "mainPower", common: power() },
    { id: "heatingPower", common: onOff("Heating power") },
    { id: "heatingTemperature", common: numTemp("Heating temperature", 30, 80, 60) },
    { id: "bathingTemperature", common: numTemp("Bathing temperature", 35, 60, 45) },
    { id: "coldWaterSingle", common: onOff("Cold water single") },
    { id: "coldWaterDot", common: onOff("Cold water dot") },
    { id: "heatingMode", common: enumState("Heating mode", { normal_mode: "normal_mode", out_mode: "out_mode", home_mode: "home_mode", sleep_mode: "sleep_mode" }, "normal_mode") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const GAS_WATER_HEATER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "targetTemperature", common: numTemp("Target temperature", 35, 75, 45) },
    { id: "zeroColdWater", common: onOff("Zero cold water") },
    { id: "zeroColdPulse", common: onOff("Zero cold pulse") },
    { id: "smartVolume", common: onOff("Smart volume") },
    { id: "protection", common: onOff("Protection") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const ELECTRIC_WATER_HEATER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "targetTemperature", common: numTemp("Target temperature", 30, 75, 50) },
    { id: "wholeTankHeating", common: onOff("Whole tank heating") },
    { id: "variableHeating", common: onOff("Variable heating") },
    { id: "protection", common: onOff("Protection") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const DISHWASHER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "mode", common: numLevel("Mode (raw)", 0, 20, 0) },
    { id: "work", common: numLevel("Work command (raw)", 0, 8, 3) },
    { id: "childLock", common: onOff("Child lock") },
    { id: "storage", common: onOff("Storage mode") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const MICROWAVE_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "childLock", common: onOff("Child lock") },
    { id: "workMode", common: numLevel("Work mode (raw)", 0, 30, 0) },
    { id: "workTime", common: numLevel("Work time (s)", 0, 86400, 60, "s") },
    { id: "temperature", common: numTemp("Temperature", 0, 250, 0) },
    { id: "firePower", common: numLevel("Fire power", 0, 100, 0) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const INTEGRATED_OVEN_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "childLock", common: onOff("Child lock") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const RANGE_HOOD_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "fanLevel", common: numLevel("Fan level", 0, 4, 0) },
    { id: "light", common: onOff("Light") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const VACUUM_CONTROLS = [
    { id: "workMode", common: enumState("Work mode", { charge: "charge", work: "work", stop: "stop", pause: "pause" }, "stop") },
    { id: "cleanMode", common: numLevel("Clean mode", 0, 10, 2) },
    { id: "fanLevel", common: numLevel("Fan level", 0, 5, 2) },
    { id: "waterLevel", common: numLevel("Water level", 0, 5, 1) },
    { id: "voiceVolume", common: numLevel("Voice volume", 0, 10, 0) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const SMART_TOILET_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "childLock", common: onOff("Child lock") },
    { id: "sensorLight", common: onOff("Sensor light") },
    { id: "foamShield", common: onOff("Foam shield") },
    { id: "dryLevel", common: numLevel("Dry level", 0, 3, 0) },
    { id: "seatTempLevel", common: numLevel("Seat temperature level", 0, 7, 0) },
    { id: "waterTempLevel", common: numLevel("Water temperature level", 0, 7, 0) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const WATER_PURIFIER_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "childLock", common: onOff("Child lock") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const LIGHT_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "brightness", common: numLevel("Brightness", 0, 255, 128) },
    { id: "colorTemperature", common: numLevel("Color temperature", 0, 255, 128) },
    { id: "effect", common: numLevel("Effect (1..5)", 1, 5, 1) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const BATHROOM_HEATER_CONTROLS = [
    { id: "mainLight", common: onOff("Main light") },
    { id: "nightLight", common: onOff("Night light") },
    { id: "mode", common: enumState("Mode", { 0: "off", 1: "heat_high", 2: "heat_low", 3: "bath", 4: "blow", 5: "ventilation", 6: "dry" }, "0") },
    { id: "direction", common: numLevel("Direction (0xFD = oscillate)", 0, 255, 253) },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const DISHWASHER_X34_CONTROLS = [
    { id: "powerOn", common: power() },
    { id: "childLock", common: onOff("Child lock") },
];

/** @type {Array<{id: string, common: ioBroker.StateCommon}>} */
const BATHROOM_FAN_CONTROLS = [
    { id: "light", common: onOff("Light") },
    { id: "fanSpeed", common: numLevel("Fan speed (0..2)", 0, 2, 0) },
    { id: "ventilation", common: onOff("Ventilation") },
    { id: "smellySensor", common: onOff("Smelly sensor") },
];

const APPLIANCE = midea.APPLIANCE_TYPE;
const TYPED_CONTROLS = {
    [APPLIANCE.AC]: AC_CONTROLS,
    [APPLIANCE.COMMERCIAL_AC]: AC_CONTROLS,
    [APPLIANCE.DEHUMIDIFIER]: DEHUMIDIFIER_CONTROLS,
    [APPLIANCE.FAN]: FAN_CONTROLS,
    [APPLIANCE.PURIFIER]: PURIFIER_CONTROLS,
    [APPLIANCE.HUMIDIFIER]: HUMIDIFIER_CONTROLS,
    [APPLIANCE.FRESH_AIR]: FRESH_AIR_CONTROLS,
    [APPLIANCE.HEATPUMP]: HEATPUMP_CONTROLS,
    [APPLIANCE.HEAT_PUMP_WATER]: HEAT_PUMP_WATER_CONTROLS,
    [APPLIANCE.HEAT_PUMP_CONTROLLER]: HEAT_PUMP_CTRL_CONTROLS,
    [APPLIANCE.TOP_LOAD_WASHER]: WASHER_CONTROLS,
    [APPLIANCE.FRONT_LOAD_WASHER]: WASHER_CONTROLS,
    [APPLIANCE.DRYER]: WASHER_CONTROLS,
    [APPLIANCE.ELECTRIC_HEATER]: ELECTRIC_HEATER_CONTROLS,
    [APPLIANCE.GAS_BOILER]: GAS_BOILER_CONTROLS,
    [APPLIANCE.GAS_WATER_HEATER]: GAS_WATER_HEATER_CONTROLS,
    [APPLIANCE.ELECTRIC_WATER_HEATER]: ELECTRIC_WATER_HEATER_CONTROLS,
    [APPLIANCE.DISHWASHER]: DISHWASHER_CONTROLS,
    [APPLIANCE.MICROWAVE]: MICROWAVE_CONTROLS,
    [APPLIANCE.INTEGRATED_OVEN]: INTEGRATED_OVEN_CONTROLS,
    [APPLIANCE.RANGE_HOOD]: RANGE_HOOD_CONTROLS,
    [APPLIANCE.VACUUM]: VACUUM_CONTROLS,
    [APPLIANCE.SMART_TOILET]: SMART_TOILET_CONTROLS,
    [APPLIANCE.WATER_PURIFIER]: WATER_PURIFIER_CONTROLS,
    [APPLIANCE.LIGHT]: LIGHT_CONTROLS,
    [APPLIANCE.BATHROOM_HEATER]: BATHROOM_HEATER_CONTROLS,
    [APPLIANCE.DISHWASHER_X34]: DISHWASHER_X34_CONTROLS,
    [APPLIANCE.BATHROOM_FAN]: BATHROOM_FAN_CONTROLS,
};

class MideaAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: "midea" });
        /** @type {Map<string, any>} */
        this.devices = new Map();
        /** @type {Map<string, any>} */
        this.descriptors = new Map();
        /**
         * Cloud-listed appliances keyed by id. Populated on each discovery
         * cycle so onStateChange can produce an actionable warning when the
         * user writes to a control whose device is not currently registered.
         * @type {Map<string, {name?: string, type?: number, online?: boolean}>}
         */
        this.cloudAppliances = new Map();
        /**
         * Last LAN-discovered host per device id. Populated on every
         * runDiscoveryCycle() and consulted by onMessage("refreshDeviceList")
         * so the admin form can merge live LAN data into the device table.
         * @type {Map<string, string>}
         */
        this.lastLanHosts = new Map();
        /**
         * Serialises midea.discover() calls. The discovery cycle and the
         * admin "Refresh devices" handler both probe the LAN; running them
         * concurrently leaves device replies arriving on whichever UDP
         * socket happens to win the race, so each side ends up with an
         * incomplete list. We chain new calls onto this promise so they
         * run back to back instead of in parallel.
         * @type {Promise<any>}
         */
        this.discoverChain = Promise.resolve();
        /** @type {midea.CloudClient|null} */
        this.cloud = null;
        this.pollTimer = null;
        this.shuttingDown = false;
        this.json2iob = new Json2iob(this);
        this.pollIntervalMs = 30 * 1000;

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.deleteLegacyTree();
        await this.setStateAsync("info.connection", false, true);

        if (!this.config.user || !this.config.password) {
            this.log.error("Midea cloud credentials missing — please configure user and password in adapter settings.");
            return;
        }

        const intervalSec = Math.max(5, Math.min(3600, Number(this.config.interval) || 30));
        this.pollIntervalMs = intervalSec * 1000;
        this.log.debug(`Midea adapter starting up, poll interval=${intervalSec} s`);

        this.cloud = midea.createCloudClient({
            app: this.config.cloudApp || "msmarthome",
            user: this.config.user,
            password: this.config.password,
            logger: this.log,
        });

        try {
            await this.runDiscoveryCycle();
        } catch (err) {
            this.log.error(`Initial discovery failed: ${errMessage(err)}`);
        }

        await this.subscribeStatesAsync("*.control.*");
        this.schedulePoll();
    }

    /**
     * One-shot cleanup of the pre-1.4.0 object tree. The 1.4.0 layout drops
     * the `devices.<id>` prefix and renames `controls` to `control`, so any
     * leftover state from older versions would just sit there as orphans.
     * We delete every top-level object under the instance and recreate the
     * `info` channel from scratch so runDiscoveryCycle() builds the new
     * layout cleanly.
     */
    async deleteLegacyTree() {
        const flag = await this.getStateAsync("info.migrationV1");
        if (flag && flag.val === true) return;

        const all = await this.getAdapterObjectsAsync();
        const ns = `${this.namespace}.`;
        const topLevel = new Set();
        let hasLegacy = false;
        for (const fullId of Object.keys(all)) {
            if (!fullId.startsWith(ns)) continue;
            const top = fullId.slice(ns.length).split(".")[0];
            if (!top) continue;
            topLevel.add(top);
            // Pre-1.4.0 layout had a top-level `devices` channel containing
            // every appliance. Anything else (`info`, the new top-level device
            // ids) is current. Without that marker we're a fresh install and
            // skip the cleanup entirely.
            if (top === "devices") hasLegacy = true;
        }
        if (!hasLegacy) {
            await this.setStateAsync("info.migrationV1", true, true);
            return;
        }

        this.log.info("Clearing pre-1.4.0 object tree");
        for (const top of topLevel) {
            try {
                await this.delObjectAsync(top, { recursive: true });
            } catch (err) {
                this.log.warn(`Could not delete ${top}: ${errMessage(err)}`);
            }
        }

        await this.setObjectNotExistsAsync("info", {
            type: "channel",
            common: { name: "Information" },
            native: {},
        });
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                role: "indicator.connected",
                name: "Device or service connected",
                type: "boolean",
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync("info.migrationV1", {
            type: "state",
            common: {
                role: "indicator",
                name: "Legacy state cleanup completed",
                type: "boolean",
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        await this.setStateAsync("info.connection", false, true);
        await this.setStateAsync("info.migrationV1", true, true);
        this.log.info(`Cleanup complete (${topLevel.size} top-level item(s) cleared)`);
    }

    /**
     * Run a midea.discover() call serialised against any other discover
     * already in flight on this adapter instance. Avoids the UDP-socket
     * race between runDiscoveryCycle and the refreshDeviceList handler.
     *
     * @param {object} opts
     */
    async serialDiscover(opts) {
        const next = this.discoverChain.then(
            () => midea.discover(opts),
            () => midea.discover(opts), // ignore prior failure, still run ours
        );
        // Hold the chain on `next` (swallowing rejections) so the chain
        // never short-circuits on a failure.
        this.discoverChain = next.catch(() => undefined);
        return next;
    }

    schedulePoll() {
        if (this.shuttingDown) return;
        this.pollTimer = setTimeout(() => {
            this.pollAllDevices()
                .catch((err) => this.log.warn(`Polling cycle failed: ${errMessage(err)}`))
                .finally(() => this.schedulePoll());
        }, this.pollIntervalMs);
    }

    async runDiscoveryCycle() {
        const cloud = this.cloud;
        const cloudByIdName = new Map();
        let cloudList = null;
        if (cloud) {
            try {
                cloudList = await cloud.listAppliances();
                await this.setStateAsync("info.connection", true, true);
                this.cloudAppliances.clear();
                for (const item of cloudList) {
                    if (item.name) cloudByIdName.set(item.id, item.name);
                    this.cloudAppliances.set(item.id, {
                        name: item.name,
                        type: item.type,
                        online: item.online,
                    });
                }
                this.log.info(`Cloud listing: ${cloudList.length} appliance(s)`);
                for (const item of cloudList) {
                    const typeHex = `0x${Number(item.type || 0).toString(16)}`;
                    this.log.debug(`  cloud: id=${item.id} name="${item.name || ""}" type=${typeHex} online=${item.online}`);
                }
            } catch (err) {
                this.log.warn(`Cloud listAppliances failed: ${errMessage(err)}`);
                await this.setStateAsync("info.connection", false, true);
            }
        }

        let broadcastTargets = [];
        try { broadcastTargets = midea.enumerateBroadcastTargets(); } catch (_e) { /* swallow */ }
        this.log.debug(`LAN discovery: broadcasting to [${broadcastTargets.join(", ")}] on UDP/6445+20086`);

        const deviceListCfg = /** @type {Array<{id?: string, name?: string, host?: string, token?: string, key?: string}>} */ (
            Array.isArray(this.config.deviceList) ? this.config.deviceList : []
        );
        const staticIps = [];
        for (const entry of deviceListCfg) {
            const host = String((entry && entry.host) || "").trim();
            if (host) staticIps.push(host);
        }
        if (staticIps.length) {
            this.log.info(`LAN discovery: also unicast-probing configured device IPs [${staticIps.join(", ")}]`);
        }

        const discoveryTargets = [...new Set([...broadcastTargets, ...staticIps])];
        const lanDevices = await this.serialDiscover({ targets: discoveryTargets, logger: this.log });
        // Upsert only — a 0-result blip should not wipe IPs we learned
        // earlier and that the admin refresh handler relies on.
        for (const desc of lanDevices) {
            if (desc.id && desc.host) this.lastLanHosts.set(String(desc.id), String(desc.host));
        }
        if (lanDevices.length === 0) {
            this.log.warn(
                "LAN discovery found 0 appliance(s) — your ioBroker host is not on the same broadcast domain as the appliance, or UDP 6445 is firewalled. Across VLANs you need a UDP broadcast relay (e.g. udpbroadcastrelay).",
            );
        } else {
            this.log.info(`LAN discovery found ${lanDevices.length} appliance(s)`);
        }
        for (const desc of lanDevices) {
            const typeHex = `0x${Number(desc.applianceType || 0).toString(16)}`;
            this.log.debug(`  lan: id=${desc.id} host=${desc.host} port=${desc.port} type=${typeHex} (${desc.applianceTypeName}) protocol=${desc.protocol}`);
        }

        for (const desc of lanDevices) {
            const cloudName = cloudByIdName.get(desc.id);
            if (cloudName) desc.name = cloudName;
            try {
                await this.registerDevice(desc);
            } catch (err) {
                this.log.warn(`Could not initialise device ${desc.id}: ${errMessage(err)}`);
            }
        }

        if (cloudList) {
            for (const item of cloudList) {
                if (this.descriptors.has(item.id)) continue;
                this.log.warn(`Appliance ${item.id} (${item.name}) is bound to the cloud account but did not respond to LAN discovery — control requires a local broadcast domain, or UDP/6445 is firewalled.`);
            }
        }

        // Reconciliation summary so the user can see at a glance what is in
        // the cloud, what is on the LAN, and which IDs differ. Helps diagnose
        // "unknown/unregistered device" warnings later.
        const lanIds = new Set(lanDevices.map((d) => d.id));
        const cloudIds = new Set((cloudList || []).map((c) => c.id));
        const both = [...cloudIds].filter((id) => lanIds.has(id));
        const cloudOnly = [...cloudIds].filter((id) => !lanIds.has(id));
        const lanOnly = [...lanIds].filter((id) => !cloudIds.has(id));
        const cloudOnlyNote = cloudOnly.length ? ` cloud-only=[${cloudOnly.join(", ")}]` : "";
        const lanOnlyNote = lanOnly.length ? ` lan-only=[${lanOnly.join(", ")}]` : "";
        this.log.info(`Discovery summary: cloud=${cloudIds.size}, lan=${lanIds.size}, both=${both.length}, registered=${this.devices.size}${cloudOnlyNote}${lanOnlyNote}`);
    }

    /**
     * Look up a device-list row in the admin config by id and return the
     * {token, key} the user has typed in there, if both are non-empty. Used
     * to override the cloud-fetched token+key for V3 handshake (escape hatch
     * when the cloud's token doesn't authenticate, e.g. paste msmart-ng's).
     *
     * @param {string|number} id
     * @returns {{token?: string, key?: string} | null}
     */
    findDeviceListOverride(id) {
        const list = /** @type {Array<{id?: string, token?: string, key?: string}>} */ (
            Array.isArray(this.config.deviceList) ? this.config.deviceList : []
        );
        const idStr = String(id);
        const row = list.find((r) => r && String(r.id || "") === idStr);
        if (!row) return null;
        const token = typeof row.token === "string" ? row.token.trim() : "";
        const key = typeof row.key === "string" ? row.key.trim() : "";
        if (!token || !key) return null;
        return { token, key };
    }

    /** @param {any} descriptor */
    async registerDevice(descriptor) {
        this.descriptors.set(descriptor.id, descriptor);
        this.log.debug(
            `registerDevice: id=${descriptor.id} host=${descriptor.host} type=0x${Number(descriptor.applianceType || 0).toString(16)} (${descriptor.applianceTypeName}) protocol=${descriptor.protocol}`,
        );

        await this.createDeviceShell(descriptor);
        await this.publishDescriptor(descriptor);

        const controls = TYPED_CONTROLS[descriptor.applianceType];
        if (!controls) {
            this.log.info(`Device ${descriptor.id} (${descriptor.applianceTypeName}) registered as metadata only — no control surface implemented for type 0x${descriptor.applianceType.toString(16)}.`);
            return;
        }

        let token;
        let key;
        if (descriptor.protocol === 3) {
            const override = this.findDeviceListOverride(descriptor.id);
            if (override && override.token && override.key) {
                token = override.token;
                key = override.key;
                this.log.info(`Device ${descriptor.id}: using token/key from device list (admin override, token=${token.slice(0, 8)}…)`);
            } else {
                try {
                    if (!this.cloud) throw new Error("cloud client not initialised");
                    ({ token, key } = await this.cloud.getToken(descriptor.id));
                } catch (err) {
                    this.log.warn(
                        `Could not fetch token/key for ${descriptor.id}: ${errMessage(err)} — the device is offline in the cloud account, or the credentials in the adapter config are wrong.`,
                    );
                    return;
                }
                this.log.debug(`Device ${descriptor.id}: token/key fetched (token=${token.slice(0, 8)}…)`);
            }
        } else {
            this.log.debug(`Device ${descriptor.id}: protocol=${descriptor.protocol}, skipping cloud token fetch (no auth required for V1/V2 LAN).`);
        }

        const device = midea.createDevice(descriptor, {
            token,
            key,
            logger: this.log,
        });
        // TYPED_CONTROLS check above already returned non-null, so this device has a
        // declared control surface; we wire it up.

        this.devices.set(descriptor.id, device);

        device.on("status", (changes) => {
            this.publishStatus(descriptor.id, changes).catch((err) =>
                this.log.warn(`State write for ${descriptor.id} failed: ${errMessage(err)}`),
            );
        });
        device.on("capabilities", (caps) => {
            this.publishCapabilities(descriptor.id, caps).catch((err) =>
                this.log.warn(`Capability write for ${descriptor.id} failed: ${errMessage(err)}`),
            );
        });

        try {
            await device.refreshCapabilities();
        } catch (err) {
            this.log.warn(`refreshCapabilities for ${descriptor.id} failed: ${errMessage(err)}`);
        }
        try {
            await device.refreshStatus();
        } catch (err) {
            this.log.warn(`refreshStatus for ${descriptor.id} failed: ${errMessage(err)}`);
        }
        if (device instanceof ACDevice) {
            try {
                await device.refreshPowerUsage();
            } catch (err) {
                this.log.debug(`refreshPowerUsage for ${descriptor.id} failed (not all units support it): ${errMessage(err)}`);
            }
            try {
                await device.refreshOperatingTime();
            } catch (err) {
                this.log.debug(`refreshOperatingTime for ${descriptor.id} failed: ${errMessage(err)}`);
            }
            try {
                await device.refreshHumidity();
            } catch (err) {
                this.log.debug(`refreshHumidity for ${descriptor.id} failed: ${errMessage(err)}`);
            }
            try {
                await device.refreshNewProtocol();
            } catch (err) {
                this.log.debug(`refreshNewProtocol for ${descriptor.id} failed: ${errMessage(err)}`);
            }
        }
        await this.setStateAsync(`${descriptor.id}.info.online`, device.online, true);
    }

    /** @param {any} descriptor */
    async createDeviceShell(descriptor) {
        const root = `${descriptor.id}`;
        await this.setObjectNotExistsAsync(root, {
            type: "device",
            common: { name: descriptor.name || descriptor.id },
            native: {},
        });
        for (const sub of ["info", "control", "status", "capabilities"]) {
            await this.setObjectNotExistsAsync(`${root}.${sub}`, {
                type: "channel",
                common: { name: sub },
                native: {},
            });
        }

        const controls = TYPED_CONTROLS[descriptor.applianceType];
        if (!controls) return;
        for (const def of controls) {
            await this.setObjectNotExistsAsync(`${root}.control.${def.id}`, {
                type: "state",
                common: def.common,
                native: {},
            });
        }
    }

    /** @param {any} descriptor */
    async publishDescriptor(descriptor) {
        await this.json2iob.parse(`${descriptor.id}.info`, { ...descriptor, online: false }, {
            descriptions: {
                id: "Device ID",
                name: "Device name",
                host: "LAN address",
                port: "LAN port",
                macAddress: "MAC address",
                ssid: "WiFi SSID",
                applianceType: "Appliance type (hex)",
                applianceTypeName: "Appliance type (name)",
                applianceSubType: "Appliance sub-type",
                firmwareVersion: "Firmware",
                sn: "Serial number",
                online: "Online",
                protocol: "LAN protocol (1, 2 or 3)",
                v3: "V3 protocol",
                udpId: "UDP ID (cloud token lookup)",
            },
            channelName: "Device info",
            write: false,
        });
    }

    /**
     * Publish a status diff coming from the device. Filters internal
     * helper keys (prefixed with _) and keeps the controls in sync so the
     * UI reflects what the device actually accepted.
     *
     * @param {string} deviceId
     * @param {Record<string, any>} changes
     */
    async publishStatus(deviceId, changes) {
        const filtered = {};
        for (const [k, v] of Object.entries(changes)) {
            if (k.startsWith("_")) continue;
            filtered[k] = v;
        }
        if (!Object.keys(filtered).length) return;

        this.log.debug(`Device ${deviceId}: publishStatus ${JSON.stringify(filtered)}`);

        await this.json2iob.parse(`${deviceId}.status`, filtered, {
            descriptions: STATUS_DESCRIPTIONS,
            states: STATUS_STATE_ENUMS,
            units: STATUS_UNITS,
            write: false,
            channelName: "Status",
        });

        const descriptor = this.descriptors.get(deviceId);
        if (!descriptor) return;
        const controls = TYPED_CONTROLS[descriptor.applianceType];
        if (!controls) return;
        for (const def of controls) {
            if (!(def.id in changes)) continue;
            if (def.common.read === false) continue;
            let v = changes[def.id];
            if (v === undefined || v === null) continue;
            if (def.id === "temperatureUnit") {
                v = v === 1 || v === "fahrenheit" ? "fahrenheit" : "celsius";
            } else if (def.common.type === "boolean") {
                v = !!v;
            } else if (def.common.type === "number") {
                v = Number(v);
                if (Number.isNaN(v)) continue;
            } else {
                v = String(v);
            }
            await this.setStateAsync(`${deviceId}.control.${def.id}`, v, true);
        }
    }

    /**
     * @param {string} deviceId
     * @param {Record<string, any>} caps
     */
    async publishCapabilities(deviceId, caps) {
        this.log.debug(`Device ${deviceId}: publishCapabilities (${Object.keys(caps).length} flags)`);
        await this.json2iob.parse(`${deviceId}.capabilities`, caps, {
            descriptions: CAPABILITY_DESCRIPTIONS,
            write: false,
            channelName: "Capabilities",
        });
    }

    async pollAllDevices() {
        for (const [id, device] of this.devices) {
            try {
                await device.refreshStatus();
            } catch (err) {
                this.log.debug(`refreshStatus(${id}) failed: ${errMessage(err)}`);
            }
            if (device instanceof ACDevice) {
                try {
                    await device.refreshPowerUsage();
                } catch (err) {
                    this.log.silly(`refreshPowerUsage(${id}) failed: ${errMessage(err)}`);
                }
                try {
                    await device.refreshOperatingTime();
                } catch (err) {
                    this.log.silly(`refreshOperatingTime(${id}) failed: ${errMessage(err)}`);
                }
                try {
                    await device.refreshHumidity();
                } catch (err) {
                    this.log.silly(`refreshHumidity(${id}) failed: ${errMessage(err)}`);
                }
                try {
                    await device.refreshNewProtocol();
                } catch (err) {
                    this.log.silly(`refreshNewProtocol(${id}) failed: ${errMessage(err)}`);
                }
            }
            await this.setStateAsync(`${id}.info.online`, device.online, true);
            await this.setStateAsync(`${id}.status.online`, device.online, true);
        }
    }

    /**
     * Compose an actionable warning when a control write hits a deviceId
     * that has no live device instance. We distinguish the three causes the
     * user can actually act on:
     *   1) cloud-known but offline / not on the LAN this cycle
     *   2) cloud-known but its appliance type has no control surface here
     *   3) orphan: the deviceId matches no current cloud or LAN appliance,
     *      so the state object is leftover from a previous configuration
     *      and should be removed (or the device re-paired).
     * @param {string} deviceId
     * @param {string} control
     * @returns {string}
     */
    _describeUnregisteredDevice(deviceId, control) {
        const cloudInfo = this.cloudAppliances.get(deviceId);
        const descriptor = this.descriptors.get(deviceId);
        const label = cloudInfo && cloudInfo.name
            ? `${deviceId} (${cloudInfo.name})`
            : deviceId;

        if (descriptor) {
            // registerDevice was reached but devices.set never ran — typically
            // an unsupported applianceType or a token-fetch failure earlier.
            const typeHex = `0x${Number(descriptor.applianceType || 0).toString(16)}`;
            const hostNote = descriptor.host ? ` at ${descriptor.host}` : "";
            return `Control ${control} ignored: device ${label}${hostNote} (${descriptor.applianceTypeName || "unknown"}, type ${typeHex}) was discovered but has no control surface or its token/key fetch failed — check earlier log lines for this device.`;
        }
        if (cloudInfo) {
            // List the broadcast targets we are actually using so the user can
            // compare with the appliance's known subnet (the typical cause of
            // this warning is a host on a different /24 than the appliance).
            let broadcasts = [];
            try { broadcasts = midea.enumerateBroadcastTargets(); } catch (_e) { /* swallow */ }
            const broadcastNote = broadcasts.length
                ? ` ioBroker is broadcasting to [${broadcasts.join(", ")}] on UDP/6445 — make sure one of these covers the appliance's subnet.`
                : "";
            const onlineNote = cloudInfo.online === false
                ? "the cloud reports it offline"
                : "it did not respond to LAN discovery (different broadcast domain or UDP/6445 firewalled)";
            return `Control ${control} ignored: device ${label} is in your cloud account but currently unreachable on the LAN — ${onlineNote}.${broadcastNote} Power-cycle the appliance or fix the network path, then restart the adapter.`;
        }
        return `Control ${control} ignored: device ${deviceId} is not in your Midea cloud account and was not discovered on the LAN. The state object is most likely a leftover from a previous configuration — delete it under objects ${this.namespace}.${deviceId}, or re-pair the appliance in the Midea app.`;
    }

    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const m = id.match(/\.([^.]+)\.control\.([^.]+)$/);
        if (!m) return;

        const deviceId = m[1];
        const control = m[2];
        const device = this.devices.get(deviceId);
        if (!device) {
            this.log.debug(
                `onStateChange: deviceId=${deviceId} control=${control} not in devices map. ` +
                `devices=[${[...this.devices.keys()].join(",")}], ` +
                `descriptors=[${[...this.descriptors.keys()].join(",")}], ` +
                `cloud=[${[...this.cloudAppliances.keys()].join(",")}]`,
            );
            this.log.warn(this._describeUnregisteredDevice(deviceId, control));
            return;
        }

        this.log.debug(`Device ${deviceId}: control change ${control}=${state.val}`);

        if (control === "toggleDisplay") {
            if (!(device instanceof ACDevice)) {
                this.log.warn(`toggleDisplay is only supported on AC devices (${deviceId})`);
                return;
            }
            try {
                await device.toggleDisplay();
            } catch (err) {
                this.log.error(`toggleDisplay(${deviceId}) failed: ${errMessage(err)}`);
            }
            return;
        }

        const update = {};
        const descriptor = this.descriptors.get(deviceId);
        const defs = descriptor ? TYPED_CONTROLS[descriptor.applianceType] : null;
        const def = defs ? defs.find((d) => d.id === control) : null;
        if (!def) {
            this.log.warn(`Unhandled control ${control} for device ${deviceId}`);
            return;
        }
        const t = def.common.type;
        let v;
        if (t === "boolean") v = !!state.val;
        else if (t === "number") v = Number(state.val);
        else v = String(state.val);

        // Some controls expose a friendly "*Name" alias for what the device-side
        // setter accepts under the unsuffixed key (fanSpeed accepts the string,
        // screenDisplay accepts the string).
        const RENAME = { fanSpeedName: "fanSpeed", screenDisplayName: "screenDisplay" };
        update[RENAME[control] || control] = v;

        try {
            await device.setStatus(update);
        } catch (err) {
            this.log.error(`setStatus(${deviceId}, ${control}=${state.val}) failed: ${errMessage(err)}`);
        }
    }

    /**
     * Admin UI message handler.
     *
     * Currently the only command is `refreshDeviceList`, fired by the
     * "Refresh devices" button in jsonConfig. The handler logs in to the
     * cloud (using either the form values from `obj.message` or the saved
     * config), runs an ad-hoc LAN discovery, and merges the two lists into
     * a `deviceList` array of `{id, name, host}` rows. With `useNative` on
     * the button, admin merges the returned `native.deviceList` into the
     * form so the user sees IPs filled in for everything LAN discovery
     * reached, and blank rows for cloud-only appliances they need to type
     * IPs for.
     *
     * @param {ioBroker.Message} obj
     */
    async onMessage(obj) {
        if (!obj || obj.command !== "refreshDeviceList") return;

        const formCfg = /** @type {{cloudApp?: string, user?: string, password?: string, deviceList?: Array<{id?: string, name?: string, host?: string, token?: string, key?: string}>}} */ (
            obj.message && typeof obj.message === "object" ? obj.message : {}
        );
        const cloudApp = String(formCfg.cloudApp || this.config.cloudApp || "msmarthome");
        const user = String(formCfg.user || this.config.user || "");
        const password = String(formCfg.password || this.config.password || "");
        const existing = Array.isArray(formCfg.deviceList)
            ? formCfg.deviceList
            : (Array.isArray(this.config.deviceList) ? this.config.deviceList : []);
        /** @type {Map<string, {host: string, token: string, key: string, name: string}>} */
        const existingById = new Map();
        for (const row of existing) {
            const id = String((row && row.id) || "").trim();
            if (!id) continue;
            existingById.set(id, {
                host: String((row && row.host) || "").trim(),
                token: String((row && row.token) || "").trim(),
                key: String((row && row.key) || "").trim(),
                name: String((row && row.name) || ""),
            });
        }

        /** @type {Array<{id: string, name: string, host: string, token: string, key: string}>} */
        const merged = [];
        const seen = new Set();
        let cloudErr = null;
        let cloudCount = 0;

        // Cloud side. Failure is logged but does not abort the LAN side.
        if (user && password) {
            try {
                const tmpCloud = midea.createCloudClient({
                    app: cloudApp,
                    user,
                    password,
                    logger: this.log,
                });
                const list = await tmpCloud.listAppliances();
                cloudCount = list.length;
                for (const item of list) {
                    const id = String(item.id);
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    const prev = existingById.get(id);
                    merged.push({
                        id,
                        name: String(item.name || ""),
                        host: this.lastLanHosts.get(id) || (prev && prev.host) || "",
                        token: (prev && prev.token) || "",
                        key: (prev && prev.key) || "",
                    });
                }
            } catch (err) {
                cloudErr = errMessage(err);
                this.log.warn(`refreshDeviceList: cloud listAppliances failed: ${cloudErr}`);
            }
        } else {
            this.log.info("refreshDeviceList: no cloud credentials provided, skipping cloud lookup");
        }

        // LAN side — fresh one-shot discovery so the table reflects what
        // is reachable right now, even if the adapter has not yet run a
        // discovery cycle since startup.
        let lanDevices = [];
        try {
            let broadcastTargets = [];
            try { broadcastTargets = midea.enumerateBroadcastTargets(); } catch (_e) { /* swallow */ }
            const staticIps = [];
            for (const row of existing) {
                const h = String((row && row.host) || "").trim();
                if (h) staticIps.push(h);
            }
            const targets = [...new Set([...broadcastTargets, ...staticIps])];
            lanDevices = await this.serialDiscover({ targets, logger: this.log });
        } catch (err) {
            this.log.warn(`refreshDeviceList: LAN discovery failed: ${errMessage(err)}`);
        }
        for (const desc of lanDevices) {
            const id = String(desc.id);
            if (!id) continue;
            if (desc.host) this.lastLanHosts.set(id, String(desc.host));
            if (seen.has(id)) {
                // Backfill host on cloud row if discovery returned one.
                if (desc.host) {
                    const row = merged.find((r) => r.id === id);
                    if (row && !row.host) row.host = String(desc.host);
                }
                continue;
            }
            seen.add(id);
            const prev = existingById.get(id);
            merged.push({
                id,
                name: "(LAN-only)",
                host: String(desc.host || ""),
                token: (prev && prev.token) || "",
                key: (prev && prev.key) || "",
            });
        }

        // Carry over user-typed IPs for ids that neither cloud nor LAN
        // returned this round, so manual edits aren't silently dropped.
        for (const row of existing) {
            const id = String((row && row.id) || "").trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            merged.push({
                id,
                name: String((row && row.name) || ""),
                host: String((row && row.host) || ""),
                token: String((row && row.token) || ""),
                key: String((row && row.key) || ""),
            });
        }

        merged.sort((a, b) => a.id.localeCompare(b.id));

        this.log.info(`refreshDeviceList: returning ${merged.length} device(s) (cloud${cloudErr ? " failed" : ""}=${cloudCount}, lan=${lanDevices.length})`);

        const toast = await this.buildRefreshToast(merged.length, cloudCount, lanDevices.length, cloudErr);

        if (obj.callback) {
            /** @type {{native: {deviceList: typeof merged}, result?: string, error?: string}} */
            const response = { native: { deviceList: merged } };
            if (toast.error) response.error = toast.error;
            else response.result = toast.result;
            this.sendTo(obj.from, obj.command, response, obj.callback);
        }
    }

    /**
     * Build the toast string returned to admin after refreshDeviceList.
     * Picks a language from system.config and falls back to English. Returns
     * `{error}` when no devices were found AND the cloud login failed
     * (red toast), otherwise `{result}` (green toast).
     *
     * @param {number} total
     * @param {number} cloudCount
     * @param {number} lanCount
     * @param {string|null} cloudErr
     */
    async buildRefreshToast(total, cloudCount, lanCount, cloudErr) {
        let lang = "en";
        try {
            const sys = await this.getForeignObjectAsync("system.config");
            if (sys && sys.common && sys.common.language) lang = String(sys.common.language);
        } catch (_e) { /* swallow */ }

        /** @type {(key: "found" | "cloudFailed" | "nothing") => string} */
        const t = (key) => {
            const dict = {
                en: {
                    found: `${total} device(s) found (${cloudCount} from cloud, ${lanCount} on LAN)`,
                    cloudFailed: `cloud login failed`,
                    nothing: `no devices found — check cloud credentials and that ioBroker shares the LAN`,
                },
                de: {
                    found: `${total} Gerät(e) gefunden (${cloudCount} aus Cloud, ${lanCount} im LAN)`,
                    cloudFailed: `Cloud-Login fehlgeschlagen`,
                    nothing: `Keine Geräte gefunden — Cloud-Zugangsdaten prüfen und sicherstellen, dass ioBroker im selben LAN ist`,
                },
                ru: {
                    found: `Найдено устройств: ${total} (из облака: ${cloudCount}, в LAN: ${lanCount})`,
                    cloudFailed: `вход в облако не удался`,
                    nothing: `Устройства не найдены — проверьте учётные данные облака и что ioBroker в той же LAN`,
                },
            };
            return (dict[lang] || dict.en)[key];
        };

        if (total === 0) {
            const reason = cloudErr ? ` (${t("cloudFailed")})` : "";
            return { error: t("nothing") + reason };
        }
        let msg = t("found");
        if (cloudErr) msg += ` — ${t("cloudFailed")}`;
        return { result: msg };
    }

    onUnload(callback) {
        try {
            this.shuttingDown = true;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            for (const device of this.devices.values()) {
                try { device.close(); } catch (_e) { /* swallow */ }
            }
            this.devices.clear();
            callback();
        } catch (_e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new MideaAdapter(options);
} else {
    new MideaAdapter();
}
