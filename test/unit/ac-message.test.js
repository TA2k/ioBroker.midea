"use strict";

const assert = require("node:assert/strict");

const { ACDevice } = require("../../lib/midea/devices/ac");
const { calculateCrc, calculateChecksum } = require("../../lib/midea/packet");
const { parseFrame, NEW_PROTOCOL_TAGS } = require("../../lib/midea/parsers");

const silentLogger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, silly: () => {},
};

function makeDevice(overrides = {}) {
    const dev = new ACDevice({ id: "1", logger: silentLogger, ...overrides });
    return dev;
}

/**
 * Strip the 0xAA header (10 bytes), trailing CRC8 (1 byte) and trailing
 * checksum (1 byte) from a `createCommand` buffer to recover the inner
 * body that protocol comparisons are written against.
 */
function unwrapBody(cmd) {
    return cmd.subarray(10, cmd.length - 2);
}

/**
 * Capture the buffer that setStatus/setNewProtocol would send by stubbing
 * out the LAN request layer and capturing the cmd argument.
 */
function captureSetCommand(dev, replyFrame) {
    let captured = null;
    dev._request = async (cmd, _label) => {
        captured = cmd;
        return replyFrame || Buffer.alloc(0);
    };
    return () => captured;
}

/**
 * Build a synthetic 0xC0 reply that parseFrame will accept (so setStatus
 * doesn't throw on an unknown response). 24-byte body with body[0]=0xC0.
 */
function fakeC0Reply() {
    const header = Buffer.from([0xAA, 0x00, 0xAC, 0, 0, 0, 0, 0, 0x03, 0x05]);
    const body = Buffer.alloc(24);
    body[0] = 0xC0;
    body[2] = 0x00; // mode=0 → "off"
    const bodyWithCrc = Buffer.concat([body, Buffer.from([calculateCrc(body)])]);
    const full = Buffer.concat([header, bodyWithCrc]);
    full[1] = full.length;
    return Buffer.concat([full, Buffer.from([calculateChecksum(full)])]);
}

describe("AC MessageGeneralSet (0x40 body)", function () {
    it("default body matches midea-local layout (power/mode/temp/swing defaults)", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setStatus({ powerOn: false, mode: "auto", temperatureSetpoint: 20, fanSpeed: "auto" });
        const cmd = getCmd();
        assert.ok(cmd, "expected captured cmd");
        const body = unwrapBody(cmd);
        // Last byte of body is the message_id (incrementing); strip for comparison.
        const stable = body.subarray(0, body.length - 1);

        // Byte 0: body_type
        assert.equal(stable[0], 0x40);
        // Byte 1: power_off, prompt_tone on, plus our project-specific 0x02 marker.
        // (Python uses just 0x40 for prompt_tone — the extra 0x02 is a historical adapter quirk.)
        assert.equal(stable[1], 0x40 | 0x02);
        // Byte 2: mode=auto(1) << 5, temp=20 → ((20 & 0xF) | 0)
        assert.equal(stable[2] & 0xE0, (1 << 5) & 0xE0);
        assert.equal(stable[2] & 0x1F, (20 - 16) & 0xF);
        // Byte 3: fanSpeed = 102 (auto) & 0x7F
        assert.equal(stable[3], 102 & 0x7F);
        // Byte 7: swing default is 0x30
        assert.equal(stable[7], 0x30);
        // Bytes that should be zero by default — confirms no stale 0x80 on byte 22.
        assert.equal(stable[17], 0x00, "byte 17 (natural_wind) should be 0 by default");
        assert.equal(stable[21], 0x00, "byte 21 (frost_protect) should be 0 by default");
        assert.equal(stable[22], 0x00, "byte 22 (comfort_mode) must be 0 by default — verifies Codex critical #2");
    });

    it("comfortMode flips byte 22 bit 0x01 (per midea-local MessageGeneralSet)", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setStatus({ comfortMode: true });
        const body = unwrapBody(getCmd());
        assert.equal(body[22], 0x01, "comfortMode=true must set byte 22 to 0x01");
    });

    it("frostProtection flips byte 21 bit 0x80", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setStatus({ frostProtection: true });
        const body = unwrapBody(getCmd());
        assert.equal(body[21], 0x80);
    });

    it("naturalWind flips byte 17 bit 0x40", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setStatus({ naturalWind: true });
        const body = unwrapBody(getCmd());
        assert.equal(body[17], 0x40);
    });

    it("smartEye, dryClean, auxHeating, ecoMode set the correct bits on byte 9", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setStatus({ smartEye: true, dryClean: true, auxHeating: true, ecoMode: true });
        const body = unwrapBody(getCmd());
        // smart_eye=0x01, dry=0x04, aux_heating=0x08, eco_mode=0x80 → 0x8D
        assert.equal(body[9] & 0x8D, 0x8D);
    });
});

describe("AC MessageNewProtocolSet (0xB0 body)", function () {
    it("indirectWind=true produces a 4-byte pack header [lo,hi,len,...val] (Codex critical #1)", async function () {
        // Python MessageNewProtocolSet uses NewProtocolMessageBody.pack(...) with
        // the default pack_len=4 — that yields a 3-byte header [lo, hi, len]
        // followed by the value (total 4 bytes for a 1-byte value, hence the
        // FOUR enum name). Our adapter previously emitted a 4-byte header
        // [lo, hi, 0x00, len] (FIVE-style), which corrupts the wire payload.
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setNewProtocol({ indirectWind: true });
        const body = unwrapBody(getCmd());
        // Body layout: [0xB0, count=1, lo, hi, len, value, msgId]
        assert.equal(body[0], 0xB0);
        assert.equal(body[1], 0x01, "count");
        assert.equal(body[2], NEW_PROTOCOL_TAGS.indirect_wind & 0xFF, "param low byte");
        assert.equal(body[3], (NEW_PROTOCOL_TAGS.indirect_wind >> 8) & 0xFF, "param high byte");
        assert.equal(body[4], 0x01, "value length (FOUR-style: byte right after param, no 0x00 padding)");
        assert.equal(body[5], 0x02, "indirect_wind=true value (0x02)");
        // body.length = 7 (6 bytes header+pack + 1 msgId) — proves no extra 0x00 byte.
        assert.equal(body.length, 7, "body must be 7 bytes — extra 0x00 indicates FIVE-style pack");
    });

    it("multiple updates pack consecutively with the correct count", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setNewProtocol({ breezeless: true, indirectWind: false });
        const body = unwrapBody(getCmd());
        assert.equal(body[0], 0xB0);
        assert.equal(body[1], 0x02, "count = 2");
        // pack 0: breezeless (0x0018) value=0x01
        assert.equal(body[2], NEW_PROTOCOL_TAGS.breezeless & 0xFF);
        assert.equal(body[3], (NEW_PROTOCOL_TAGS.breezeless >> 8) & 0xFF);
        assert.equal(body[4], 0x01);
        assert.equal(body[5], 0x01);
        // pack 1: indirect_wind (0x0042) value=0x01 (false)
        assert.equal(body[6], NEW_PROTOCOL_TAGS.indirect_wind & 0xFF);
        assert.equal(body[7], (NEW_PROTOCOL_TAGS.indirect_wind >> 8) & 0xFF);
        assert.equal(body[8], 0x01);
        assert.equal(body[9], 0x01);
    });

    it("setNewProtocol no-ops when updates is empty", async function () {
        const dev = makeDevice();
        let called = false;
        dev._request = async () => { called = true; return Buffer.alloc(0); };
        await dev.setNewProtocol({});
        assert.equal(called, false, "no LAN request should be issued for empty updates");
    });

    it("partial freshAir update preserves the other field from this.status (Gemini finding)", async function () {
        // freshAir power+speed are sent in one wire pack — updating only one
        // must NOT clobber the other to 0 / off.
        const dev = makeDevice();
        dev.status.freshAirPower = true;
        dev.status.freshAirFanSpeed = 60;
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setNewProtocol({ freshAirFanSpeed: 80 });
        const body = unwrapBody(getCmd());
        // body layout: [0xB0, count, ...packs, msgId]; first pack is fresh_air_1.
        // pack header (FOUR-style): [lo, hi, len], then payload [power, speed, ...].
        // power byte is at offset 2+3 = 5, speed at offset 6.
        assert.equal(body[2], NEW_PROTOCOL_TAGS.fresh_air_1 & 0xFF);
        assert.equal(body[3], (NEW_PROTOCOL_TAGS.fresh_air_1 >> 8) & 0xFF);
        assert.equal(body[5], 0x02, "freshAirPower must stay ON when only speed is updated");
        assert.equal(body[6], 80, "speed must reflect the requested value");
    });

    it("partial freshAir update preserves speed when only power is changed", async function () {
        const dev = makeDevice();
        dev.status.freshAirPower = false;
        dev.status.freshAirFanSpeed = 45;
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        await dev.setNewProtocol({ freshAirPower: true });
        const body = unwrapBody(getCmd());
        assert.equal(body[5], 0x02, "freshAirPower must turn ON");
        assert.equal(body[6], 45, "previous speed must be preserved when only power is updated");
    });
});

describe("AC NewProtocol parse (parseBX via parseFrame)", function () {
    function buildB0Reply(packs) {
        // Build a 0xB0 response body the way midea-local lays it out (FIVE-style: [lo,hi,0x00,len,...val] per pack).
        const header = Buffer.from([0xAA, 0x00, 0xAC, 0, 0, 0, 0, 0, 0x03, 0x05]);
        const inner = Buffer.concat([Buffer.from([0xB0, packs.length]), ...packs.map((p) => p)]);
        const bodyWithCrc = Buffer.concat([inner, Buffer.from([calculateCrc(inner)])]);
        const full = Buffer.concat([header, bodyWithCrc]);
        full[1] = full.length;
        return Buffer.concat([full, Buffer.from([calculateChecksum(full)])]);
    }

    function fivePack(param, valueBuf) {
        return Buffer.concat([Buffer.from([param & 0xFF, (param >> 8) & 0xFF, 0x00, valueBuf.length]), valueBuf]);
    }

    it("decodes indoor_humidity from a 0xB0 reply", function () {
        const reply = buildB0Reply([
            fivePack(NEW_PROTOCOL_TAGS.indoor_humidity, Buffer.from([42])),
        ]);
        const parsed = parseFrame(reply);
        assert.equal(parsed.type, 0xB0);
        assert.equal(parsed.status.indoorHumidity, 42);
    });

    it("decodes indirect_wind=true (value 0x02 → true) and false (0x01 → false)", function () {
        const replyTrue = buildB0Reply([fivePack(NEW_PROTOCOL_TAGS.indirect_wind, Buffer.from([0x02]))]);
        const replyFalse = buildB0Reply([fivePack(NEW_PROTOCOL_TAGS.indirect_wind, Buffer.from([0x01]))]);
        assert.equal(parseFrame(replyTrue).status.indirectWind, true);
        assert.equal(parseFrame(replyFalse).status.indirectWind, false);
    });

    it("decodes fresh_air_1 (10-byte value: power=2, speed)", function () {
        const value = Buffer.alloc(10);
        value[0] = 0x02; value[1] = 35;
        const reply = buildB0Reply([fivePack(NEW_PROTOCOL_TAGS.fresh_air_1, value)]);
        const status = parseFrame(reply).status;
        assert.equal(status.freshAirPower, true);
        assert.equal(status.freshAirFanSpeed, 35);
    });
});

describe("AC C1 power/runtime/humidity parsing", function () {
    function buildC1Reply(body) {
        const header = Buffer.from([0xAA, 0x00, 0xAC, 0, 0, 0, 0, 0, 0x00, 0x03]);
        const bodyWithCrc = Buffer.concat([body, Buffer.from([calculateCrc(body)])]);
        const full = Buffer.concat([header, bodyWithCrc]);
        full[1] = full.length;
        return Buffer.concat([full, Buffer.from([calculateChecksum(full)])]);
    }

    it("method=1 (BCD) — total/current energy parsed as BCD nibbles", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x44;
        // Total energy: BCD bytes 0x12, 0x34, 0x56, 0x78 = 12345678 / 100 = 123456.78
        body[4] = 0x12; body[5] = 0x34; body[6] = 0x56; body[7] = 0x78;
        // Current energy: 0x87, 0x65, 0x43, 0x21 = 87654321 / 100 = 876543.21
        body[12] = 0x87; body[13] = 0x65; body[14] = 0x43; body[15] = 0x21;
        // Realtime power: BCD 0x11, 0x22, 0x33 = 112233 / 10 = 11223.3
        body[16] = 0x11; body[17] = 0x22; body[18] = 0x33;
        const parsed = parseFrame(buildC1Reply(body), 1);
        assert.equal(parsed.type, 0xC1);
        assert.equal(parsed.totalEnergyConsumption.toFixed(2), "123456.78");
        assert.equal(parsed.currentEnergyConsumption.toFixed(2), "876543.21");
        assert.equal(parsed.realtimePower.toFixed(1), "11223.3");
    });

    it("method=3 (MIXED, default) — bytes treated as raw base-100 digits", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x44;
        // Total energy: 0x12*1e6 + 0x34*1e4 + 0x56*1e2 + 0x78 = 18*1e6 + 52*1e4 + 86*100 + 120 = 18,528,720 / 100 = 185287.20
        body[4] = 0x12; body[5] = 0x34; body[6] = 0x56; body[7] = 0x78;
        body[16] = 0x11; body[17] = 0x22; body[18] = 0x33;
        // Realtime: 0x11*1e4 + 0x22*1e2 + 0x33 = 17*10000 + 34*100 + 51 = 173,451 / 10 = 17345.1
        const parsed = parseFrame(buildC1Reply(body));
        assert.equal(parsed.totalEnergyConsumption.toFixed(2), "185287.20");
        assert.equal(parsed.realtimePower.toFixed(1), "17345.1");
    });

    it("method=2 (BINARY) — total/current as uint32_be / 10", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x44;
        body[4] = 0x01; body[5] = 0x23; body[6] = 0x45; body[7] = 0x67;
        body[16] = 0x12; body[17] = 0x34; body[18] = 0x56;
        const parsed = parseFrame(buildC1Reply(body), 2);
        assert.equal(parsed.totalEnergyConsumption, 0x01234567 / 10);
        assert.equal(parsed.realtimePower, 0x123456 / 10);
    });

    it("method=2 (BINARY) — high-bit-set values must not sign-extend (Gemini finding)", function () {
        // Bug: `byte + (value << 8)` accumulator goes negative once the top
        // byte has bit 7 set (e.g. 0xFF000000 << 0 → -16777216 in 32-bit signed
        // bitwise math). The fix uses arithmetic *256 to stay in float space.
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x44;
        body[4] = 0xFF; body[5] = 0xEE; body[6] = 0xDD; body[7] = 0xCC;
        const parsed = parseFrame(buildC1Reply(body), 2);
        assert.equal(parsed.totalEnergyConsumption, 0xFFEEDDCC / 10);
        assert.ok(parsed.totalEnergyConsumption > 0, "must be positive — sign-extended values would yield a negative number");
    });

    it("sub-body 0x40 → operating-time fields (in minutes)", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x40;
        // electrify: 1 day, 2 hours, 30 minutes, 0 seconds → 1*1440 + 120 + 30 = 1590 min
        body[4] = 0; body[5] = 1; body[6] = 2; body[7] = 30; body[8] = 0;
        const parsed = parseFrame(buildC1Reply(body));
        assert.equal(parsed.type, 0xC1);
        assert.equal(parsed.electrifyTime, 1590);
    });

    it("sub-body 0x45 → indoor humidity from byte 4", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x45;
        body[4] = 55;
        const parsed = parseFrame(buildC1Reply(body));
        assert.equal(parsed.indoorHumidity, 55);
    });

    it("sub-body 0x45 with humidity=0 reports no value (sensor absent)", function () {
        const body = Buffer.alloc(20);
        body[0] = 0xC1;
        body[3] = 0x45;
        body[4] = 0;
        const parsed = parseFrame(buildC1Reply(body));
        assert.equal(parsed.indoorHumidity, undefined);
    });
});

describe("AC PowerQuery body (0x41 0x21 0x01 0x44 0x00 0x01)", function () {
    // Python MessagePowerQuery._body == [0x41, 0x21, 0x01, 0x44, 0x00, 0x01].
    // We emit this directly inside refreshPowerUsage; pin it.
    it("matches the expected fixed payload", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        try { await dev.refreshPowerUsage(); } catch (_e) { /* unsupported reply, ignored */ }
        const cmd = getCmd();
        const body = unwrapBody(cmd);
        // body = [0x41, 0x21, 0x01, 0x44, 0x00, 0x01, crc8]  — but unwrapBody already
        // strips CRC and final checksum. Sub-body length = 6.
        assert.deepEqual(Array.from(body.subarray(0, 6)), [0x41, 0x21, 0x01, 0x44, 0x00, 0x01]);
    });
});

describe("AC HumidityQuery body (0x41 0x21 0x01 0x45 0x00 0x01)", function () {
    it("matches the midea-local MessageHumidityQuery payload", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        try { await dev.refreshHumidity(); } catch (_e) { /* swallow */ }
        const body = unwrapBody(getCmd());
        assert.deepEqual(Array.from(body.subarray(0, 6)), [0x41, 0x21, 0x01, 0x45, 0x00, 0x01]);
    });
});

describe("AC NewProtocolQuery body (0xB1 + 9 tags)", function () {
    it("emits all 9 NewProtocolTags in the documented order", async function () {
        const dev = makeDevice();
        const getCmd = captureSetCommand(dev, fakeC0Reply());
        try { await dev.refreshNewProtocol(); } catch (_e) { /* swallow */ }
        const body = unwrapBody(getCmd());
        // [0xB1, 0x09, lo, hi, lo, hi, ... ×9, msgId]
        assert.equal(body[0], 0xB1);
        assert.equal(body[1], 0x09);
        const expected = [
            NEW_PROTOCOL_TAGS.indirect_wind,
            NEW_PROTOCOL_TAGS.breezeless,
            NEW_PROTOCOL_TAGS.indoor_humidity,
            NEW_PROTOCOL_TAGS.screen_display,
            NEW_PROTOCOL_TAGS.fresh_air_1,
            NEW_PROTOCOL_TAGS.fresh_air_2,
            NEW_PROTOCOL_TAGS.wind_lr_angle,
            NEW_PROTOCOL_TAGS.wind_ud_angle,
            NEW_PROTOCOL_TAGS.out_silent,
        ];
        for (let i = 0; i < 9; i++) {
            assert.equal(body[2 + i * 2], expected[i] & 0xFF, `tag ${i} low byte`);
            assert.equal(body[3 + i * 2], (expected[i] >> 8) & 0xFF, `tag ${i} high byte`);
        }
    });
});
