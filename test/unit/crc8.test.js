"use strict";

const assert = require("node:assert/strict");
const { calculateCrc } = require("../../lib/midea/packet");

// Vector taken verbatim from midea-local tests/crc8_test.py.
describe("crc8", function () {
    it("computes the documented vector", function () {
        const data = Buffer.from([0x5A, 0x82, 0x01, 0x11, 0xFF, 0x20]);
        assert.equal(calculateCrc(data), 101);
    });
});
