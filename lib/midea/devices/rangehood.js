"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_RANGE_HOOD = 0xB6;

function fanLevelDecode(level) {
    if (level <= 100) return level;
    if (level < 130) return 1;
    if (level < 140) return 2;
    if (level < 170) return 3;
    return 4;
}

function parseB6General(body) {
    const out = {};
    if (!body || body.length < 6) return out;
    if (body[1] !== 0xFF) out.light = body[1] > 0;
    let fanLevel = 0;
    if (body[2] !== 0xFF) {
        out.powerOn = [0x02, 0x06, 0x07, 0x14, 0x15, 0x16].includes(body[2]);
        if (body[2] === 0x14 || body[2] === 0x16) fanLevel = 0x16;
    }
    if (fanLevel === 0 && body[3] !== 0xFF) fanLevel = body[3];
    out.fanLevel = fanLevelDecode(fanLevel);
    out.oilcupFull = (body[5] & 0x01) > 0;
    out.cleaningReminder = (body[5] & 0x02) > 0;
    return out;
}

function parseB6New(body) {
    const out = {};
    if (!body || body.length < 4 || body[1] !== 0x01) return out;
    const packLen = body[2];
    const pack = body.subarray(3, 3 + packLen);
    if (pack.length < 19) return out;
    if (pack[1] !== 0xFF) out.powerOn = ![0x00, 0x01, 0x05, 0x07].includes(pack[1]);
    if (pack[2] !== 0xFF) out.fanLevel = pack[2];
    if (pack[6] !== 0xFF) out.light = pack[6] > 0;
    out.oilcupFull = (pack[18] & 0x02) > 0;
    out.cleaningReminder = (pack[18] & 0x04) > 0;
    return out;
}

/**
 * Notify1 0x0A body. Sub-byte 0xA1 = exception (no payload extracted),
 * 0xA2 = oilcup/cleaning push update at body[2].
 */
function parseB6_0A(body) {
    const out = {};
    if (!body || body.length < 3) return out;
    if (body[1] === 0xA2) {
        out.oilcupFull = (body[2] & 0x01) > 0;
        out.cleaningReminder = (body[2] & 0x02) > 0;
    }
    return out;
}

function parseB6Reply(body, protocolVersion) {
    if (!body || body.length === 0) return {};
    const bt = body[0];
    if (bt === 0x0A) return parseB6_0A(body);
    if (protocolVersion === 2) return parseB6New(body);
    return parseB6General(body);
}

class RangeHoodDevice extends BaseDevice {
    constructor(opts) {
        super(opts);
        this.protocolVersion = Number(opts.protocolVersion || opts.protocol || 0);
    }

    get applianceType() { return APPLIANCE_TYPE_RANGE_HOOD; }

    async refreshCapabilities() { return null; }

    async refreshStatus() {
        const bodyType = this.protocolVersion === 2 ? 0x11 : 0x31;
        const cmd = createCommand(Buffer.from([bodyType]), {
            msgType: 0x03, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RANGE_HOOD, addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(parseB6Reply(inner, this.protocolVersion));
    }

    async setStatus(updates = {}) {
        const oldProto = this.protocolVersion === 0 || this.protocolVersion === 1;
        if (oldProto) {
            // body_type 0x22, 9 bytes
            let light = 0xFF, value2 = 0xFF, value3 = 0xFF;
            if (updates.light !== undefined) {
                light = updates.light ? 0x1A : 0x00;
            } else if (updates.powerOn !== undefined) {
                if (updates.powerOn) {
                    value2 = 0x02;
                    value3 = updates.fanLevel !== undefined ? Number(updates.fanLevel) : 0x01;
                } else value2 = 0x03;
            } else if (updates.fanLevel !== undefined) {
                if (Number(updates.fanLevel) === 0) value2 = 0x03;
                else { value2 = 0x02; value3 = Number(updates.fanLevel); }
            } else return this.status;
            const body = Buffer.from([0x22, 0x01, light, value2, value3, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
            const cmd = createCommand(body, {
                msgType: 0x02, protocol: 0x03,
                applianceType: APPLIANCE_TYPE_RANGE_HOOD, addCrc: false,
            });
            await this._request(cmd, "setStatus");
            return this.status;
        }
        // protocol 2: body_type 0x11
        let v13, v14 = 0xFF, v15, v16 = 0xFF;
        if (updates.powerOn !== undefined) {
            v13 = 0x01;
            if (updates.powerOn) { v15 = 0x02; v16 = updates.fanLevel !== undefined ? Number(updates.fanLevel) : 0x01; }
            else v15 = 0x01;
        } else if (updates.fanLevel !== undefined) {
            v13 = 0x01;
            if (Number(updates.fanLevel) === 0) v15 = 0x01;
            else { v15 = 0x02; v16 = Number(updates.fanLevel); }
        } else if (updates.light !== undefined) {
            v13 = 0x02; v14 = 0x02; v15 = updates.light ? 0x01 : 0x00;
        } else return this.status;
        const body = Buffer.from([0x11, 0x01, v13, v14, v15, v16, 0xFF, 0xFF]);
        const cmd = createCommand(body, {
            msgType: 0x02, protocol: 0x03,
            applianceType: APPLIANCE_TYPE_RANGE_HOOD, addCrc: false,
        });
        await this._request(cmd, "setStatus");
        return this.status;
    }
}

module.exports = { RangeHoodDevice, APPLIANCE_TYPE_RANGE_HOOD };
