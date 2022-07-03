"use strict";

/*
 * Created with @iobroker/create-adapter v1.21.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const { python } = require("pythonia");
class Midea extends utils.Adapter {
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "midea",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.midea_beautiful = await python("midea_beautiful");
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.login();

        this.updateInterval = setInterval(() => {
            this.updateValues();
        }, this.config.interval * 60 * 1000);

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");
    }
    async login() {
        try {
            const cloud = await this.midea_beautiful
                .connect_to_cloud$({
                    account: this.config.user,
                    password: this.config.password,
                })
                .catch((error) => {
                    this.log.error(error);
                    return;
                });
            this.log.info(await cloud.__dict__);
        } catch (error) {
            this.log.error(error);
        }
    }

    updateValues() {}

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
    async onStateChange(id, state) {
        if (state && !state.ack) {
            const deviceId = id.split(".")[2];
            const deviceTypeState = await this.getStateAsync(deviceId + ".general.type");
            let deviceType = 0xac;
            if (deviceTypeState) {
                deviceType = parseInt(deviceTypeState.val, 16);
            }
        }
    }
}
// @ts-ignore parent is a valid property on module-
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Midea(options);
} else {
    // otherwise start the instance directly
    new Midea();
}
