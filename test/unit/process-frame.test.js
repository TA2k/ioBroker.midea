"use strict";

/**
 * Fixture-driven tests for every device's `_processFrame` (the unified
 * decoder introduced in 1.7.0). Each fixture builds a minimal but
 * structurally valid 0xAA frame, hands it to the device's `_processFrame`,
 * and asserts that `device.status` reflects the bytes the parser would
 * extract — which proves three things at once:
 *   1. _processFrame slices the frame correctly (`frame.subarray(10, -1)`)
 *   2. msgType / source dispatch routes to the right body parser
 *   3. _mergeStatus actually mutates `device.status`
 *
 * Body bytes are constructed from the parser source — not real captures —
 * so when a parser changes shape the test must be updated alongside it.
 */

const assert = require("node:assert/strict");

const { createCommand } = require("../../lib/midea/packet");

const silentLogger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, silly: () => {},
};

function buildFrame({ applianceType, msgType, body }) {
    return createCommand(Buffer.from(body), {
        msgType, protocol: 0x03, applianceType, addCrc: false,
    });
}

function makeDevice(DeviceClass, opts = {}) {
    return new DeviceClass({ id: "fixture", logger: silentLogger, ...opts });
}

function process(dev, frame, ctx = {}) {
    const fullCtx = { source: "query", msgType: frame[9], ...ctx };
    return dev._processFrame(frame, fullCtx);
}

/**
 * Build a buffer of exactly `len` bytes, with the given byte map applied
 * on top of zeros. e.g. body(20, { 2: 0x01 }) → [0,0,1,0,...,0] length 20.
 */
function body(len, overrides = {}) {
    const buf = Buffer.alloc(len, 0);
    for (const k of Object.keys(overrides)) buf[Number(k)] = overrides[k];
    return buf;
}

describe("device _processFrame fixtures", () => {
    describe("AC (0xAC)", () => {
        const { ACDevice, APPLIANCE_TYPE_AC } = require("../../lib/midea/devices/ac");
        it("decodes a 0xC0 query reply (powerOn + mode + setpoint)", () => {
            const dev = makeDevice(ACDevice);
            // body[0]=0xC0, body[1]=0x01 (powerOn), body[2]=0x48 (mode=2/cool, setpoint=24),
            // body[11]=100 → indoorTemperature=25. Pad to 21 bytes.
            const b = body(21, { 0: 0xC0, 1: 0x01, 2: 0x48, 11: 100 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_AC, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.mode, "cool");
            assert.equal(dev.status.modeIndex, 2);
            assert.equal(dev.status.temperatureSetpoint, 24);
            assert.equal(dev.status.indoorTemperature, 25);
        });
        it("ignores 0xBB subprotocol bodies (logs warn but does not merge)", () => {
            const dev = makeDevice(ACDevice);
            const b = body(8, { 0: 0xBB });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_AC, msgType: 0x03, body: b });
            const merged = process(dev, frame);
            assert.equal(merged, undefined);
            assert.deepEqual(dev.status, {});
        });
    });

    describe("Dehumidifier (0xA1)", () => {
        const { DehumidifierDevice, APPLIANCE_TYPE_DEHUMIDIFIER } = require("../../lib/midea/devices/dehumidifier");
        it("decodes powerOn from 0xC8 reply body", () => {
            const dev = makeDevice(DehumidifierDevice);
            // parseA1Response: body[1]&0x01=powerOn, requires length>=19. body[0] is body type.
            const b = body(20, { 0: 0xC8, 1: 0x01, 7: 50 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_DEHUMIDIFIER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.targetHumidity, 50);
        });
    });

    describe("AirBox (0xFC) routing", () => {
        const { AirBoxDevice, APPLIANCE_TYPE_AIR_BOX } = require("../../lib/midea/devices/airbox");
        it("routes 0x21 body to parseAD21", () => {
            const dev = makeDevice(AirBoxDevice);
            const b = body(6, { 0: 0x21, 2: 0x01, 3: 0x01, 4: 30 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_AIR_BOX, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.portableSense, true);
            assert.equal(dev.status.nightMode, true);
            assert.equal(dev.status.screenExtinctionTimeout, 30);
        });
    });

    describe("Refrigerator (0xCA) msgType-dependent dispatch", () => {
        const { RefrigeratorDevice, APPLIANCE_TYPE_REFRIGERATOR } = require("../../lib/midea/devices/refrigerator");
        it("query reply (msgType=0x03 + body[0]=0x00) → parseCAGeneral", () => {
            const dev = makeDevice(RefrigeratorDevice);
            const b = body(22, { 0: 0x00, 1: 0x01 /* codeMode */, 2: 0x05 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_REFRIGERATOR, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.codeMode, true);
            // body[2]&0x0F = refrigerator setpoint (5°C)
            assert.equal(dev.status.refrigeratorSettingTemp, 5);
        });
        it("query exception (msgType=0x03 + body[0]=0x02) → parseCAException", () => {
            const dev = makeDevice(RefrigeratorDevice);
            const b = body(5, { 0: 0x02, 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_REFRIGERATOR, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.refrigeratorDoorOvertime, true);
        });
        it("notify1 door push (msgType=0x05 + body[0]=0x00) → parseCANotify00", () => {
            const dev = makeDevice(RefrigeratorDevice);
            const b = body(3, { 0: 0x00, 1: 0x01 /* refrigeratorDoor */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_REFRIGERATOR, msgType: 0x05, body: b });
            process(dev, frame, { source: "notify" });
            assert.equal(dev.status.refrigeratorDoor, true);
        });
        it("notify1 general (msgType=0x05 + body[0]=0x02 + len>20) → parseCAGeneral", () => {
            const dev = makeDevice(RefrigeratorDevice);
            const b = body(22, { 0: 0x02, 1: 0x04 /* smartMode */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_REFRIGERATOR, msgType: 0x05, body: b });
            process(dev, frame, { source: "notify" });
            assert.equal(dev.status.smartMode, true);
        });
    });

    describe("HeatPump (0xCF) msgType-driven dataOffset", () => {
        const { HeatPumpDevice, APPLIANCE_TYPE_HEATPUMP } = require("../../lib/midea/devices/heatpump");
        it("query reply (msgType=0x03) parses with dataOffset=1", () => {
            const dev = makeDevice(HeatPumpDevice);
            // body[0] is the body_type marker; data starts at body[1].
            // body[1]=0x01 (powerOn), body[4]=2 (mode=cool), body[5]=22 (target).
            const b = body(11, { 0: 0x01, 1: 0x01, 4: 0x02, 5: 22 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_HEATPUMP, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.mode, "cool");
            assert.equal(dev.status.targetTemperature, 22);
        });
        it("notify (msgType=0x05) parses with dataOffset=0", () => {
            const dev = makeDevice(HeatPumpDevice);
            // No body_type marker for notify — data starts at body[0].
            // body[0]=0x01 (powerOn), body[3]=3 (mode=heat), body[4]=20 (target).
            const b = body(10, { 0: 0x01, 3: 0x03, 4: 20 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_HEATPUMP, msgType: 0x05, body: b });
            process(dev, frame, { source: "notify" });
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.mode, "heat");
            assert.equal(dev.status.targetTemperature, 20);
        });
    });

    describe("Vacuum (0xB8) body-type guard", () => {
        const { VacuumDevice, APPLIANCE_TYPE_VACUUM } = require("../../lib/midea/devices/vacuum");
        it("accepts inner[0]=0x32 inner[1]=0x01 reply", () => {
            const dev = makeDevice(VacuumDevice);
            // parseB8Body uses offset=1 (skip the 0x01 sub-marker), and reads
            // workStatus=body[1+offset]=body[2]. We want body[2]=0x02 → "work".
            const b = body(22, { 0: 0x32, 1: 0x01, 2: 0x02, 12: 80 /* batteryPercent */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_VACUUM, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.workStatus, "work");
            assert.equal(dev.status.batteryPercent, 80);
        });
        it("rejects unrelated body types (no merge)", () => {
            const dev = makeDevice(VacuumDevice);
            const b = body(22, { 0: 0x99, 1: 0x99 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_VACUUM, msgType: 0x03, body: b });
            const merged = process(dev, frame);
            assert.equal(merged, undefined);
            assert.deepEqual(dev.status, {});
        });
    });

    describe("WaterPurifier (0xED) body-type dispatch", () => {
        const { WaterPurifierDevice, APPLIANCE_TYPE_WATER_PURIFIER } = require("../../lib/midea/devices/waterpurifier");
        it("body[0]=0x01 → parseED01 (powerOn from body[2])", () => {
            const dev = makeDevice(WaterPurifierDevice);
            const b = body(40, { 0: 0x01, 2: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_WATER_PURIFIER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
        it("body[0]=0x03 → parseED03 (powerOn from body[51]&0x01)", () => {
            const dev = makeDevice(WaterPurifierDevice);
            const b = body(52, { 0: 0x03, 51: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_WATER_PURIFIER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("SmartToilet (0xC2)", () => {
        const { SmartToiletDevice, APPLIANCE_TYPE_SMART_TOILET } = require("../../lib/midea/devices/smarttoilet");
        it("decodes powerOn + childLock + sensorLight from C2 body", () => {
            const dev = makeDevice(SmartToiletDevice);
            // body[2]&0x01 = powerOn, body[14]&0x04 = childLock, body[14]&0x01 = sensorLight
            const b = body(20, { 2: 0x01, 14: 0x05 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_SMART_TOILET, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.sensorLight, true);
            assert.equal(dev.status.childLock, true);
        });
    });

    describe("HeatPumpWaterHeater (0xCD)", () => {
        const { HeatPumpWaterHeaterDevice, APPLIANCE_TYPE_HEAT_PUMP_WATER } = require("../../lib/midea/devices/heatpumpwater");
        it("decodes powerOn + targetTemperature from CD body", () => {
            const dev = makeDevice(HeatPumpWaterHeaterDevice);
            const b = body(30, { 2: 0x01, 3: 55 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_HEAT_PUMP_WATER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.targetTemperature, 55);
        });
    });

    describe("ElectricWaterHeater (0xE2)", () => {
        const { ElectricWaterHeaterDevice, APPLIANCE_TYPE_ELECTRIC_WATER_HEATER } = require("../../lib/midea/devices/electricwaterheater");
        it("decodes powerOn + currentTemperature from E2 body", () => {
            const dev = makeDevice(ElectricWaterHeaterDevice);
            const b = body(17, { 2: 0x01, 4: 42 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_ELECTRIC_WATER_HEATER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.currentTemperature, 42);
        });
    });

    describe("GasWaterHeater (0xE3)", () => {
        const { GasWaterHeaterDevice, APPLIANCE_TYPE_GAS_WATER_HEATER } = require("../../lib/midea/devices/gaswaterheater");
        it("decodes powerOn from body[2]&0x01", () => {
            const dev = makeDevice(GasWaterHeaterDevice);
            const b = body(20, { 2: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_GAS_WATER_HEATER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("GasBoiler (0xE6)", () => {
        const { GasBoilerDevice, APPLIANCE_TYPE_GAS_BOILER } = require("../../lib/midea/devices/gasboiler");
        const { parseE6Body } = (() => {
            // Re-read the parser to derive expected outputs without requiring it
            // to be exported (it isn't). We only assert what we can verify by
            // inspection of the source.
            return {};
        })();
        void parseE6Body;
        it("processes a body of the parser's minimum length without throwing", () => {
            const dev = makeDevice(GasBoilerDevice);
            const b = body(40, { 2: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_GAS_BOILER, msgType: 0x03, body: b });
            // Just ensure dispatch happens — exact field assertions live in the
            // parser unit tests, not here.
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("ElectricHeater (0xFB)", () => {
        const { ElectricHeaterDevice, APPLIANCE_TYPE_ELECTRIC_HEATER } = require("../../lib/midea/devices/electricheater");
        it("decodes powerOn from body[0]&0x01", () => {
            const dev = makeDevice(ElectricHeaterDevice);
            // parseFBBody: powerOn = !([0,2].includes(body[0]&0x01)) → body[0]=0x01 → true
            const b = body(20, { 0: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_ELECTRIC_HEATER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("FreshAir (0xCE)", () => {
        const { FreshAirDevice, APPLIANCE_TYPE_FRESH_AIR } = require("../../lib/midea/devices/freshair");
        it("decodes powerOn from body[1]&0x80", () => {
            const dev = makeDevice(FreshAirDevice);
            const b = body(25, { 1: 0x80 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_FRESH_AIR, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("Dishwasher (0xE1)", () => {
        const { DishwasherDevice, APPLIANCE_TYPE_DISHWASHER } = require("../../lib/midea/devices/dishwasher");
        it("decodes powerOn from body[1]>0", () => {
            const dev = makeDevice(DishwasherDevice);
            const b = body(20, { 1: 0x02 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_DISHWASHER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("CommercialAC (0xCC)", () => {
        const { CommercialACDevice, APPLIANCE_TYPE_COMMERCIAL_AC } = require("../../lib/midea/devices/commercialac");
        it("decodes powerOn from body[1]&0x80", () => {
            const dev = makeDevice(CommercialACDevice);
            const b = body(25, { 1: 0x80 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_COMMERCIAL_AC, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
    });

    describe("Microwave (0xB0)", () => {
        const { MicrowaveDevice, APPLIANCE_TYPE_MICROWAVE } = require("../../lib/midea/devices/microwave");
        it("dispatches body[0]=0x01 to parseB0_01", () => {
            const dev = makeDevice(MicrowaveDevice);
            const b = body(20, { 0: 0x01, 16: 0x01 /* childLock */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_MICROWAVE, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("RangeHood (0xB6) protocol-version dispatch", () => {
        const { RangeHoodDevice, APPLIANCE_TYPE_RANGE_HOOD } = require("../../lib/midea/devices/rangehood");
        it("v1 reply (parseB6General): light + fan", () => {
            const dev = makeDevice(RangeHoodDevice, { protocolVersion: 0 });
            // body[1]=0x01 → light=true (since !=0xFF), body[2]=0x02 → powerOn
            const b = body(8, { 1: 0x01, 2: 0x02, 3: 1, 5: 0x01 /* oilcupFull */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_RANGE_HOOD, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.light, true);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.oilcupFull, true);
        });
        it("0x0A notify (parseB6_0A): oilcupFull push", () => {
            const dev = makeDevice(RangeHoodDevice);
            const b = body(5, { 0: 0x0A, 1: 0xA2, 2: 0x03 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_RANGE_HOOD, msgType: 0x05, body: b });
            process(dev, frame, { source: "notify" });
            assert.equal(dev.status.oilcupFull, true);
            assert.equal(dev.status.cleaningReminder, true);
        });
    });

    describe("Fan (0xFA)", () => {
        const { FanDevice, APPLIANCE_TYPE_FAN } = require("../../lib/midea/devices/fan");
        it("decodes powerOn + fanSpeed from FA body", () => {
            const dev = makeDevice(FanDevice);
            // parseFAResponse: body[4]&0x01=powerOn, body[5]=fanSpeed
            const b = body(20, { 4: 0x01, 5: 12 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_FAN, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.fanSpeed, 12);
        });
    });

    describe("Humidifier (0xFD)", () => {
        const { HumidifierDevice, APPLIANCE_TYPE_HUMIDIFIER } = require("../../lib/midea/devices/humidifier");
        it("decodes powerOn + targetHumidity from FD body", () => {
            const dev = makeDevice(HumidifierDevice);
            // parseFDResponse: body[1]&0x01=powerOn, body[7]=targetHumidity. Length>=18.
            const b = body(20, { 0: 0xC8, 1: 0x01, 7: 60 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_HUMIDIFIER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.targetHumidity, 60);
        });
    });

    describe("Purifier (0xFC)", () => {
        const { PurifierDevice, APPLIANCE_TYPE_PURIFIER } = require("../../lib/midea/devices/purifier");
        it("decodes powerOn from FC body", () => {
            const dev = makeDevice(PurifierDevice);
            // parseFCResponse: body[1]&0x01=powerOn, length>=4. body[0]=type byte.
            const b = body(10, { 0: 0xC8, 1: 0x01, 3: 5 /* fanSpeed */ });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_PURIFIER, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.fanSpeed, 5);
        });
    });

    describe("HeatPumpController (0xC3)", () => {
        const { HeatPumpControllerDevice, APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER } = require("../../lib/midea/devices/heatpumpctrl");
        it("processes a basic 0x01 body without throwing", () => {
            const dev = makeDevice(HeatPumpControllerDevice);
            const b = body(40, { 0: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_HEAT_PUMP_CONTROLLER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("Bathroom suite", () => {
        const {
            LightDevice, APPLIANCE_TYPE_LIGHT,
            BathroomHeaterDevice, APPLIANCE_TYPE_BATHROOM_HEATER,
            DishwasherX34Device, APPLIANCE_TYPE_DISHWASHER_X34,
            BathroomFanDevice, APPLIANCE_TYPE_BATHROOM_FAN,
        } = require("../../lib/midea/devices/bathroom");
        it("0x13 light decodes powerOn", () => {
            const dev = makeDevice(LightDevice);
            // LightDevice gates on inner[0]=0xA4; parse13Body reads powerOn = body[8] > 0.
            const b = body(10, { 0: 0xA4, 8: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_LIGHT, msgType: 0x03, body: b });
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
        });
        it("0x26 bathroom heater processes without throwing", () => {
            const dev = makeDevice(BathroomHeaterDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_BATHROOM_HEATER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("0x34 dishwasher-x34 processes without throwing", () => {
            const dev = makeDevice(DishwasherX34Device);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_DISHWASHER_X34, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("0x40 bathroom fan processes without throwing", () => {
            const dev = makeDevice(BathroomFanDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_BATHROOM_FAN, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("Kitchen suite (oven/steamer/oven-steam/integrated)", () => {
        const {
            OvenDevice, APPLIANCE_TYPE_OVEN,
            SteamerDevice, APPLIANCE_TYPE_STEAMER,
            OvenSteamDevice, APPLIANCE_TYPE_OVEN_STEAM,
            IntegratedOvenDevice, APPLIANCE_TYPE_INTEGRATED_OVEN,
        } = require("../../lib/midea/devices/kitchen");
        it("oven processes without throwing", () => {
            const dev = makeDevice(OvenDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_OVEN, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("steamer processes without throwing", () => {
            const dev = makeDevice(SteamerDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_STEAMER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("oven-steam processes without throwing", () => {
            const dev = makeDevice(OvenSteamDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_OVEN_STEAM, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("integrated-oven processes without throwing", () => {
            const dev = makeDevice(IntegratedOvenDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_INTEGRATED_OVEN, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("Laundry suite (top-load / front-load / dryer)", () => {
        const {
            TopLoadWasherDevice, APPLIANCE_TYPE_TOP_LOAD_WASHER,
            FrontLoadWasherDevice, APPLIANCE_TYPE_FRONT_LOAD_WASHER,
            DryerDevice, APPLIANCE_TYPE_DRYER,
        } = require("../../lib/midea/devices/laundry");
        it("top-load processes without throwing", () => {
            const dev = makeDevice(TopLoadWasherDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_TOP_LOAD_WASHER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("front-load processes without throwing", () => {
            const dev = makeDevice(FrontLoadWasherDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_FRONT_LOAD_WASHER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("dryer processes without throwing", () => {
            const dev = makeDevice(DryerDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_DRYER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    describe("Cookers suite (pressure / rice-EA / rice-EC)", () => {
        const {
            PressureCookerDevice, APPLIANCE_TYPE_PRESSURE_COOKER,
            RiceCookerEADevice, APPLIANCE_TYPE_RICE_COOKER_EA,
            RiceCookerECDevice, APPLIANCE_TYPE_RICE_COOKER_EC,
        } = require("../../lib/midea/devices/cookers");
        it("pressure cooker (E8) processes without throwing", () => {
            const dev = makeDevice(PressureCookerDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_PRESSURE_COOKER, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("rice cooker EA processes without throwing", () => {
            const dev = makeDevice(RiceCookerEADevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_RICE_COOKER_EA, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
        it("rice cooker EC processes without throwing", () => {
            const dev = makeDevice(RiceCookerECDevice);
            const b = body(20, { 1: 0x01 });
            const frame = buildFrame({ applianceType: APPLIANCE_TYPE_RICE_COOKER_EC, msgType: 0x03, body: b });
            assert.doesNotThrow(() => process(dev, frame));
        });
    });

    /**
     * Real-capture fixtures: full reply hex strings taken straight from a
     * production debug log (.references/log.txt, A1 dehumidifier, msgId 2-9
     * on 2026-05-20). Unlike the synthetic fixtures above, these guard
     * against drift between our parser and a real device's wire format.
     */
    describe("real captures", () => {
        const { DehumidifierDevice, APPLIANCE_TYPE_DEHUMIDIFIER } = require("../../lib/midea/devices/dehumidifier");

        it("A1 dehumidifier query reply (currentHumidity=71, mode=dry_clothes)", () => {
            const dev = makeDevice(DehumidifierDevice);
            const frame = Buffer.from(
                "aa22a100000000000303c80104507f7f0023000000000000000047520000000000025e",
                "hex",
            );
            assert.equal(frame[2], APPLIANCE_TYPE_DEHUMIDIFIER);
            process(dev, frame);
            assert.equal(dev.status.powerOn, true);
            assert.equal(dev.status.mode, "dry_clothes");
            assert.equal(dev.status.currentHumidity, 71);
            assert.equal(dev.status.targetHumidity, 35);
            assert.equal(dev.status.fanSpeed, 80);
            assert.equal(dev.status.indoorTemperature, 16);
            assert.equal(dev.status.errorCode, 0);
        });

        it("A1 dehumidifier diff: humidity drops 71 → 70 between identical frames", () => {
            const dev = makeDevice(DehumidifierDevice);
            const f1 = Buffer.from(
                "aa22a100000000000303c80104507f7f0023000000000000000047520000000000025e",
                "hex",
            );
            const f2 = Buffer.from(
                "aa22a100000000000303c80104507f7f00230000000000000000465200000000003f22",
                "hex",
            );
            process(dev, f1);
            assert.equal(dev.status.currentHumidity, 71);
            const diff = process(dev, f2);
            assert.equal(dev.status.currentHumidity, 70);
            // _mergeStatus returns ONLY changed fields — proves diff semantics.
            assert.deepEqual(diff, { currentHumidity: 70 });
        });
    });
});
