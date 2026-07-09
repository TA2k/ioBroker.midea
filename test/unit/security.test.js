"use strict";

const assert = require("node:assert/strict");

const { addHeader0x5A5A, buildHeartbeat0x5A5A } = require("../../lib/midea/security");
const { LanClient } = require("../../lib/midea/lan");

describe("midea LAN security framing", function () {
    it("writes midea-local compatible UTC timestamp bytes in the 5a5a header", function () {
        const RealDate = global.Date;
        const fixed = new RealDate("2026-07-09T10:11:12.987Z");

        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixed.getTime()]));
            }

            static now() {
                return fixed.getTime();
            }
        }

        global.Date = FixedDate;
        try {
            const packet = addHeader0x5A5A(Buffer.alloc(16), 1, "153931628657888");
            // [12]=hundredths(98, not raw ms 987), [13]=sec, [14]=min,
            // [15]=hour, [16]=day, [17]=month, [18]=YY, [19]=CC — all UTC.
            assert.deepEqual([...packet.subarray(12, 20)], [98, 12, 11, 10, 9, 7, 26, 20]);
        } finally {
            global.Date = RealDate;
        }
    });

    it("builds a 5a5a heartbeat packet (type 0x10, body 0x7b) with the 8-byte LE device id", function () {
        const hb = buildHeartbeat0x5A5A("153931628657888");
        assert.equal(hb[0], 0x5a);
        assert.equal(hb[1], 0x5a);
        assert.equal(hb[3], 0x10, "heartbeat message type");
        assert.equal(hb[6], 0x7b, "heartbeat body marker");
        // device id little-endian in [20..27]
        assert.equal(hb.subarray(20, 28).toString("hex"), "e0bc0b00008c0000");
        // 40-byte header + 16-byte MD5 checksum
        assert.equal(hb.length, 56);
    });

    it("starts the 8370 request counter at zero like midea-local", function () {
        const client = new LanClient({
            host: "127.0.0.1",
            deviceId: "153931628657888",
            protocol: 3,
            token: "00".repeat(32),
            key: "11".repeat(32),
            logger: { debug() {}, info() {}, warn() {}, error() {}, silly() {} },
        });

        assert.equal(client._nextRequestCount(), 0);
        assert.equal(client._nextRequestCount(), 1);
    });
});
