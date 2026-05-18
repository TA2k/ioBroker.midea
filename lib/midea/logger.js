"use strict";

const NOOP = () => {};
const NOOP_LOGGER = Object.freeze({
    silly: NOOP,
    debug: NOOP,
    info: NOOP,
    warn: NOOP,
    error: NOOP,
});

/**
 * Wraps an ioBroker adapter logger or any object with debug/info/warn/error
 * into a uniform interface. Falls back to no-op when nothing usable is given.
 *
 * @param {object} [src]
 * @returns {{silly:Function,debug:Function,info:Function,warn:Function,error:Function}}
 */
function makeLogger(src) {
    if (!src) return NOOP_LOGGER;

    const debug = typeof src.debug === "function" ? src.debug.bind(src) : NOOP;
    const info = typeof src.info === "function" ? src.info.bind(src) : NOOP;
    const warn = typeof src.warn === "function" ? src.warn.bind(src) : NOOP;
    const error = typeof src.error === "function" ? src.error.bind(src) : NOOP;
    const silly = typeof src.silly === "function" ? src.silly.bind(src) : debug;

    return { silly, debug, info, warn, error };
}

module.exports = { makeLogger, NOOP_LOGGER };
