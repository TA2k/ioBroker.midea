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

    status.indoorTemperature = (data[11] - 50) / 2;
    status.outdoorTemperature = (data[12] - 50) / 2;

    status.dustFull = (data[13] & 0x20) === 0x20;
    if ((data[13] & 0x1F) > 0) {
        status.temperatureSetpoint = (data[13] & 0x1F) + 12;
    }

    status.light = (data[14] & 0x70) >> 4;
    status.pmv = data[14] & 0x0F;

    const indoorDecimal = data[15] & 0x0F;
    const outdoorDecimal = (data[15] & 0xF0) >> 4;
    status.indoorTemperature += status.indoorTemperature >= 0 ? indoorDecimal / 10 : -indoorDecimal / 10;
    status.outdoorTemperature += status.outdoorTemperature >= 0 ? outdoorDecimal / 10 : -outdoorDecimal / 10;

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
    }

    if (status.temperatureUnit) {
        status.temperatureSetpoint = Math.round(status.temperatureSetpoint * 1.8 + 32);
        status.indoorTemperature = Math.round(status.indoorTemperature * 1.8 + 32);
        status.outdoorTemperature = Math.round(status.outdoorTemperature * 1.8 + 32);
    }

    return status;
}

/**
 * Power-usage response (0xC1) parser. The last three bytes are BCD encoded
 * with a 1/10000 kWh resolution.
 */
function parseC1(data) {
    if (data.length < 19) return {};
    let n = 0;
    let m = 1;
    for (let i = 0; i < 3; i++) {
        n += (data[18 - i] & 0x0F) * m;
        n += ((data[18 - i] >> 4) & 0x0F) * m * 10;
        m *= 100;
    }
    return { powerUsage: n / 10000 };
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
    target += (data[8] & 0x0F) * 0.0625;
    out.targetHumidity = target;

    out.filterIndicator = (data[9] & 0x80) === 0x80;
    out.ionMode = (data[9] & 0x40) === 0x40;
    out.sleepMode = (data[9] & 0x20) === 0x20;
    out.pumpSwitchFlag = (data[9] & 0x10) === 0x10;
    out.pumpSwitch = (data[9] & 0x08) === 0x08;
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
    out.fanSpeed = data[3] & 0x7F;
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
 */
function parseFrame(frame) {
    if (!frame || frame.length < 12) return { type: null };
    const body = frame.subarray(10, frame.length - 1);
    switch (body[0]) {
        case 0xB5:
            return { type: 0xB5, ...parseB5(body) };
        case 0xC0:
            return { type: 0xC0, status: parseC0(body) };
        case 0xC1:
            return { type: 0xC1, ...parseC1(body) };
        default:
            return { type: body[0], unknown: body.toString("hex") };
    }
}

module.exports = { parseB5, parseC0, parseC1, parseA1Response, parseFAResponse, parseFCResponse, parseFDResponse, parseFrame };
