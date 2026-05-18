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
    naturalFan: "Natural wind",
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
};

const STATUS_UNITS = {
    temperatureSetpoint: "°C",
    indoorTemperature: "°C",
    outdoorTemperature: "°C",
    humiditySetpoint: "%",
    powerUsage: "kWh",
    onTimerHours: "h",
    offTimerHours: "h",
    onTimerMinutes: "min",
    offTimerMinutes: "min",
};

const STATUS_STATE_ENUMS = {
    mode: { auto: "auto", cool: "cool", dry: "dry", heat: "heat", fanonly: "fanonly", customdry: "customdry", off: "off" },
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
const CONTROLS = [
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
    { id: "toggleDisplay", common: { name: "Toggle indoor unit display", type: "boolean", role: "button", read: false, write: true, def: false } },
];

class MideaAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: "midea" });
        /** @type {Map<string, ACDevice>} */
        this.devices = new Map();
        /** @type {Map<string, any>} */
        this.descriptors = new Map();
        /** @type {midea.CloudClient|null} */
        this.cloud = null;
        this.pollTimer = null;
        this.shuttingDown = false;
        this.json2iob = new Json2iob(this);
        this.pollIntervalMs = 5 * 60 * 1000;

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync("info.connection", false, true);

        if (!this.config.user || !this.config.password) {
            this.log.error("Midea cloud credentials missing — please configure user and password in adapter settings.");
            return;
        }

        const intervalMin = Math.max(1, Number(this.config.interval) || 5);
        this.pollIntervalMs = intervalMin * 60 * 1000;
        this.log.debug(`Midea adapter starting up, poll interval=${intervalMin} min`);

        this.cloud = new midea.CloudClient({
            user: this.config.user,
            password: this.config.password,
            logger: this.log,
        });

        try {
            await this.runDiscoveryCycle();
        } catch (err) {
            this.log.error(`Initial discovery failed: ${errMessage(err)}`);
        }

        await this.subscribeStatesAsync("devices.*.controls.*");
        this.schedulePoll();
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
        const lanDevices = await midea.discover({ logger: this.log });
        this.log.info(`LAN discovery found ${lanDevices.length} appliance(s)`);
        for (const desc of lanDevices) {
            try {
                await this.registerDevice(desc);
            } catch (err) {
                this.log.warn(`Could not initialise device ${desc.id}: ${errMessage(err)}`);
            }
        }

        const cloud = this.cloud;
        if (!cloud) return;
        try {
            const cloudList = await cloud.listAppliances();
            await this.setStateAsync("info.connection", true, true);
            for (const item of cloudList) {
                if (this.descriptors.has(item.id)) continue;
                this.log.warn(`Appliance ${item.id} (${item.name}) is bound to the cloud account but did not respond to LAN discovery — control requires a local broadcast domain.`);
            }
        } catch (err) {
            this.log.warn(`Cloud listAppliances failed: ${errMessage(err)}`);
            await this.setStateAsync("info.connection", false, true);
        }
    }

    /** @param {any} descriptor */
    async registerDevice(descriptor) {
        if (!descriptor.v3) {
            this.log.warn(`Skipping ${descriptor.id} (${descriptor.applianceTypeName}): V2 protocol is not supported by this adapter.`);
            return;
        }

        this.descriptors.set(descriptor.id, descriptor);

        await this.createDeviceShell(descriptor);
        await this.publishDescriptor(descriptor);

        if (descriptor.applianceType !== midea.APPLIANCE_TYPE.AC) {
            this.log.info(`Device ${descriptor.id} (${descriptor.applianceTypeName}) registered as metadata only — control surface only implemented for 0xAC AC.`);
            return;
        }

        let token;
        let key;
        try {
            if (!this.cloud) throw new Error("cloud client not initialised");
            ({ token, key } = await this.cloud.getToken(descriptor.udpId));
        } catch (err) {
            this.log.warn(`Could not fetch token/key for ${descriptor.id}: ${errMessage(err)}`);
            return;
        }
        this.log.debug(`Device ${descriptor.id}: token/key fetched (token=${token.slice(0, 8)}…)`);

        const device = midea.createDevice(descriptor, {
            token,
            key,
            logger: this.log,
        });
        if (!(device instanceof ACDevice)) {
            this.log.warn(`Device ${descriptor.id} did not produce an ACDevice — skipping control wiring.`);
            return;
        }

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
        try {
            await device.refreshPowerUsage();
        } catch (err) {
            this.log.debug(`refreshPowerUsage for ${descriptor.id} failed (not all units support it): ${errMessage(err)}`);
        }
        await this.setStateAsync(`devices.${descriptor.id}.info.online`, device.online, true);
    }

    /** @param {any} descriptor */
    async createDeviceShell(descriptor) {
        const root = `devices.${descriptor.id}`;
        await this.setObjectNotExistsAsync(root, {
            type: "device",
            common: { name: descriptor.name || descriptor.id },
            native: {},
        });
        for (const sub of ["info", "controls", "status", "capabilities"]) {
            await this.setObjectNotExistsAsync(`${root}.${sub}`, {
                type: "channel",
                common: { name: sub },
                native: {},
            });
        }

        if (descriptor.applianceType !== midea.APPLIANCE_TYPE.AC) return;

        for (const def of CONTROLS) {
            await this.setObjectNotExistsAsync(`${root}.controls.${def.id}`, {
                type: "state",
                common: def.common,
                native: {},
            });
        }
    }

    /** @param {any} descriptor */
    async publishDescriptor(descriptor) {
        const info = {
            id: descriptor.id,
            name: descriptor.name,
            host: descriptor.host,
            macAddress: descriptor.macAddress,
            applianceType: descriptor.applianceType,
            applianceTypeName: descriptor.applianceTypeName,
            firmwareVersion: descriptor.firmwareVersion,
            sn: descriptor.sn,
            online: false,
            v3: descriptor.v3,
            applianceSubType: descriptor.applianceSubType,
        };
        await this.json2iob.parse(`devices.${descriptor.id}.info`, info, {
            descriptions: {
                id: "Device ID",
                name: "Device name",
                host: "LAN address",
                macAddress: "MAC address",
                applianceType: "Appliance type (hex)",
                applianceTypeName: "Appliance type (name)",
                firmwareVersion: "Firmware",
                sn: "Serial number",
                online: "Online",
                v3: "V3 protocol",
                applianceSubType: "Appliance sub-type",
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

        await this.json2iob.parse(`devices.${deviceId}.status`, filtered, {
            descriptions: STATUS_DESCRIPTIONS,
            states: STATUS_STATE_ENUMS,
            units: STATUS_UNITS,
            write: false,
            channelName: "Status",
        });

        if (changes.powerOn !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.powerOn`, !!changes.powerOn, true);
        }
        if (changes.mode !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.mode`, changes.mode, true);
        }
        if (changes.temperatureSetpoint !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.temperatureSetpoint`, changes.temperatureSetpoint, true);
        }
        if (changes.fanSpeed !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.fanSpeed`, changes.fanSpeed, true);
        }
        if (changes.fanSpeedName !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.fanSpeedName`, changes.fanSpeedName, true);
        }
        if (changes.swing !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.swing`, changes.swing, true);
        }
        for (const flag of ["ecoMode", "turboMode", "sleepMode", "purify", "dryClean", "frostProtection"]) {
            if (changes[flag] !== undefined) {
                await this.setStateAsync(`devices.${deviceId}.controls.${flag}`, !!changes[flag], true);
            }
        }
        if (changes.temperatureUnit !== undefined) {
            await this.setStateAsync(`devices.${deviceId}.controls.temperatureUnit`, changes.temperatureUnit === 1 ? "fahrenheit" : "celsius", true);
        }
    }

    /**
     * @param {string} deviceId
     * @param {Record<string, any>} caps
     */
    async publishCapabilities(deviceId, caps) {
        this.log.debug(`Device ${deviceId}: publishCapabilities (${Object.keys(caps).length} flags)`);
        await this.json2iob.parse(`devices.${deviceId}.capabilities`, caps, {
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
            try {
                await device.refreshPowerUsage();
            } catch (err) {
                this.log.silly(`refreshPowerUsage(${id}) failed: ${errMessage(err)}`);
            }
            await this.setStateAsync(`devices.${id}.info.online`, device.online, true);
            await this.setStateAsync(`devices.${id}.status.online`, device.online, true);
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const m = id.match(/devices\.([^.]+)\.controls\.([^.]+)$/);
        if (!m) return;

        const deviceId = m[1];
        const control = m[2];
        const device = this.devices.get(deviceId);
        if (!device) {
            this.log.warn(`Control ${control} written for unknown/unregistered device ${deviceId}`);
            return;
        }

        this.log.debug(`Device ${deviceId}: control change ${control}=${state.val}`);

        if (control === "toggleDisplay") {
            try {
                await device.toggleDisplay();
            } catch (err) {
                this.log.error(`toggleDisplay(${deviceId}) failed: ${errMessage(err)}`);
            }
            return;
        }

        const update = {};
        switch (control) {
            case "powerOn":
            case "ecoMode":
            case "turboMode":
            case "sleepMode":
            case "purify":
            case "dryClean":
            case "frostProtection":
                update[control] = !!state.val;
                break;
            case "mode":
            case "temperatureUnit":
            case "swing":
                update[control] = String(state.val);
                break;
            case "temperatureSetpoint":
                update.temperatureSetpoint = Number(state.val);
                break;
            case "fanSpeed":
                update.fanSpeed = Number(state.val);
                break;
            case "fanSpeedName":
                update.fanSpeed = String(state.val);
                break;
            default:
                this.log.warn(`Unhandled control ${control}`);
                return;
        }

        try {
            await device.setStatus(update);
        } catch (err) {
            this.log.error(`setStatus(${deviceId}, ${control}=${state.val}) failed: ${errMessage(err)}`);
        }
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
