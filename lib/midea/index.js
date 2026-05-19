"use strict";

const { CloudClient } = require("./cloud");
const { LanClient } = require("./lan");
const { discover, APPLIANCE_TYPES, parseDiscoveryReply } = require("./discover");
const { BaseDevice } = require("./devices/base");
const { ACDevice, APPLIANCE_TYPE_AC, MODE_BY_NAME, MODE_BY_INDEX, FAN_BY_NAME, FAN_NAME_BY_VALUE } = require("./devices/ac");
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

const APPLIANCE_TYPE = {
    DEHUMIDIFIER: 0xA1,
    AC: 0xAC,
    COMMERCIAL_AC: 0xCC,
    FAN: 0xFA,
    PURIFIER: 0xFC,
    HUMIDIFIER: 0xFD,
};

/**
 * Build the right device subclass for an appliance descriptor returned by
 * discover() or by the cloud listAppliances() call.
 *
 *  - 0xAC residential AC          -> ACDevice (full controls)
 *  - 0xCC commercial AC           -> ACDevice (same UART set/query layout)
 *  - 0xA1 dehumidifier            -> DehumidifierDevice (full controls)
 *  - 0xFA fan                     -> FanDevice (full controls)
 *  - 0xFC purifier                -> PurifierDevice (full controls)
 *  - 0xFD humidifier              -> HumidifierDevice (full controls)
 *  - everything else              -> BaseDevice (metadata only)
 */
function createDevice(descriptor, opts = {}) {
    const merged = { ...descriptor, ...opts };
    const type = descriptor.applianceType ?? descriptor.type;
    if (type === APPLIANCE_TYPE.AC || type === APPLIANCE_TYPE.COMMERCIAL_AC) {
        return new ACDevice(merged);
    }
    if (type === APPLIANCE_TYPE.DEHUMIDIFIER) {
        return new DehumidifierDevice(merged);
    }
    if (type === APPLIANCE_TYPE.FAN) {
        return new FanDevice(merged);
    }
    if (type === APPLIANCE_TYPE.PURIFIER) {
        return new PurifierDevice(merged);
    }
    if (type === APPLIANCE_TYPE.HUMIDIFIER) {
        return new HumidifierDevice(merged);
    }
    return new BaseDevice(merged);
}

module.exports = {
    APPLIANCE_TYPE,
    APPLIANCE_TYPES,
    CloudClient,
    LanClient,
    BaseDevice,
    ACDevice,
    APPLIANCE_TYPE_AC,
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
    discover,
    parseDiscoveryReply,
    createDevice,
};
