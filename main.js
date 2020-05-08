"use strict";

/*
 * Created with @iobroker/create-adapter v1.21.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const request = require("request");
const traverse = require("traverse");
const crypto = require("crypto");
class Midea extends utils.Adapter {
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "midea"
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.jar = request.jar();
        this.updateInterval = null;
        this.reauthInterval = null;
        this.atoken;
        this.sId;
        this.hgIdArray = [];
        this.appKey = "ff0cf6f5f0c3471de36341cab3f7a9af";
        this.baseHeader = {
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 7.0; SM-G935F Build/NRD90M)"
        };
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.login().then(() => {
            this.log.debug("Login successful");
            this.setState("info.connection", true, true);
            this.getUserList().then(()=>{});
            
        });

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");
    }
    login() {
        return new Promise((resolve, reject) => {
            this.jar = request.jar();
            const form = {
                loginAccount: this.config.user,
                clientType: "1",
                src: "17",
                appId: "1117",
                format: "2",
                stamp: this.getStamp(),
                language: "de_DE"
            };
            const url = "https://mapp.appsmb.com/v1/user/login/id/get";
            const sign = this.getSign(url, form);
            form.sign = sign;
            request.post(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true,
                    json: true,
                    form: form,
                    jar: this.jar,
                    gzip: true
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400) || !body) {
                        this.log.error("Failed to login");
                        err && this.log.error(err);
                        body && this.log.error(JSON.stringify(body));
                        resp && this.log.error(resp.statusCode);
                        reject();
                        return;
                    }
                    this.log.debug(JSON.stringify(body));
                    if (body.errorCode && body.errorCode !== "0") {
                        this.log.error(body.msg);
                        reject();
                        return;
                    }
                    if (body.result) {
                        const loginId = body.result.loginId;
                        const password = this.getSignPassword(loginId);
                        const form = {
                            loginAccount: this.config.user,
                            src: "17",
                            format: "2",
                            stamp: this.getStamp(),
                            language: "de_DE",
                            password: password,
                            clientType: "1",
                            appId: "1117"
                        };
                        const url = "https://mapp.appsmb.com/v1/user/login";
                        const sign = this.getSign(url, form);
                        form.sign = sign;
                        request.post(
                            {
                                url: url,
                                headers: this.baseHeader,
                                followAllRedirects: true,
                                json: true,
                                form: form,
                                jar: this.jar,
                                gzip: true
                            },
                            (err, resp, body) => {
                                if (err || (resp && resp.statusCode >= 400) || !body) {
                                    this.log.error("Failed to login");
                                    err && this.log.error(err);
                                    body && this.log.error(JSON.stringify(body));
                                    resp && this.log.error(resp.statusCode);
                                    reject();
                                    return;
                                }
                                this.log.debug(JSON.stringify(body));
                                if (body.errorCode && body.errorCode !== "0") {
                                    this.log.error(body.msg);
                                    reject();
                                    return;
                                }
                                if (body.result) {
                                    this.atoken = body.result.accessToken;
                                    this.sId = body.result.sessionId;
                                    this.generateDataKey();
                                    resolve();
                                }
                            }
                        );
                    }
                }
            );
        });
    }
    getUserList() {
        return new Promise((resolve, reject) => {
            const form = {
                src: "17",
                format: "2",
                stamp: this.getStamp(),
                language: "de_DE",
                sessionId: this.sId
            };
            const url = "https://mapp.appsmb.com/v1/appliance/user/list/get";
            const sign = this.getSign(url, form);
            form.sign = sign;
            request.post(
                {
                    url: url,
                    headers: this.baseHeader,
                    followAllRedirects: true,
                    json: true,
                    form: form,
                    jar: this.jar,
                    gzip: true
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400) || !body) {
                        this.log.error("Failed to login");
                        err && this.log.error(err);
                        body && this.log.error(JSON.stringify(body));
                        resp && this.log.error(resp.statusCode);
                        reject();
                        return;
                    }
                    this.log.debug(JSON.stringify(body));
                    if (body.errorCode && body.errorCode !== "0") {
                        this.log.error(body.msg);
                        reject();
                        return;
                    }
                    try {
                        if (body.result && body.result.list && body.result.list.length > 0) {
                            body.result.list.forEach(currentElement => {
                                this.hgIdArray.push(currentElement.id);

                                this.setObjectNotExists(currentElement.id, {
                                    type: "device",
                                    common: {
                                        name: currentElement.name,
                                        role: "indicator",
                                        write: false,
                                        read: true
                                    },
                                    native: {}
                                });
                                Object.keys(currentElement).forEach(key => {
                                    this.setObjectNotExists(currentElement.id + ".general." + key, {
                                        type: "state",
                                        common: {
                                            name: key,
                                            role: "indicator",
                                            type: typeof currentElement[key],
                                            write: false,
                                            read: true
                                        },
                                        native: {}
                                    });
                                    this.setState(currentElement.id + ".general." + key, currentElement[key], true);
                                });
                            });
                        }
                        resolve();
                    } catch (error) {
                        this.log.error(error);
                        this.log.error(error.stack);
                        reject();
                    }
                }
            );
        });
    }
    getSign(path, form) {
        const postfix =
            "/" +
            path
                .split("/")
                .slice(3)
                .join("/");
        const ordered = {};
        Object.keys(form)
            .sort()
            .forEach(function(key) {
                ordered[key] = form[key];
            });
        const query = Object.keys(ordered)
            .map(key => key + "=" + ordered[key])
            .join("&");

        return crypto
            .createHash("sha256")
            .update(postfix + query + this.appKey)
            .digest("hex");
    }
    getSignPassword(loginId) {
        const pw = crypto
            .createHash("sha256")
            .update(this.config.password)
            .digest("hex");

        return crypto
            .createHash("sha256")
            .update(loginId + pw + this.appKey)
            .digest("hex");
    }
    getStamp() {
        const date = new Date();
        return date
            .toISOString()
            .slice(0, 19)
            .replace(/-/g, "")
            .replace(/:/g, "")
            .replace(/T/g, "");
    }

    generateDataKey() {
        const md5AppKey = crypto.createHash("md5").update(this.appKey).digest("hex");
        const decipher = crypto.createDecipheriv("aes-128-ecb", md5AppKey.slice(0,16),"");
        const dec = decipher.update(this.atoken,"hex","utf8");
        this.dataKey = dec;
        return dec;
    }
    decryptAes(reply) {
        if (!this.dataKey) {
            this.generateDataKey();
        }
        const decipher = crypto.createDecipheriv("aes-128-ecb", this.dataKey, "");
        const dec = decipher.update(reply,"hex","utf8");
        return dec.split(",");
    }
    encryptAes(query) {
        if (!this.dataKey) {
            this.generateDataKey();
        }
        const cipher = crypto.createCipheriv("aes-128-ecb", this.dataKey,"");
        let ciph = cipher.update(query.join(","),"utf8","hex");
        ciph+=cipher.final("hex");
        return ciph;
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            clearInterval(this.updateInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = options => new Midea(options);
} else {
    // otherwise start the instance directly
    new Midea();
}

class crc8 {
    static crc8_854_table = [
        0x00, 0x5E, 0xBC, 0xE2, 0x61, 0x3F, 0xDD, 0x83,
        0xC2, 0x9C, 0x7E, 0x20, 0xA3, 0xFD, 0x1F, 0x41,
        0x9D, 0xC3, 0x21, 0x7F, 0xFC, 0xA2, 0x40, 0x1E,
        0x5F, 0x01, 0xE3, 0xBD, 0x3E, 0x60, 0x82, 0xDC,
        0x23, 0x7D, 0x9F, 0xC1, 0x42, 0x1C, 0xFE, 0xA0,
        0xE1, 0xBF, 0x5D, 0x03, 0x80, 0xDE, 0x3C, 0x62,
        0xBE, 0xE0, 0x02, 0x5C, 0xDF, 0x81, 0x63, 0x3D,
        0x7C, 0x22, 0xC0, 0x9E, 0x1D, 0x43, 0xA1, 0xFF,
        0x46, 0x18, 0xFA, 0xA4, 0x27, 0x79, 0x9B, 0xC5,
        0x84, 0xDA, 0x38, 0x66, 0xE5, 0xBB, 0x59, 0x07,
        0xDB, 0x85, 0x67, 0x39, 0xBA, 0xE4, 0x06, 0x58,
        0x19, 0x47, 0xA5, 0xFB, 0x78, 0x26, 0xC4, 0x9A,
        0x65, 0x3B, 0xD9, 0x87, 0x04, 0x5A, 0xB8, 0xE6,
        0xA7, 0xF9, 0x1B, 0x45, 0xC6, 0x98, 0x7A, 0x24,
        0xF8, 0xA6, 0x44, 0x1A, 0x99, 0xC7, 0x25, 0x7B,
        0x3A, 0x64, 0x86, 0xD8, 0x5B, 0x05, 0xE7, 0xB9,
        0x8C, 0xD2, 0x30, 0x6E, 0xED, 0xB3, 0x51, 0x0F,
        0x4E, 0x10, 0xF2, 0xAC, 0x2F, 0x71, 0x93, 0xCD,
        0x11, 0x4F, 0xAD, 0xF3, 0x70, 0x2E, 0xCC, 0x92,
        0xD3, 0x8D, 0x6F, 0x31, 0xB2, 0xEC, 0x0E, 0x50,
        0xAF, 0xF1, 0x13, 0x4D, 0xCE, 0x90, 0x72, 0x2C,
        0x6D, 0x33, 0xD1, 0x8F, 0x0C, 0x52, 0xB0, 0xEE,
        0x32, 0x6C, 0x8E, 0xD0, 0x53, 0x0D, 0xEF, 0xB1,
        0xF0, 0xAE, 0x4C, 0x12, 0x91, 0xCF, 0x2D, 0x73,
        0xCA, 0x94, 0x76, 0x28, 0xAB, 0xF5, 0x17, 0x49,
        0x08, 0x56, 0xB4, 0xEA, 0x69, 0x37, 0xD5, 0x8B,
        0x57, 0x09, 0xEB, 0xB5, 0x36, 0x68, 0x8A, 0xD4,
        0x95, 0xCB, 0x29, 0x77, 0xF4, 0xAA, 0x48, 0x16,
        0xE9, 0xB7, 0x55, 0x0B, 0x88, 0xD6, 0x34, 0x6A,
        0x2B, 0x75, 0x97, 0xC9, 0x4A, 0x14, 0xF6, 0xA8,
        0x74, 0x2A, 0xC8, 0x96, 0x15, 0x4B, 0xA9, 0xF7,
        0xB6, 0xE8, 0x0A, 0x54, 0xD7, 0x89, 0x6B, 0x35
    ]

    static calculate(data) {
        let crc_value = 0
        for (let m of data) {
            let k = crc_value ^ m
            if (k > 256)
                k -= 256
            if (k < 0)
                k += 256
            crc_value = crc8.crc8_854_table[k]
        }
        return crc_value
    }
}

class baseCommand {
    constructor(device_type = 0xAC) {
        // More magic numbers. I'm sure each of these have a purpose, but none of it is documented in english. I might make an effort to google translate the SDK
        this.data = [
            0xaa, 0x23, 0xAC, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x03, 0x02, 0x40, 0x81, 0x00, 0xff, 0x03, 0xff,
            0x00, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x03, 0xcc
        ];
        this.data[0x02] = device_type;
    }

    finalize() {
        // Add the CRC8
        this.data[0x1d] = crc8.calculate(this.data.slice(16))
        // Set the length of the command data
        this.data[0x01] = this.data.length
        return this.data
    }
}

class setCommand extends baseCommand {
    constructor(device_type) {
        super(device_type)
    }

    get audibleFeedback() {
        return this.data[0x0b] & 0x42
    }

    set audibleFeedback(feedbackEnabled) {
        this.data[0x0b] &= ~0x42  // Clear the audible bits
        this.data[0x0b] |= feedbackEnabled ? 0x42 : 0
    }

    get powerState() {
        return this.data[0x0b] & 0x01
    }

    set power_state(state) {
        this.data[0x0b] &= ~0x01  // Clear the power bit
        this.data[0x0b] |= state ? 0x01 : 0
    }

    get targetTemperature() {
        return this.data[0x0c] & 0x1f
    }

    set targetTemperature(temperatureCelsius) {
        this.data[0x0c] &= ~0x1f  // Clear the temperature bits
        this.data[0x0c] |= (temperatureCelsius & 0xf) | (
            (temperatureCelsius << 4) & 0x10)
    }

    get operationalMode() {
        return (this.data[0x0c] & 0xe0) >> 5
    }

    set operationalMode(mode) {
        this.data[0x0c] &= ~0xe0  // Clear the mode bit
        this.data[0x0c] |= (mode << 5) & 0xe0
    }

    get fanSpeed() {
        return this.data[0x0d]
    }

    set fanSpeed(speed) {
        this.data[0x0d] = speed
    }

    get ecoMode() {
        return this.data[0x13] > 0
    }

    set ecoMode(ecoModeEnabled) {
        this.data[0x13] = ecoModeEnabled ? 0xFF : 0
    }

    get swingMode() {
        return this.data[0x11]
    }

    set swingMode(mode) {
        this.data[0x11] &= ~0x0f  // Clear the mode bit
        this.data[0x11] |= mode & 0x0f
    }

    get turboMode() {
        return this.data[0x14] > 0
    }

    set turboMode(turboModeEnabled) {
        this.data[0x14] = turboModeEnabled ? 0x02 : 0
    }
}

class packetBuilder {

    constructor() {
        this.command = null

        // Init the packet with the header data. Weird magic numbers, I'm not sure what they all do, but they have to be there (packet length at 0x4)
        this.packet = [
            0x5a, 0x5a, 0x01, 0x11, 0x5c, 0x00, 0x20, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x0e, 0x03, 0x12, 0x14, 0xc6, 0x79, 0x00, 0x00,
            0x00, 0x05, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00
        ]
    }

    set command(command) {
        this.command = command.finalize()
    }

    finalize() {
        // Append the command data to the packet
        this.packet = this.packet.concat(this.command)
        // Append a basic checksum of the command to the packet (This is apart from the CRC8 that was added in the command)
        this.packet = this.packet.concat([this.checksum(this.command.slice(1))])
        // Ehh... I dunno, but this seems to make things work. Pad with 0's
        this.packet = this.packet.concat(Array(46 - this.command.length).fill(0))
        // Set the packet length in the packet!
        this.packet[0x04] = this.packet.length
        return this.packet
    }

    checksum(data) {
        return 255 - data.reduce((a, b) => a + b) % 256 + 1
    }
}