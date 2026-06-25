"use strict";

/**
 * Capability response (0xB5) parser. Returns a flat capability object plus
 * a `more` counter; non-zero `more` means the device wants the caller to
 * issue follow-up B5 0x01 0x01 queries until 0.
 */
function parseB5(data) {
    const caps = {
        activeClean: false,
        autoMode: false,
        autoSetHumidity: false,
        breezeAway: false,
        breezeControl: false,
        breezeMild: false,
        breezeless: false,
        buzzer: false,
        coolMode: false,
        decimals: false,
        downNoWindFeel: false,
        dryMode: false,
        ecoMode: false,
        electricAuxHeating: false,
        fanSpeedControl: true,
        filterReminder: false,
        flashCool: false,
        frostProtectionMode: false,
        hasAutoClearHumidity: false,
        hasHandWind: false,
        heatMode: false,
        horizontalSwingAngle: false,
        ieco: false,
        indoorHumidity: false,
        leftrightFan: false,
        lightControl: false,
        manualSetHumidity: false,
        maxTempAuto: 30,
        maxTempCool: 30,
        maxTempHeat: 30,
        minTempAuto: 17,
        minTempCool: 17,
        minTempHeat: 17,
        nestCheck: false,
        nestNeedChange: false,
        oneKeyNoWindOnMe: false,
        outSilent: false,
        powerCal: false,
        powerCalSetting: false,
        rateSelect: 0,
        selfClean: false,
        silkyCool: false,
        smartEye: false,
        specialEco: false,
        turboCool: false,
        turboHeat: false,
        unitChangeable: false,
        updownFan: false,
        upNoWindFeel: false,
        verticalSwingAngle: false,
        windOffMe: false,
        windOnMe: false,
    };

    let i = 2;
    let toProcess = data[1];
    while (i < data.length - 2 && toProcess > 0) {
        const id = data[i];
        const tag = data[i + 1];
        const len = data[i + 2];
        if (i + 3 + len > data.length) break;
        const value = data[i + 3];

        if (tag === 0x00 && len > 0) {
            switch (id) {
                case 0x15: caps.indoorHumidity = value !== 0; break;
                case 0x18: caps.silkyCool = value !== 0; break;
                case 0x30: caps.smartEye = value === 1; break;
                case 0x32: caps.windOnMe = value === 1; break;
                case 0x33: caps.windOffMe = value === 0; break;
                case 0x39: caps.activeClean = value === 1; break;
                case 0x3D: caps.upNoWindFeel = value > 1; break;
                case 0x3E: caps.downNoWindFeel = value > 1; break;
                case 0x42: caps.oneKeyNoWindOnMe = value === 1; break;
                case 0x43: caps.breezeControl = value === 0; break;
                case 0x44: caps.outSilent = value === 1; break;
                default: break;
            }
        }

        if (tag === 0x02 && len > 0) {
            switch (id) {
                case 0x10: caps.fanSpeedControl = value !== 1; break;
                case 0x12:
                    caps.ecoMode = value === 1;
                    caps.specialEco = value === 2;
                    break;
                case 0x13: caps.frostProtectionMode = value === 1; break;
                case 0x14:
                    caps.coolMode = value === 0 || value === 1 || value === 3;
                    caps.heatMode = value === 1 || value === 2;
                    caps.dryMode = value === 0 || value === 1;
                    caps.autoMode = value === 0 || value === 1 || value === 2;
                    break;
                case 0x15:
                    caps.leftrightFan = value === 1 || value === 3;
                    caps.updownFan = value === 0 || value === 1;
                    break;
                case 0x16:
                    caps.powerCal = value === 2 || value === 3;
                    caps.powerCalSetting = value === 3;
                    break;
                case 0x17:
                    caps.nestCheck = value === 1 || value === 2 || value === 4;
                    caps.nestNeedChange = value === 3 || value === 4;
                    break;
                case 0x19: caps.electricAuxHeating = value === 1; break;
                case 0x1A:
                    caps.turboHeat = value === 1 || value === 3;
                    caps.turboCool = value === 0 || value === 1;
                    break;
                case 0x1F:
                    caps.autoSetHumidity = value === 1 || value === 2;
                    caps.manualSetHumidity = value === 2 || value === 3;
                    break;
                case 0x20: caps.selfClean = value === 1; break;
                case 0x21: caps.filterReminder = value === 1; break;
                case 0x22: caps.unitChangeable = value === 0; break;
                case 0x24: caps.lightControl = value; break;
                case 0x25:
                    if (len >= 6) {
                        caps.minTempCool = data[i + 3] / 2;
                        caps.maxTempCool = data[i + 4] / 2;
                        caps.minTempAuto = data[i + 5] / 2;
                        caps.maxTempAuto = data[i + 6] / 2;
                        caps.minTempHeat = data[i + 7] / 2;
                        caps.maxTempHeat = data[i + 8] / 2;
                        caps.decimals = (len > 6 ? data[i + 9] : data[i + 5]) !== 0;
                    }
                    break;
                case 0x2A:
                    caps.breezeAway = (value & 0x01) === 0x01;
                    caps.breezeMild = (value & 0x02) === 0x02;
                    caps.breezeless = (value & 0x04) === 0x04;
                    break;
                case 0x2B: caps.ieco = value === 1; break;
                case 0x2C: caps.buzzer = value !== 0; break;
                case 0x2D: caps.flashCool = value === 1; break;
                case 0x32: caps.hasAutoClearHumidity = value === 1; break;
                case 0x33: caps.hasHandWind = value === 1; break;
                case 0x35: caps.verticalSwingAngle = value !== 0; break;
                case 0x36: caps.horizontalSwingAngle = value !== 0; break;
                case 0x37: caps.rateSelect = value & 0xFF; break;
                default: break;
            }
        }

        i += 3 + len;
        toProcess--;
    }

    return {
        more: data.length - i >= 2 ? data[data.length - 2] : 0,
        capabilities: caps,
    };
}

/**
 * Status response (0xC0) parser for residential AC. Decodes byte-by-byte
 * per the Midea protocol notes from node-mideahvac.
 */
function parseC0(data) {
    const status = {};
    if (data.length < 19) return status;

    status.inError = (data[1] & 0x80) === 0x80;
    status.fastCheck = (data[1] & 0x20) === 0x20;
    status.timerMode = (data[1] & 0x10) >> 4;
    status.resume = (data[1] & 0x04) === 0x04;
    status.powerOn = (data[1] & 0x01) === 0x01;

    status.temperatureSetpoint = (data[2] & 0x0F) + 16 + ((data[2] & 0x10) >> 4) * 0.5;
    status.mode = (data[2] & 0xE0) >> 5;

    status.fanSpeed = data[3] & 0x7F;

    status.onTimer = (data[4] & 0x80) === 0x80;
    status.offTimer = (data[5] & 0x80) === 0x80;
    status.onTimerHours = status.onTimer ? (data[4] & 0x7C) >> 2 : 0;
    status.onTimerMinutes = status.onTimer ? ((data[4] & 0x03) + 1) * 15 - (data[6] >> 4) : 0;
    if (status.onTimerMinutes === 60) {
        status.onTimerMinutes = 0;
        status.onTimerHours++;
    }
    status.offTimerHours = status.offTimer ? (data[5] & 0x7C) >> 2 : 0;
    status.offTimerMinutes = status.offTimer ? ((data[5] & 0x03) + 1) * 15 - (data[6] & 0x0F) : 0;
    if (status.offTimerMinutes === 60) {
        status.offTimerMinutes = 0;
        status.offTimerHours++;
    }

    status.leftrightFan = (data[7] & 0x03) === 0x03;
    status.updownFan = (data[7] & 0x0C) === 0x0C;

    status.feelOwn = (data[8] & 0x80) === 0x80;
    status.smartEye = (data[8] & 0x40) === 0x40;
    const turbo2 = (data[8] & 0x20) === 0x20;
    status.lowFrequencyFan = (data[8] & 0x10) === 0x10;
    status.save = (data[8] & 0x08) === 0x08;
    status.cosySleep = data[8] & 0x03;

    status.purify = (data[9] & 0x20) === 0x20;
    status.ecoMode = (data[9] & 0x10) === 0x10;
    status.ptcHeater = (data[9] & 0x08) === 0x08;
    status.dryClean = (data[9] & 0x04) === 0x04;
    status.naturalFan = (data[9] & 0x02) === 0x02;
    status.childSleep = (data[9] & 0x01) === 0x01;

    status.coolFan = (data[10] & 0x80) === 0x80;
    status.peakValleyElectricitySaving = (data[10] & 0x40) === 0x40;
    status.catchCold = (data[10] & 0x20) === 0x20;
    status.nightLight = (data[10] & 0x10) === 0x10;
    status.ventilation = (data[10] & 0x08) === 0x08;
    status.temperatureUnit = (data[10] & 0x04) >> 2;
    status.turboMode = (((data[10] & 0x02) === 0x02) || turbo2);
    status.sleepMode = (data[10] & 0x01) === 0x01;

    // 0xFF on either temperature byte means "no reading" — newer firmware
    // sends it whenever the sensor isn't ready or doesn't exist (outdoor
    // sensor on indoor-only units). midea-local message.py:829 returns None
    // for that case; compute the conversion only when the byte is plausible.
    status.indoorTemperature = data[11] === 0xFF ? null : (data[11] - 50) / 2;
    status.outdoorTemperature = data[12] === 0xFF ? null : (data[12] - 50) / 2;

    status.dustFull = (data[13] & 0x20) === 0x20;
    if ((data[13] & 0x1F) > 0) {
        status.temperatureSetpoint = (data[13] & 0x1F) + 12;
    }

    status.light = (data[14] & 0x70) >> 4;
    // PMV (Predicted Mean Vote) is reported as a 4-bit raw value that maps
    // to the −3.5…+4.0 thermal-comfort scale via `raw * 0.5 - 3.5`.
    // midea-local message.py:980. Expose both: the raw nibble (legacy) and
    // the calibrated float so downstream code can pick.
    status.pmvRaw = data[14] & 0x0F;
    status.pmv = status.pmvRaw * 0.5 - 3.5;

    const indoorDecimal = data[15] & 0x0F;
    const outdoorDecimal = (data[15] & 0xF0) >> 4;
    if (status.indoorTemperature !== null) {
        status.indoorTemperature += status.indoorTemperature >= 0 ? indoorDecimal / 10 : -indoorDecimal / 10;
    }
    if (status.outdoorTemperature !== null) {
        status.outdoorTemperature += status.outdoorTemperature >= 0 ? outdoorDecimal / 10 : -outdoorDecimal / 10;
    }

    status.statusCode = data[16];
    status.ecoSleepRunningMinutes = (data[17] & 0xFC) >> 3;
    status.ecoSleepRunningSeconds = ((data[18] & 0xF0) >> 2) | (data[17] & 0x02);
    status.ecoSleepRunningHours = data[18] & 0x0F;

    if (data.length >= 20) {
        status.downWindControl = (data[19] & 0x80) === 0x80;
        status.humiditySetpoint = data[19] & 0x7F;
    }
    if (data.length >= 21) {
        status.downWindControlLR = (data[20] & 0x80) === 0x80;
    }
    if (data.length >= 22) {
        status.frostProtection = (data[21] & 0x80) === 0x80;
        status.dualControl = (data[21] & 0x40) === 0x40;
    }
    if (data.length >= 23) {
        status.windBlowing = (data[22] & 0x10) === 0x10;
        status.smartWind = (data[22] & 0x08) === 0x08;
        status.braceletControl = (data[22] & 0x04) === 0x04;
        status.braceletSleep = (data[22] & 0x02) === 0x02;
        status.keepWarm = (data[22] & 0x01) === 0x01;
        status.comfortMode = (data[22] & 0x01) === 0x01;
    }
    // midea-local naming: explicit telemetry fields
    status.kickQuilt = ((data[10] & 0x04) >> 2) > 0;
    status.preventCold = ((data[10] & 0x20) >> 5) > 0;
    status.comfortSleepSwitch = (data[9] & 0x40) === 0x40;
    if (data.length >= 20) {
        status.smartDry = (data[19] & 0x7F) > 0;
        status.swingLRSwitch = (data[19] & 0x80) === 0x80;
    }
    if (data.length >= 21) {
        status.swingLRValue = (data[20] & 0x80) === 0x80;
    }
    if (data.length >= 28) {
        status.freshFilterTimeTotal = data[25] * 256 + data[24];
        status.freshFilterTimeUse = data[27] * 256 + data[26];
        status.freshFilterTimeout = ((data[13] & 0x40) >> 6) > 0;
    }

    if (status.temperatureUnit) {
        if (typeof status.temperatureSetpoint === "number") {
            status.temperatureSetpoint = Math.round(status.temperatureSetpoint * 1.8 + 32);
        }
        if (status.indoorTemperature !== null && typeof status.indoorTemperature === "number") {
            status.indoorTemperature = Math.round(status.indoorTemperature * 1.8 + 32);
        }
        if (status.outdoorTemperature !== null && typeof status.outdoorTemperature === "number") {
            status.outdoorTemperature = Math.round(status.outdoorTemperature * 1.8 + 32);
        }
    }

    return status;
}

// midea-local PowerFormats: 1=BCD, 2=BINARY (0.1 kWh), 3=MIXED (byte = 0..99),
// 12=BINARY1, 101=BCD_ENERGY_BINARY_POWER (BCD for energy, BINARY for power —
// commit 5824a68).
const POWER_FORMATS = { BCD: 1, BINARY: 2, MIXED: 3, BINARY1: 12, BCD_ENERGY_BINARY_POWER: 101 };
const _powerAnalysis = {
    [POWER_FORMATS.BCD]: (byte, value) => ((byte >> 4) * 10 + (byte & 0x0F)) + value * 100,
    [POWER_FORMATS.MIXED]: (byte, value) => byte + value * 100,
    [POWER_FORMATS.BINARY]: (byte, value) => byte + value * 256,
};

function _parsePowerValue(method, bytes) {
    const fn = _powerAnalysis[method % 10];
    if (!fn) return 0;
    let value = 0;
    for (const b of bytes) value = fn(b, value);
    return value;
}

function parsePower(method, bytes) {
    // BCD_ENERGY_BINARY_POWER: real-time power uses the BINARY layout even
    // though energy fields use BCD on this firmware variant.
    if (method === POWER_FORMATS.BCD_ENERGY_BINARY_POWER) {
        return _parsePowerValue(POWER_FORMATS.BINARY, bytes) / 10;
    }
    return _parsePowerValue(method, bytes) / 10;
}
function _bcdDigits(byte) {
    return ((byte >> 4) * 10) + (byte & 0x0F);
}

// msmart-ng style 4-byte BCD energy: byte0=10000s, byte1=100s, byte2=units,
// byte3=0.01s. Produces XXXXXX.XX kWh. msmart-ng command.py:1090.
function _msmartEnergyBcd(bytes) {
    if (!bytes || bytes.length < 4) return 0;
    return 10000 * _bcdDigits(bytes[0])
        + 100 * _bcdDigits(bytes[1])
        + 1 * _bcdDigits(bytes[2])
        + 0.01 * _bcdDigits(bytes[3]);
}

// msmart-ng style 3-byte BCD realtime power: byte0=1000s, byte1=10s,
// byte2=0.1s. msmart-ng command.py:1100.
function _msmartPowerBcd(bytes) {
    if (!bytes || bytes.length < 3) return 0;
    return 1000 * _bcdDigits(bytes[0])
        + 10 * _bcdDigits(bytes[1])
        + 0.1 * _bcdDigits(bytes[2]);
}

function parseConsumption(method, bytes) {
    if (method === POWER_FORMATS.BCD_ENERGY_BINARY_POWER) {
        return _parsePowerValue(POWER_FORMATS.BCD, bytes) / 100;
    }
    const div = method === POWER_FORMATS.BINARY ? 10 : 100;
    return _parsePowerValue(method, bytes) / div;
}

/**
 * Power/runtime/humidity response (0xC1) parser. Dispatches on body[3]:
 *   0x44 — energy/power totals (4 banks of 4 bytes + 3-byte realtime power)
 *   0x40 — electrify_time / total_operating_time / current_operating_time
 *   0x45 — indoor humidity (single byte)
 * Falls back to the legacy 3-byte BCD power_usage decoding when body is short
 * or sub-body type is not recognised.
 */
function parseC1(data, analysisMethod) {
    const out = {};
    // midea-local default is PowerFormats.BCD (=1, ac __init__.py:193).
    // Earlier ioBroker.midea releases used MIXED (3) which produces
    // ~factor-2 wrong readings on PortaSplit firmware.
    const method = analysisMethod === undefined ? POWER_FORMATS.BCD : analysisMethod;
    const sub = data.length >= 4 ? data[3] : null;

    if (sub === 0x44 && data.length >= 19) {
        const totalBytes = data.subarray(4, 8);
        const totalRunBytes = data.subarray(8, 12);
        const currentBytes = data.subarray(12, 16);
        const realtimeBytes = data.subarray(16, 19);
        out.totalEnergyConsumption = parseConsumption(method, totalBytes);
        out.totalOperatingConsumption = parseConsumption(method, totalRunBytes);
        out.currentEnergyConsumption = parseConsumption(method, currentBytes);
        out.realtimePower = parsePower(method, realtimeBytes);
        out.powerUsage = out.totalEnergyConsumption;
        // The Q1B/Q1F Lua plugins decode the same C1/0x44 bytes in BOTH
        // BCD and binary form simultaneously (lib/midea/lua-cache/
        // T_0000_AC_00000Q1B_2024013001.lua:733/2234/2238) — different
        // firmware reports the truth in different layouts. Expose the
        // binary alternates so adapters can pick the variant that
        // matches the Midea SmartHome app value without having to
        // reconfigure the analysis method.
        out.totalEnergyConsumptionBinary = _parsePowerValue(POWER_FORMATS.BINARY, totalBytes) / 10;
        out.currentEnergyConsumptionBinary = _parsePowerValue(POWER_FORMATS.BINARY, currentBytes) / 10;
        out.realtimePowerBinary = _parsePowerValue(POWER_FORMATS.BINARY, realtimeBytes) / 10;
        // msmart-ng decode_bcd variant: byte0=10000s, byte1=100s, byte2=1s,
        // byte3=0.01s — produces XXXXXX.XX kWh from four BCD bytes
        // (msmart-ng command.py:1090). Used by some PortaSplit firmware
        // where our cumulative-BCD result is off by a factor.
        out.totalEnergyConsumptionMsmartBCD = _msmartEnergyBcd(totalBytes);
        out.currentEnergyConsumptionMsmartBCD = _msmartEnergyBcd(currentBytes);
        out.realtimePowerMsmartBCD = _msmartPowerBcd(realtimeBytes);
        return out;
    }

    if (sub === 0x40 && data.length >= 19) {
        // electrify / total / current operating-time tuples are
        // [days_hi, days_lo, hours, minutes, seconds]. Expose minutes
        // (legacy) and hours (midea-local message.py:1049 summary unit) so
        // both UI patterns work.
        const ed = (data[4] << 8) | data[5];
        out.electrifyTime = ed * 24 * 60 + data[6] * 60 + data[7] + data[8] / 60;
        out.electrifyTimeHours = ed * 24 + data[6] + data[7] / 60 + data[8] / 3600;
        const td = (data[9] << 8) | data[10];
        out.totalOperatingTime = td * 24 * 60 + data[11] * 60 + data[12] + data[13] / 60;
        out.totalOperatingTimeHours = td * 24 + data[11] + data[12] / 60 + data[13] / 3600;
        const cd = (data[14] << 8) | data[15];
        out.currentOperatingTime = cd * 24 * 60 + data[16] * 60 + data[17] + data[18] / 60;
        out.currentOperatingTimeHours = cd * 24 + data[16] + data[17] / 60 + data[18] / 3600;
        return out;
    }

    if (sub === 0x45 && data.length >= 5) {
        // Group 5 layout (msmart-ng Group5Response):
        //   byte 4  → indoor humidity (0 = sensor absent)
        //   byte 8  → outdoor fan RPM (raw * 8)
        //   byte 10 → defrost flag
        // The byte-8-flips-to-0 "heating" heuristic from msmart issue
        // #248 is the same field interpreted differently and matches
        // outdoorFanSpeedRpm > 0 most of the time, so we keep
        // heatingActive as an alias rather than introducing a third name.
        if (data[4] !== 0) out.indoorHumidity = data[4];
        if (data.length > 8) {
            out.outdoorFanSpeedRpm = data[8] * 8;
            out.heatingActive = data[8] !== 0;
        }
        if (data.length > 10) {
            out.defrostActive = data[10] !== 0;
        }
        return out;
    }

    // Sub-body 0x41 (Group 1) — outdoor unit + indoor coil telemetry.
    // Reverse-engineered in midea-msmart TurboLed/group1and2Data:
    // bytes [4..14] = compressor freq, current, voltage, T1..T4, TP.
    // midea-local issue #424 confirms the layout.
    if (sub === 0x41 && data.length >= 15) {
        out.compressorFrequency = data[4];
        out.outdoorUnitCurrent = data[7];
        out.outdoorUnitVoltage = data[8];
        // T1 indoor ambient (signed bias 30), T2 indoor coil (signed bias 30),
        // T3 outdoor coil (signed bias 50), T4 outdoor ambient (signed bias 50).
        out.indoorAmbientTemperature = (data[10] - 30) / 2;
        out.indoorCoilTemperature = (data[11] - 30) / 2;
        out.outdoorCoilTemperature = (data[12] - 50) / 2;
        out.outdoorAmbientTemperature = (data[13] - 50) / 2;
        // TP raw byte = compressor discharge index; the calibration table
        // varies per model (see TurboLed comment), expose raw for now.
        out.compressorDischargeRaw = data[14];
        return out;
    }

    // Sub-body 0x42 (Group 2) — indoor fan RPM. byte[5] * 8 = RPM.
    if (sub === 0x42 && data.length >= 6) {
        out.indoorFanSpeedRpm = data[5] * 8;
        return out;
    }

    // Sub-body 0x47 (Group 7) — outdoor unit instantaneous power.
    // bytes [10..11]: low + high*255 (W). msmart-ng TurboLed fork.
    if (sub === 0x47 && data.length >= 12) {
        out.outdoorUnitPower = data[10] + data[11] * 255;
        return out;
    }

    // Legacy 3-byte BCD layout (kept for compatibility with older firmware
    // that doesn't include a sub-body type).
    if (data.length >= 19) {
        let n = 0;
        let m = 1;
        for (let i = 0; i < 3; i++) {
            n += (data[18 - i] & 0x0F) * m;
            n += ((data[18 - i] >> 4) & 0x0F) * m * 10;
            m *= 100;
        }
        out.powerUsage = n / 10000;
        return out;
    }

    // Last resort: a sub-body we don't know how to decode. Expose the
    // raw bytes so a reporter with an undocumented model can identify
    // useful fields without an adapter update. Keys: group<NN>Hex +
    // group<NN>Byte0..Byte<N-1> (first 24 bytes).
    if (sub !== null && data.length > 4) {
        const inner = data.subarray(4);
        const groupKey = `group${sub.toString(16).toUpperCase().padStart(2, "0")}`;
        out[`${groupKey}Hex`] = inner.toString("hex");
        const cap = Math.min(inner.length, 24);
        for (let i = 0; i < cap; i++) out[`${groupKey}Byte${i}`] = inner[i];
    }
    return out;
}

const NEW_PROTOCOL_TAGS = {
    prompt_tone: 0x001A,
    indoor_humidity: 0x0015,
    screen_display: 0x0017,
    breezeless: 0x0018,
    indirect_wind: 0x0042,
    fresh_air_1: 0x0233,
    fresh_air_2: 0x004B,
    wind_lr_angle: 0x000A,
    wind_ud_angle: 0x0009,
    out_silent: 0x00CD,
    // v6.7+ AC features (midea-local commit e763077 + master)
    anion: 0x021E,
    sound: 0x022C,
    self_clean: 0x0039,
    error_code_query: 0x003F,
    // v6.8+ AC: live self-clean running indicator (midea-local
    // commit landing in 6.8.0). The query tag is 0x00E2 and the reply
    // carries a 13-byte payload whose byte 12 is non-zero when the
    // cleaning cycle is currently active.
    self_clean_active: 0x00E2,
    // Additional NewProtocol property IDs from msmart-ng PropertyId enum.
    // We expose them as plain booleans / 0..100 values; the firmware
    // either replies with the current state or ignores the tag silently.
    rate_select: 0x0048,         // fan-speed precision selector
    fresh_air: 0x004B,           // fresh-air binary (alongside our fresh_air_2)
    cascade: 0x0059,             // "wind around" — louver oscillation pattern
    jet_cool: 0x0067,            // flash-cool / jet-cool one-shot
    preset_ieco: 0x00E3,         // "iECO" preset (newer firmware)
};

const NEW_PROTOCOL_INDIRECT_WIND_VALUE = 0x02;
// out_silent enable byte is 0x03 (NOT 0x01 — firmware rejects 0x01 with 0x11
// "invalid value", see midea-local commit 9af1ad9 / msmart#258).
const NEW_PROTOCOL_OUT_SILENT_VALUE = 0x03;

/**
 * Parse a NewProtocol body (0xB0/0xB1). 0xB5 uses a 4-byte param header,
 * everything else (B0/B1) uses a 5-byte header (param-lo, param-hi, 0x00, len, value).
 * Returns a map of param-id -> Buffer.
 */
function parseNewProtocolParams(data, packLen) {
    const out = {};
    if (!data || data.length < 2) return out;
    let pos = 2;
    const count = data[1];
    for (let i = 0; i < count; i++) {
        if (pos + 2 > data.length) break;
        const param = data[pos] | (data[pos + 1] << 8);
        pos += 2;
        if (packLen === 5) {
            if (pos >= data.length) break;
            pos += 1;
        }
        if (pos >= data.length) break;
        const len = data[pos];
        pos += 1;
        if (len > 0) {
            if (pos + len > data.length) break;
            out[param] = Buffer.from(data.subarray(pos, pos + len));
            pos += len;
        }
    }
    return out;
}

/**
 * Decode a 0xB0 (NewProtocol set ack) or 0xB1 (NewProtocol query response) body
 * into AC status fields.
 */
function parseBX(data) {
    const status = {};
    const params = parseNewProtocolParams(data, 5);
    if (params[NEW_PROTOCOL_TAGS.indirect_wind]) {
        status.indirectWind = params[NEW_PROTOCOL_TAGS.indirect_wind][0] === NEW_PROTOCOL_INDIRECT_WIND_VALUE;
    }
    if (params[NEW_PROTOCOL_TAGS.indoor_humidity]) {
        const v = params[NEW_PROTOCOL_TAGS.indoor_humidity][0];
        if (v !== 0) status.indoorHumidity = v;
    }
    if (params[NEW_PROTOCOL_TAGS.breezeless]) {
        status.breezeless = params[NEW_PROTOCOL_TAGS.breezeless][0] === 1;
    }
    if (params[NEW_PROTOCOL_TAGS.screen_display]) {
        status.screenDisplayAlternate = params[NEW_PROTOCOL_TAGS.screen_display][0] > 0;
        // midea-local message.py:879 also raises a separate "have we seen
        // the new screen-display tag at all" flag, useful for adapters
        // that want to disable the legacy 0xC0 status bit and trust this
        // alternate channel only.
        status.screenDisplayNew = true;
    }
    if (params[NEW_PROTOCOL_TAGS.fresh_air_1] && params[NEW_PROTOCOL_TAGS.fresh_air_1].length >= 2) {
        const d = params[NEW_PROTOCOL_TAGS.fresh_air_1];
        status.freshAirPower = d[0] === NEW_PROTOCOL_INDIRECT_WIND_VALUE;
        status.freshAirFanSpeed = d[1];
    }
    if (params[NEW_PROTOCOL_TAGS.fresh_air_2] && params[NEW_PROTOCOL_TAGS.fresh_air_2].length >= 2) {
        const d = params[NEW_PROTOCOL_TAGS.fresh_air_2];
        status.freshAirPower = d[0] > 0;
        status.freshAirFanSpeed = d[1];
    }
    if (params[NEW_PROTOCOL_TAGS.wind_lr_angle]) {
        status.windLrAngle = params[NEW_PROTOCOL_TAGS.wind_lr_angle][0];
    }
    if (params[NEW_PROTOCOL_TAGS.wind_ud_angle]) {
        status.windUdAngle = params[NEW_PROTOCOL_TAGS.wind_ud_angle][0];
    }
    if (params[NEW_PROTOCOL_TAGS.out_silent]) {
        status.outSilent = params[NEW_PROTOCOL_TAGS.out_silent][0] === NEW_PROTOCOL_OUT_SILENT_VALUE;
    }
    // v6.7+ AC features (midea-local commit e763077): expose plain booleans
    // when the appliance reports them on B0/B1.
    if (params[NEW_PROTOCOL_TAGS.anion]) {
        status.anion = params[NEW_PROTOCOL_TAGS.anion][0] === 1;
    }
    if (params[NEW_PROTOCOL_TAGS.sound]) {
        status.sound = params[NEW_PROTOCOL_TAGS.sound][0] === 1;
    }
    if (params[NEW_PROTOCOL_TAGS.self_clean]) {
        status.selfClean = params[NEW_PROTOCOL_TAGS.self_clean][0] === 1;
    }
    if (params[NEW_PROTOCOL_TAGS.error_code_query]) {
        status.errorCode = params[NEW_PROTOCOL_TAGS.error_code_query][0];
    }
    // v6.8+ self-clean active: a non-zero byte 12 of the 13-byte payload
    // means a cleaning cycle is currently running (midea-local message.py:927).
    if (params[NEW_PROTOCOL_TAGS.self_clean_active]) {
        const d = params[NEW_PROTOCOL_TAGS.self_clean_active];
        status.selfCleanActive = d.length > 12 && d[12] !== 0;
    }
    // Extra msmart-ng property fields. The wire encoding is a single
    // value byte for each — non-zero == on for boolean toggles; numeric
    // tags pass the raw byte through.
    if (params[NEW_PROTOCOL_TAGS.rate_select]) {
        status.rateSelect = params[NEW_PROTOCOL_TAGS.rate_select][0];
    }
    if (params[NEW_PROTOCOL_TAGS.fresh_air]) {
        status.freshAir = params[NEW_PROTOCOL_TAGS.fresh_air][0] !== 0;
    }
    if (params[NEW_PROTOCOL_TAGS.cascade]) {
        status.cascade = params[NEW_PROTOCOL_TAGS.cascade][0] !== 0;
    }
    if (params[NEW_PROTOCOL_TAGS.jet_cool]) {
        status.jetCool = params[NEW_PROTOCOL_TAGS.jet_cool][0] !== 0;
    }
    if (params[NEW_PROTOCOL_TAGS.preset_ieco]) {
        status.presetIeco = params[NEW_PROTOCOL_TAGS.preset_ieco][0] !== 0;
    }
    return status;
}

/**
 * Dehumidifier (0xA1) status response parser. Layout taken from
 * midea-beautiful-air's DehumidifierResponse class. `data` is the decrypted
 * 0xAA body (response code at index 0, useful payload from index 1 on).
 */
function parseA1Response(data) {
    const out = {};
    if (!data || data.length < 19) return out;

    out.inError = (data[1] & 0x80) === 0x80;
    out.timerMode = (data[1] & 0x10) === 0x10;
    out.fastCheck = (data[1] & 0x20) === 0x20;
    out.iMode = (data[1] & 0x04) === 0x04;
    out.powerOn = (data[1] & 0x01) === 0x01;

    out.mode = data[2] & 0x0F;
    out.modeFc = (data[2] & 0xF0) >> 4;
    out.fanSpeed = data[3] & 0x7F;

    out.onTimer = (data[4] & 0x80) === 0x80;
    out.onTimerHours = (data[4] & 0x7C) >> 2;
    out.onTimerMinutes = (data[4] & 0x03) * 15 + ((data[6] & 0xF0) >> 4);
    out.offTimer = (data[5] & 0x80) === 0x80;
    out.offTimerHours = (data[5] & 0x7C) >> 2;
    out.offTimerMinutes = (data[5] & 0x03) * 15 + (data[6] & 0x0F);

    let target = data[7];
    if (target > 100) target = 100;
    out.targetHumidity = target;
    out.childLock = (data[8] & 0x80) > 0;

    out.filterIndicator = (data[9] & 0x80) === 0x80;
    out.ionMode = (data[9] & 0x40) === 0x40;
    out.sleepMode = (data[9] & 0x20) === 0x20;
    out.pumpSwitchFlag = (data[9] & 0x10) === 0x10;
    out.pumpSwitch = (data[9] & 0x08) === 0x08;
    // midea-local commit 91c3dde uses `pump` (0x08) and `pump_enable` (0x10)
    // for the same bits — expose both names so adapters that follow the
    // midea-local field set work unchanged.
    out.pump = out.pumpSwitch;
    out.pumpEnable = out.pumpSwitchFlag;
    out.displayClass = data[9] & 0x07;

    out.defrosting = (data[10] & 0x80) === 0x80;
    out.tankLevel = data[10] & 0x7F;
    out.tankFull = out.tankLevel >= 100;

    out.dustTime = data[11] * 2;
    out.rareShow = (data[12] & 0x38) >> 3;
    out.dust = data[12] & 0x07;
    out.pm25 = data[13] + data[14] * 256;
    out.tankWarningLevel = data[15];

    out.currentHumidity = data[16];

    let temp = (data[17] - 50) / 2;
    if (temp < -19) temp = -20;
    if (temp > 50) temp = 50;
    if (data.length > 18) {
        const dec = (data[18] & 0x0F) * 0.1;
        temp += temp >= 0 ? dec : -dec;
    }
    out.indoorTemperature = temp;

    if (data.length > 19) {
        out.lightClass = (data[19] & 0xC0) >> 6;
        out.verticalSwing = (data[19] & 0x20) === 0x20;
        out.horizontalSwing = (data[19] & 0x10) === 0x10;
    }
    if (data.length > 20) out.lightValue = data[20];
    if (data.length > 21) out.errorCode = data[21]; else out.errorCode = 0;

    return out;
}

/**
 * 0xFA fan response parser. Layout from midea-local FAGeneralMessageBody.
 * `data` is the inner body (with body_type at index 0).
 */
function parseFAResponse(data) {
    const out = {};
    if (!data || data.length < 9) return out;
    const lock = data[3] & 0x03;
    out.childLock = lock === 1;
    out.powerOn = (data[4] & 0x01) > 0;
    const mode = (data[4] & 0x1E) >> 1;
    out.modeIndex = mode > 0 ? mode - 1 : 0;
    const fanSpeed = data[5];
    out.fanSpeed = fanSpeed >= 1 && fanSpeed <= 26 ? fanSpeed : 0;
    out.oscillate = (data[8] & 0x01) > 0;
    out.oscillationAngleIndex = (data[8] & 0x70) >> 4;
    out.oscillationModeIndex = (data[8] & 0x0E) >> 1;
    out.tiltingAngleIndex = data.length > 25 ? data[25] : 0;
    return out;
}

/**
 * 0xFC purifier response parser. Layout from midea-local FCGeneralMessageBody +
 * FCNotifyMessageBody. `data` is the inner body (with body_type at index 0).
 */
function parseFCResponse(data) {
    const out = {};
    if (!data || data.length < 4) return out;
    out.powerOn = (data[1] & 0x01) > 0;
    out.modeRaw = data[2] & 0xF0;
    out.fanSpeed = data[3] & 0x7F;
    if (data.length > 9) out.screenDisplay = data[9] & 0x07;
    if (data.length > 14 && data[14] !== 0xFF) out.pm25 = data[13] + (data[14] << 8);
    if (data.length > 15 && data[15] !== 0xFF) out.tvoc = data[15];

    // Field positions differ between general (C8) and notify (A0) bodies.
    // The body_type byte sits at index 0; midea-local checks against ListTypes.A0/C8.
    const isNotify = data[0] === 0xA0;
    if (isNotify) {
        if (data.length > 10) {
            out.anion = (data[10] & 0x20) > 0;
            out.childLock = (data[10] & 0x10) > 0;
        }
        if (data.length > 22) {
            out.detectModeIndex = (data[1] & 0x08) > 0 ? data[22] + 1 : 0;
        }
        if (data.length > 27) {
            out.standby = (data[27] & 0x14) === 0xFF;
        }
        if (data.length > 31 && data[31] !== 0xFF) out.hcho = data[30] + (data[31] << 8);
    } else {
        if (data.length > 8) out.childLock = (data[8] & 0x80) > 0;
        if (data.length > 19) out.anion = (data[19] & 0x40) > 0;
        if (data.length > 23) out.filter1Life = data[23];
        if (data.length > 24) out.filter2Life = data[24];
        if (data.length > 29) {
            out.detectModeIndex = (data[1] & 0x08) > 0 ? data[29] + 1 : 0;
        }
        if (data.length > 34) {
            out.standby = (data[34] & 0xFF) === 0x14;
        }
        if (data.length > 38 && data[38] !== 0xFF) out.hcho = data[37] + (data[38] << 8);
    }
    return out;
}

/**
 * 0xFD humidifier response parser. Layout from midea-local FDC8MessageBody +
 * FDA0MessageBody. `data` is the inner body (with body_type at index 0).
 */
function parseFDResponse(data) {
    const out = {};
    if (!data || data.length < 18) return out;
    const isNotify = data[0] === 0xA0;
    out.powerOn = (data[1] & 0x01) > 0;
    const fs = data[3] & 0x7F;
    out.fanSpeed = fs < 5 ? 1 : fs;
    out.targetHumidity = data[7];
    out.tank = data[10];
    out.modeIndex = isNotify ? (data[10] & 0x07) : ((data[8] & 0x70) >> 4);
    out.screenDisplay = data[9] & 0x07;
    out.currentHumidity = data[16];
    out.currentTemperature = (data[17] - 50) / 2;
    if (isNotify) {
        if (data.length > 29) {
            const dis = data[27] & 0x03;
            if (dis) out.disinfect = dis === 1;
        }
    } else if (data.length > 36) {
        const dis = data[34] & 0x03;
        if (dis) out.disinfect = dis === 1;
    }
    return out;
}

/**
 * Dispatch a 0xAA framed response (header included) to the right body parser.
 * The first 10 bytes form the 0xAA header, the last byte is the checksum.
 *
 * AA header byte 9 is the message type — `0x03` = query response,
 * `0x02` = set response, `0x04` = notify1, `0x05` = notify2. midea-local
 * dispatches B5 differently depending on it: for query the body is a
 * capability list (XB5MessageBody), for query/set/notify2 paired with B0/B1
 * it's a NewProtocol parameter blob (XBXMessageBody). midea-local
 * message.py:1197.
 */
function parseFrame(frame, powerAnalysisMethod) {
    if (!frame || frame.length < 12) return { type: null };
    const msgType = frame[9];
    const body = frame.subarray(10, frame.length - 1);
    switch (body[0]) {
        case 0xB0:
            return { type: 0xB0, status: parseBX(body) };
        case 0xB1:
            return { type: 0xB1, status: parseBX(body) };
        case 0xB5:
            // notify2 carries NewProtocol data (XBX), not capability rows.
            if (msgType === 0x05) {
                return { type: 0xB5, status: parseBX(body) };
            }
            return { type: 0xB5, ...parseB5(body) };
        case 0xBB:
            // V2/SubProtocol body. midea-local switches to MessageSubProtocol*
            // for query/set when this body type is seen (devices/ac/message.py
            // XBBMessageBody, _used_subprotocol). We don't yet implement the
            // subprotocol set/query in this adapter — return the body so the
            // caller can log it for diagnostic purposes. A user reporting
            // unexpected 0xBB frames is the trigger to add full support.
            return { type: 0xBB, subprotocol: true, raw: body.toString("hex") };
        case 0xC0:
            return { type: 0xC0, status: parseC0(body) };
        case 0xC1:
            // Wrap C1 the same way C0/B0/B1 already are, so the device
            // layer can splat parsed.status into _mergeStatus without
            // maintaining a separate field whitelist.
            return { type: 0xC1, status: parseC1(body, powerAnalysisMethod) };
        default:
            return { type: body[0], unknown: body.toString("hex") };
    }
}

module.exports = {
    parseB5,
    parseC0,
    parseC1,
    parseBX,
    parseNewProtocolParams,
    parseA1Response,
    parseFAResponse,
    parseFCResponse,
    parseFDResponse,
    parseFrame,
    NEW_PROTOCOL_TAGS,
    POWER_FORMATS,
};
