"use strict";

const { BaseDevice } = require("./base");
const { createCommand } = require("../packet");

const APPLIANCE_TYPE_TOP_LOAD_WASHER = 0xDA;
const APPLIANCE_TYPE_FRONT_LOAD_WASHER = 0xDB;
const APPLIANCE_TYPE_DRYER = 0xDC;

// DB program-byte → name mapping. Lifted from midea-local 6.6.0
// (commit b459bb3 added the 0x6C..0x6E / 0x80 / 0x82 / 0x73 entries
// for the Midea MF2000D80WB washing machine).
const DB_PROGRAM_NAMES = {
    0x00: "cotton", 0x01: "eco", 0x02: "fast_wash", 0x03: "mixed_wash",
    0x04: "fiber", 0x05: "wool", 0x06: "enzyme", 0x07: "ssp",
    0x08: "sport_clothes", 0x09: "single_dehytration", 0x0A: "rinsing_dehydration",
    0x0B: "big", 0x0C: "baby_clothes", 0x0D: "outdoor", 0x0E: "air_wash",
    0x0F: "down_jacket", 0x10: "color", 0x11: "intelligent", 0x12: "quick_wash",
    0x13: "kids", 0x14: "water_cotton", 0x15: "single_drying",
    0x16: "single_drying", 0x17: "fast_wash_30", 0x18: "fast_wash_60",
    0x19: "water_intelligent", 0x1A: "water_steep", 0x1B: "water_fast_wash_30",
    0x1C: "shirt", 0x1D: "steep", 0x1E: "new_water_cotton",
    0x1F: "water_mixed_wash", 0x20: "water_fiber", 0x21: "water_kids",
    0x22: "water_underwear", 0x23: "specialist", 0x24: "water_eco",
    0x25: "wash_drying_60", 0x26: "self_wash_5", 0x27: "fast_wash_min",
    0x28: "mixed_wash_min", 0x29: "dehydration_min", 0x2A: "self_wash_min",
    0x2B: "baby_clothes_min", 0x2C: "prevent_allergy", 0x2D: "cold_wash",
    0x2E: "soft_wash", 0x2F: "remove_mite_wash", 0x30: "water_intense_wash",
    0x31: "fast_dry", 0x32: "water_outdoor", 0x33: "spring_autumn_wash",
    0x34: "summer_wash", 0x35: "winter_wash", 0x36: "jean",
    0x37: "new_clothes_wash", 0x38: "silk", 0x39: "insight_wash",
    0x3A: "fitness_clothes", 0x3B: "mink", 0x3C: "fresh_air",
    0x3D: "bucket_dry", 0x3E: "jacket", 0x3F: "bath_towel",
    0x40: "night_fresh_wash", 0x50: "water_fiber", 0x51: "diy0", 0x52: "diy2",
    0x60: "heart_wash", 0x61: "water_cold_wash", 0x62: "water_prevent_allergy",
    0x63: "water_remove_mite_wash", 0x64: "water_ssp", 0x65: "silk_wash",
    0x66: "standard", 0x67: "green_wool", 0x68: "cook_wash",
    0x69: "fresh_remove_wrinkle", 0x6A: "steam_sterilize_wash",
    0x6B: "aromatherapy", 0x6C: "eco_40_60", 0x6D: "steam_care",
    0x6E: "allergy_care", 0x70: "sterilize_wash", 0x73: "bulky",
    0x80: "wash_and_dry", 0x82: "time_dry", 0xFE: "love", 0xFF: "default",
};

// DC (dryer) program-byte → name. From midea-local devices/dc/__init__.py.
const DC_PROGRAM_NAMES = {
    0: "cotton", 1: "fiber", 2: "mixed_wash", 3: "jean", 4: "bedsheet",
    5: "outdoor", 6: "down_jacket", 7: "plush", 8: "wool", 9: "dehumidify",
    10: "cold_air_fresh_air", 11: "hot_air_dry", 12: "sport_clothes",
    13: "underwear", 14: "baby_clothes", 15: "shirt", 16: "standard",
    17: "quick_dry", 18: "fresh_air", 19: "low_temp_dry", 20: "eco_dry",
    21: "quick_dry_30", 22: "towel", 23: "intelligent_dry", 24: "steam_care",
    25: "big", 26: "fixed_time_dry", 27: "night_dry", 28: "bracket_dry",
    29: "western_trouser", 30: "dehumidification", 31: "smart_dry",
    32: "four_piece_suit", 33: "warm_clothes", 34: "quick_dry_20",
    35: "steam_sterilize", 36: "enzyme", 37: "big_60", 38: "steam_no_iron",
    39: "air_wash", 40: "bed_clothes", 41: "little_fast_dry",
    42: "small_piece_dry", 43: "big_dry", 44: "wool_nurse",
    45: "sun_quilt", 46: "fresh_remove_smell", 47: "bucket_self_clean",
    48: "silk", 49: "sterilize",
};

// DC (dryer) statusCode → name. midea-local 6.5.0 (commit 5459300) added
// the 0=idle entry that was missing, hence the comment in the change list.
const DC_STATUS_NAMES = {
    0: "idle", 1: "standby", 2: "start", 3: "pause", 4: "end",
    5: "prevent_wrinkle_end", 6: "delay_choosing", 7: "fault",
    8: "delay", 9: "delay_pause",
};

/**
 * Top-load washer (DA), front-load washer (DB) and dryer (DC) share the
 * same query/start/power layout (body_type 0x03 query, 0x02 set). Status
 * fields differ slightly so we have one parser per type.
 */
function parseDABody(body) {
    const out = {};
    if (!body || body.length < 19) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.errorCode = body[24];
    out.program = body[4];
    out.washingData = Array.from(body.subarray(3, 15));
    out.washTime = body[9];
    out.soakTime = body[12];
    out.dehydrationTime = (body[10] & 0xF0) >> 4;
    out.dehydrationSpeed = (body[6] & 0xF0) >> 4;
    out.rinseCount = body[10] & 0x0F;
    out.rinseLevel = (body[5] & 0xF0) >> 4;
    out.washLevel = body[5] & 0x0F;
    out.washStrength = body[6] & 0x0F;
    out.softener = (body[8] & 0xF0) >> 4;
    out.detergent = body[8] & 0x0F;
    let progress = 0;
    for (let i = 1; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i; break; }
    }
    out.progress = progress;
    if (out.powerOn) out.timeRemaining = body[17] + body[18] * 60;
    return out;
}

function parseDBBody(body) {
    const out = {};
    if (!body || body.length < 31) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.statusCode = body[2];
    out.mode = body[3];
    out.program = body[4];
    out.programName = DB_PROGRAM_NAMES[body[4]] || null;
    out.waterLevel = body[5];
    out.temperature = body[7];
    out.dehydrationSpeed = body[8];
    out.washTime = body[9];
    out.dehydrationTime = body[10];
    out.detergent = body[11];
    out.softener = body[12];
    let progress = 0;
    for (let i = 0; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i + 1; break; }
    }
    out.progress = progress;
    out.stains = body[26];
    out.washTimeValue = body[27];
    out.dehydrationTimeValue = body[28];
    out.dirtyDegree = body[30];
    if (out.powerOn) out.timeRemaining = body[17] + (body[18] << 8);
    return out;
}

function parseDCBody(body) {
    const out = {};
    if (!body || body.length < 30) return out;
    out.powerOn = body[1] > 0;
    out.start = body[2] === 2 || body[2] === 6;
    out.statusCode = body[2];
    out.statusName = DC_STATUS_NAMES[body[2]] || null;
    out.program = body[4];
    out.programName = DC_PROGRAM_NAMES[body[4]] || null;
    out.washingData = Array.from(body.subarray(3, 15));
    out.intensity = body[9];
    out.drynessLevel = body[10];
    out.dryTemperature = body[10];
    out.errorCode = body[24];
    out.doorWarn = body[25];
    out.aiSwitch = body[27];
    out.material = body[28];
    out.waterBox = body[29];
    let progress = 0;
    for (let i = 0; i < 7; i++) {
        if ((body[16] & (1 << i)) > 0) { progress = i + 1; break; }
    }
    out.progress = progress;
    if (out.powerOn) out.timeRemaining = body[17] + body[18] * 60;
    return out;
}

class _LaundryBase extends BaseDevice {
    async refreshCapabilities() { return null; }

    /** @param {Buffer} _b */
    _parse(_b) { return {}; }

    async refreshStatus() {
        const body = Buffer.from([0x03]);
        const cmd = createCommand(body, {
            msgType: 0x03,
            protocol: 0x03,
            applianceType: this.applianceType,
            addCrc: false,
        });
        const reply = await this._request(cmd, "getStatus");
        this._processFrame(reply, { source: "query", msgType: reply[9] });
        return this.status;
    }

    _processFrame(frame, _ctx) {
        if (!frame || frame.length < 12) return undefined;
        const inner = frame.subarray(10, frame.length - 1);
        return this._mergeStatus(this._parse(inner));
    }

    async setStatus(updates = {}) {
        if (updates.powerOn !== undefined) {
            const tail = this.applianceType === APPLIANCE_TYPE_FRONT_LOAD_WASHER
                ? Buffer.alloc(20, 0xFF)
                : Buffer.from([0xFF]);
            const body = Buffer.concat([Buffer.from([0x02, updates.powerOn ? 0x01 : 0x00]), tail]);
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: this.applianceType,
                addCrc: false,
            });
            await this._request(cmd, "setPower");
            this.status.powerOn = !!updates.powerOn;
            return this.status;
        }
        if (updates.start !== undefined) {
            const head = updates.start ? Buffer.from([0x02, 0xFF, 0x01]) : Buffer.from([0x02, 0xFF, 0x00]);
            const body = updates.start && this.status.washingData
                ? Buffer.concat([head, Buffer.from(this.status.washingData || [])])
                : head;
            const cmd = createCommand(body, {
                msgType: 0x02,
                protocol: 0x03,
                applianceType: this.applianceType,
                addCrc: false,
            });
            await this._request(cmd, "setStart");
            return this.status;
        }
        return this.status;
    }
}

class TopLoadWasherDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_TOP_LOAD_WASHER; }
    _parse(b) { return parseDABody(b); }
}

class FrontLoadWasherDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_FRONT_LOAD_WASHER; }
    _parse(b) { return parseDBBody(b); }
}

class DryerDevice extends _LaundryBase {
    get applianceType() { return APPLIANCE_TYPE_DRYER; }
    _parse(b) { return parseDCBody(b); }
}

module.exports = {
    TopLoadWasherDevice, APPLIANCE_TYPE_TOP_LOAD_WASHER,
    FrontLoadWasherDevice, APPLIANCE_TYPE_FRONT_LOAD_WASHER,
    DryerDevice, APPLIANCE_TYPE_DRYER,
};
