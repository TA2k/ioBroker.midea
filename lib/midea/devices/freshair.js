"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_FRESH_AIR = 0xCE;

/**
 * 0xCE fresh-air system. Layout from midea-local devices/ce/message.py:
 *   - Query: body_type=0x01, empty _body, msg_type=0x03.
 *   - Set:   body_type=0x01, 6-byte body, msg_type=0x02.
 */
function parseCEBody(body) {
    if (!body || body.length < 25) return {};
    const out = {};
    out.powerOn = (body[1] & 0x80) > 0;
    out.childLock = (body[1] & 0x20) > 0;
    out.scheduled = (body[1] & 0x40) > 0;
    out.fanSpeed = body[2];
    out.pm25 = (body[3] << 8) + body[4];
    out.co2 = (body[5] << 8) + body[6];
    if (body[7] !== 0xFF) {
        out.currentHumidity = (body[7] << 8) + body[8] / 10;
    }
    if (body[9] !== 0xFF) {
        out.currentTemperature = (body[9] << 8) + (body[10] - 60) / 2;
    }
    if (body[11] !== 0xFF) {
        out.hcho = (body[11] << 8) + body[12] / 1000;
    }
    out.linkToAc = (body[17] & 0x01) > 0;
    out.sleepMode = (body[17] & 0x02) > 0;
    out.ecoMode = (body[17] & 0x04) > 0;
    if ((body[19] & 0x02) > 0) out.auxHeating = (body[17] & 0x08) > 0;
    out.powerfulPurify = (body[17] & 0x10) > 0;
    out.filterCleaningReminder = (body[18] & 0x01) > 0;
    out.filterChangeReminder = (body[18] & 0x02) > 0;
    out.errorCode = body[24];
    return out;
}

class FreshAirDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_FRESH_AIR; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const body = Buffer.from([0x01]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_FRESH_AIR,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        const inner = reply.subarray(10, reply.length - 1);
        this._mergeStatus(parseCEBody(inner));
        return this.status;
    }

    async setStatus(updates = {}) {
        /** @type {Record<string, any>} */
        const s = { ...this.status, ...updates };
        const power = s.powerOn ? 0x80 : 0x00;
        const linkToAc = s.linkToAc ? 0x01 : 0x00;
        const sleepMode = s.sleepMode ? 0x02 : 0x00;
        const ecoMode = s.ecoMode ? 0x04 : 0x00;
        const auxHeating = s.auxHeating ? 0x08 : 0x00;
        const powerfulPurify = s.powerfulPurify ? 0x10 : 0x00;
        const scheduled = s.scheduled ? 0x01 : 0x00;
        const childLock = s.childLock ? 0x7F : 0x00;
        const fanSpeed = (s.fanSpeed || 0) & 0xFF;

        const body = Buffer.from([
            0x01, // body_type
            power | 0x01,
            fanSpeed,
            linkToAc | sleepMode | ecoMode | auxHeating | powerfulPurify,
            scheduled,
            0x00,
            childLock,
        ]);
        const cmd = createCommand(body, {
            msgType: 0x02,
            protocol: 0x03,
            applianceType: APPLIANCE_TYPE_FRESH_AIR,
            addCrc: false,
        });
        const reply = await this._request(cmd, "setStatus");
        try {
            const inner = reply.subarray(10, reply.length - 1);
            this._mergeStatus(parseCEBody(inner));
        } catch (err) {
            this.log.debug(`CE[${this.id}]: setStatus reply parse skipped (${err.message})`);
        }
        return this.status;
    }
}

module.exports = { FreshAirDevice, APPLIANCE_TYPE_FRESH_AIR };
