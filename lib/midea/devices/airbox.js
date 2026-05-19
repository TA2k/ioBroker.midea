"use strict";

const { BaseDevice } = require("./base");
const { createCommand, calculateCrc } = require("../packet");

const APPLIANCE_TYPE_AIR_BOX = 0xAD;

let MSG_SERIAL = 0;
function nextMessageId() {
    MSG_SERIAL = (MSG_SERIAL + 1) % 254;
    if (MSG_SERIAL === 0) MSG_SERIAL = 1;
    return MSG_SERIAL;
}

/**
 * 0xAD air-quality sensor box. Read-only sensor; midea-local sends two
 * queries (body_type 0x21 and 0x31) and merges the responses. Each query
 * has body = [body_type, 0x01, message_id, crc8] (CRC8 is added inside the
 * body before the 0xAA framework wraps it).
 */
function buildADQuery(bodyType) {
    const body = Buffer.from([bodyType, 0x01, nextMessageId()]);
    const crc = calculateCrc(body);
    return Buffer.concat([body, Buffer.from([crc])]);
}

function parseAD21(body) {
    const out = {};
    if (!body || body.length < 5) return out;
    out.portableSense = body[2] > 0;
    out.nightMode = body[3] > 0;
    if (body[4] !== 0xFF) out.screenExtinctionTimeout = body[4];
    return out;
}

function parseAD31(body) {
    const out = {};
    if (!body || body.length < 16) return out;
    if (body[2] !== 0xFF) out.screenStatus = body[2] > 0;
    if (body[3] !== 0xFF) out.ledStatus = body[3] > 0;
    if (body[4] !== 0xFF) out.arofeneLink = body[4] > 0;
    if (body[5] !== 0xFF) out.headerExist = body[5] > 0;
    if (body[6] !== 0xFF) out.radarExist = body[6] > 0;
    if (body[7] !== 0xFF) out.headerLedStatus = body[7] > 0;
    if (body[8] !== 0xFF) out.temperatureRaw = (body[8] << 8) + body[9];
    if (body[10] !== 0xFF) out.humidityRaw = (body[10] << 8) + body[11];
    if (body[1] > 0x0D) {
        out.temperatureCompensate = (body[12] << 8) + body[13];
        out.humidityCompensate = (body[14] << 8) + body[15];
    }
    return out;
}

function parseAD11Notify(body) {
    const out = {};
    if (!body || body.length < 17) return out;
    if (body[1] !== 0x01) return out;
    if (body[3] >= 0x80) {
        out.temperature = ((((body[3] << 8) + body[4]) - 65535) - 1) / 100;
    } else {
        out.temperature = ((body[3] << 8) + body[4]) / 100;
    }
    if (body[5] !== 0xFF) out.humidity = ((body[5] << 8) + body[6]) / 100;
    if (body[7] !== 0xFF) out.tvoc = (body[7] << 8) + body[8];
    if (body[9] !== 0xFF) out.pm25 = (body[9] << 8) + body[10];
    if (body[11] !== 0xFF) out.co2 = (body[11] << 8) + body[12];
    if (body[13] !== 0xFF) out.hcho = ((body[13] << 8) + body[14]) / 0.1;
    if (body[16] !== 0xFF) {
        out.arofeneLink = (body[16] & 0x01) > 0;
        out.radarExist = (body[16] & 0x02) > 0;
    }
    return out;
}

class AirBoxDevice extends BaseDevice {
    get applianceType() { return APPLIANCE_TYPE_AIR_BOX; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        for (const bodyType of [0x21, 0x31]) {
            const body = buildADQuery(bodyType);
            const cmd = createCommand(body, {
                msgType: 0x03,
                protocol: 0x03,
                applianceType: APPLIANCE_TYPE_AIR_BOX,
                addCrc: false, // CRC8 already added inside the body
            });
            try {
                const reply = await this._request(cmd, `getStatus(${bodyType.toString(16)})`);
                const inner = reply.subarray(10, reply.length - 1);
                if (bodyType === 0x21) this._mergeStatus(parseAD21(inner));
                else this._mergeStatus(parseAD31(inner));
            } catch (err) {
                this.log.debug(`AD[${this.id}]: ${bodyType.toString(16)} query failed (${err.message})`);
            }
        }
        return this.status;
    }
}

module.exports = { AirBoxDevice, APPLIANCE_TYPE_AIR_BOX, parseAD21, parseAD31, parseAD11Notify };
