"use strict";

const { CloudClient } = require("./cloud");
const { LanClient } = require("./lan");
const { discover, APPLIANCE_TYPES, parseDiscoveryReply } = require("./discover");
const { BaseDevice } = require("./devices/base");
const { ACDevice, APPLIANCE_TYPE_AC, MODE_BY_NAME, MODE_BY_INDEX, FAN_BY_NAME, FAN_NAME_BY_VALUE } = require("./devices/ac");

const APPLIANCE_TYPE = {
    DEHUMIDIFIER: 0xA1,
    AC: 0xAC,
    COMMERCIAL_AC: 0xCC,
    FAN: 0xFA,
    PURIFIER: 0xFC,
    HUMIDIFIER: 0xFD,
};

/**
 * Build the right device subclass for an appliance descriptor returned
 * by discover() or by the cloud listAppliances() call. Devices other
 * than 0xAC fall back to BaseDevice — they will appear in the object
 * tree but expose only LAN credentials, no controls.
 */
function createDevice(descriptor, opts = {}) {
    const merged = { ...descriptor, ...opts };
    if (descriptor.applianceType === APPLIANCE_TYPE.AC || descriptor.type === APPLIANCE_TYPE.AC) {
        return new ACDevice(merged);
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
    discover,
    parseDiscoveryReply,
    createDevice,
};
