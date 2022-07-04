"use strict";

/*
 * Created with @iobroker/create-adapter v1.21.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const { py, python } = require("pythonia");
const Json2iob = require("./lib/json2iob");
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
        this.json2iob = new Json2iob(this);
        this.devices = {};
        //redirect log from python module to adapter log
        console.log = (args) => {
            this.log.info(args);
        };
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.midea_beautiful = await python("midea_beautiful");

        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        if (!this.config.user || !this.config.password) {
            this.log.error("Please set username and password in the instance settings");
            return;
        }

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.cloud = await this.login();
        await this.getDeviceList();
        await this.updateDevices();
        this.updateInterval = setInterval(() => {
            this.updateDevices();
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
            this.log.debug(await cloud.__dict__);
            this.setState("info.connection", true, true);
            return cloud;
        } catch (error) {
            this.log.error(error);
        }
    }
    async getDeviceList() {
        try {
            this.log.info("Getting devices");
            const appliances = await this.midea_beautiful.find_appliances$({ cloud: this.cloud });
            this.log.info(`Found ${await appliances.length} devices`);
            for await (const [index, app] of await py.enumerate(appliances)) {
                this.log.debug(await app);
                const appJsonString = this.pythonToJson(await app.state.__dict__.__str__());
                const appJson = JSON.parse(appJsonString);
                const id = appJson.id;
                this.devices[id] = appJson;
                await this.setObjectNotExistsAsync(id, {
                    type: "device",
                    common: {
                        name: appJson.name,
                    },
                    native: {},
                });
                this.json2iob.parse(id, appJson, { forceIndex: true });
            }
        } catch (error) {
            this.log.error(error);
        }
    }
    async updateDevices() {
        try {
            for (const id in this.devices) {
                const appliance_state = await this.midea_beautiful.appliance_state$({ cloud: this.cloud, appliance_id: id, use_cloud: true });
                this.log.debug(await appliance_state);
                const stateString = pythonToJson(await appliance_state.state.__dict__.__str__());
                const stateJson = JSON.parse(stateString);
                this.json2iob.parse(id, stateJson);
            }
        } catch (error) {}
    }

    pythonToJson(objectString) {
        objectString = objectString
            .replaceAll(/b'[^']*'/g, "''")
            .replaceAll(/: <[^<]*>,/g, ":'',")
            .replaceAll(`{'_`, `{'`)
            .replaceAll(`, '_`, `, '`)
            .replaceAll(`'`, `"`)
            .replaceAll(` None,`, `null,`)
            .replaceAll(` True,`, `true,`)
            .replaceAll(` False,`, `false,`);

        this.log.debug(objectString);
        return objectString;
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
    async onStateChange(id, state) {
        if (state && !state.ack) {
            const deviceId = id.split(".")[2];
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
