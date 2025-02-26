import axios from 'axios';

const VERSION = '/api/v1';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export default class GatekeeperClient {
    // Factory method
    static async create(options) {
        const gatekeeper = new GatekeeperClient();
        await gatekeeper.connect(options);
        return gatekeeper;
    }

    constructor() {
        this.API = VERSION;
    }

    async connect(options = {}) {
        if (options.url) {
            this.API = `${options.url}${VERSION}`;
        }

        // Only used for unit testing
        // TBD replace console with a real logging package
        if (options.console) {
            // eslint-disable-next-line
            console = options.console;
        }

        if (options.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options = {}) {
        let { intervalSeconds = 5, chatty = false, becomeChattyAfter = 0, maxRetries = 0 } = options;
        let ready = false;
        let retries = 0;

        if (chatty) {
            console.log(`Connecting to gatekeeper at ${this.API}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    console.log('Waiting for Gatekeeper to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                console.log(`Connecting to gatekeeper at ${this.API}`);
                chatty = true;
            }
        }

        if (chatty) {
            console.log('Gatekeeper service is ready!');
        }
    }

    async listRegistries() {
        try {
            const response = await axios.get(`${this.API}/registries`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resetDb() {
        try {
            const response = await axios.get(`${this.API}/db/reset`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async verifyDb() {
        try {
            const response = await axios.get(`${this.API}/db/verify`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async isReady() {
        try {
            const response = await axios.get(`${this.API}/ready`);
            return response.data;
        }
        catch (error) {
            return false;
        }
    }

    async getVersion() {
        try {
            const response = await axios.get(`${this.API}/version`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getStatus() {
        try {
            const response = await axios.get(`${this.API}/status`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async handleDIDOperation(operation) {
        try {
            const response = await axios.post(`${this.API}/did`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    createDID(operation) {
        return this.handleDIDOperation(operation);
    }

    async resolveDID(did, options) {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options);
                const response = await axios.get(`${this.API}/did/${did}?${queryParams.toString()}`);
                return response.data;
            }
            else {
                const response = await axios.get(`${this.API}/did/${did}`);
                return response.data;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    updateDID(operation) {
        return this.handleDIDOperation(operation);
    }

    deleteDID(operation) {
        return this.handleDIDOperation(operation);
    }

    async getDIDs(options = {}) {
        try {
            const response = await axios.post(`${this.API}/dids`, options);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async exportDIDs(dids) {
        try {
            const response = await axios.post(`${this.API}/dids/export`, { dids });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async importDIDs(dids) {
        try {
            const response = await axios.post(`${this.API}/dids/import`, dids);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async exportBatch(dids) {
        try {
            const response = await axios.post(`${this.API}/batch/export`, { dids });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async importBatch(batch) {
        try {
            const response = await axios.post(`${this.API}/batch/import`, batch);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeDIDs(dids) {
        try {
            const response = await axios.post(`${this.API}/dids/remove`, dids);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getQueue(registry) {
        try {
            const response = await axios.get(`${this.API}/queue/${registry}`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async clearQueue(registry, events) {
        try {
            const response = await axios.post(`${this.API}/queue/${registry}/clear`, events);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async processEvents() {
        try {
            const response = await axios.post(`${this.API}/events/process`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }
}
