import axios from 'axios';

const VERSION = '/api/v1';

function throwError(error) {
    if (error.response?.data?.error) {
        throw error.response.data.error;
    }

    throw error.message;
}

export default class KeymasterClient {
    // Factory method
    static async create(options) {
        const keymaster = new KeymasterClient();
        await keymaster.connect(options);
        return keymaster;
    }

    constructor() {
        this.API = VERSION;
    }

    async connect(options = {}) {
        if (options.url) {
            this.API = `${options.url}${VERSION}`;
        }

        if (options.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options = {}) {
        let { intervalSeconds = 5, chatty = false, becomeChattyAfter = 0 } = options;
        let ready = false;
        let retries = 0;

        if (chatty) {
            console.log(`Connecting to Keymaster at ${this.API}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    console.log('Waiting for Keymaster to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                console.log(`Connecting to Keymaster at ${this.API}`);
                chatty = true;
            }
        }

        if (chatty) {
            console.log('Keymaster service is ready!');
        }
    }

    async stop() {
    }

    async isReady() {
        try {
            const response = await axios.get(`${this.API}/ready`);
            return response.data.ready;
        }
        catch (error) {
            return false;
        }
    }

    async loadWallet() {
        try {
            const response = await axios.get(`${this.API}/wallet`);
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async saveWallet(wallet) {
        try {
            const response = await axios.put(`${this.API}/wallet`, { wallet });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async newWallet(mnemonic, overwrite = false) {
        try {
            const response = await axios.post(`${this.API}/wallet/new`, { mnemonic, overwrite });
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async backupWallet() {
        try {
            const response = await axios.post(`${this.API}/wallet/backup`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async recoverWallet() {
        try {
            const response = await axios.post(`${this.API}/wallet/recover`);
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async checkWallet() {
        try {
            const response = await axios.post(`${this.API}/wallet/check`);
            return response.data.check;
        }
        catch (error) {
            throwError(error);
        }
    }

    async fixWallet() {
        try {
            const response = await axios.post(`${this.API}/wallet/fix`);
            return response.data.fix;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptMnemonic() {
        try {
            const response = await axios.get(`${this.API}/wallet/mnemonic`);
            return response.data.mnemonic;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listRegistries() {
        try {
            const response = await axios.get(`${this.API}/registries`);
            return response.data.registries;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getCurrentId() {
        try {
            const response = await axios.get(`${this.API}/ids/current`);
            return response.data.current;
        }
        catch (error) {
            throwError(error);
        }
    }

    async setCurrentId(name) {
        try {
            const response = await axios.put(`${this.API}/ids/current`, { name });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listIds() {
        try {
            const response = await axios.get(`${this.API}/ids`);
            return response.data.ids;
        }
        catch (error) {
            throwError(error);
        }
    }

    async encryptMessage(msg, receiver, options = {}) {
        try {
            const response = await axios.post(`${this.API}/keys/encrypt/message`, { msg, receiver, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptMessage(did) {
        try {
            const response = await axios.post(`${this.API}/keys/decrypt/message`, { did });
            return response.data.message;
        }
        catch (error) {
            throwError(error);
        }
    }

    async encryptJSON(json, receiver, options = {}) {
        try {
            const response = await axios.post(`${this.API}/keys/encrypt/json`, { json, receiver, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptJSON(did) {
        try {
            const response = await axios.post(`${this.API}/keys/decrypt/json`, { did });
            return response.data.json;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createId(name, options) {
        try {
            const response = await axios.post(`${this.API}/ids`, { name, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeId(id) {
        try {
            const response = await axios.delete(`${this.API}/ids/${id}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async backupId(id) {
        try {
            const response = await axios.post(`${this.API}/ids/${id}/backup`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async recoverId(did) {
        try {
            const response = await axios.post(`${this.API}/ids/${did}/recover`);
            return response.data.recovered;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listNames() {
        try {
            const response = await axios.get(`${this.API}/names`);
            return response.data.names;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addName(name, did) {
        try {
            const response = await axios.post(`${this.API}/names`, { name, did });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeName(name) {
        try {
            const response = await axios.delete(`${this.API}/names/${name}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resolveDID(id, options) {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options);
                const response = await axios.get(`${this.API}/did/${id}?${queryParams.toString()}`);
                return response.data.docs;
            }
            else {
                const response = await axios.get(`${this.API}/did/${id}`);
                return response.data.docs;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async createAsset(data, options = {}) {
        try {
            const response = await axios.post(`${this.API}/assets`, { data, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listAssets() {
        try {
            const response = await axios.get(`${this.API}/assets`);
            return response.data.assets;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resolveAsset(name) {
        try {
            const response = await axios.get(`${this.API}/assets/${name}`);
            return response.data.asset;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createChallenge(challengeSpec, options) {
        try {
            const response = await axios.post(`${this.API}/challenge`, { challenge: challengeSpec, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createResponse(challengeDID, options) {
        try {
            const response = await axios.post(`${this.API}/response`, { challenge: challengeDID, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async verifyResponse(responseDID, options) {
        try {
            const response = await axios.post(`${this.API}/response/verify`, { response: responseDID, options });
            return response.data.verify;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createGroup(name, options) {
        try {
            const response = await axios.post(`${this.API}/groups`, { name, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getGroup(group) {
        try {
            const response = await axios.get(`${this.API}/groups/${group}`);
            return response.data.group;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addGroupMember(group, member) {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/add`, { member });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeGroupMember(group, member) {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/remove`, { member });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testGroup(group, member) {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/test`, { member });
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listGroups(owner) {
        try {
            if (!owner) {
                owner = '';
            }
            const response = await axios.get(`${this.API}/groups?owner=${owner}`);
            return response.data.groups;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createSchema(schema, options) {
        try {
            const response = await axios.post(`${this.API}/schemas`, { schema, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getSchema(id) {
        try {
            const response = await axios.get(`${this.API}/schemas/${id}`);
            return response.data.schema;
        }
        catch (error) {
            throwError(error);
        }
    }

    async setSchema(id, schema) {
        try {
            const response = await axios.put(`${this.API}/schemas/${id}`, { schema });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testSchema(id) {
        try {
            const response = await axios.post(`${this.API}/schemas/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listSchemas(owner) {
        try {
            if (!owner) {
                owner = '';
            }

            const response = await axios.get(`${this.API}/schemas?owner=${owner}`);
            return response.data.schemas;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testAgent(id) {
        try {
            const response = await axios.post(`${this.API}/agents/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async bindCredential(schema, subject, options) {
        try {
            const response = await axios.post(`${this.API}/credentials/bind`, { schema, subject, options });
            return response.data.credential;
        }
        catch (error) {
            throwError(error);
        }
    }

    async issueCredential(credential, options) {
        try {
            const response = await axios.post(`${this.API}/credentials/issued`, { credential, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateCredential(did, credential) {
        try {
            const response = await axios.post(`${this.API}/credentials/issued/${did}`, { credential });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listCredentials() {
        try {
            const response = await axios.get(`${this.API}/credentials/held`);
            return response.data.held;
        }
        catch (error) {
            throwError(error);
        }
    }

    async acceptCredential(did) {
        try {
            const response = await axios.post(`${this.API}/credentials/held/`, { did });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getCredential(did) {
        try {
            const response = await axios.get(`${this.API}/credentials/held/${did}`);
            return response.data.credential;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeCredential(did) {
        try {
            const response = await axios.delete(`${this.API}/credentials/held/${did}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async publishCredential(did, options) {
        try {
            const response = await axios.post(`${this.API}/credentials/held/${did}/publish`, { options });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async unpublishCredential(did) {
        try {
            const response = await axios.post(`${this.API}/credentials/held/${did}/unpublish`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listIssued() {
        try {
            const response = await axios.get(`${this.API}/credentials/issued`);
            return response.data.issued;
        }
        catch (error) {
            throwError(error);
        }
    }

    async revokeCredential(did) {
        try {
            const response = await axios.delete(`${this.API}/credentials/issued/${did}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async pollTemplate() {
        try {
            const response = await axios.get(`${this.API}/templates/poll`);
            return response.data.template;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createPoll(poll, options = {}) {
        try {
            const response = await axios.post(`${this.API}/polls`, { poll, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getPoll(pollId) {
        try {
            const response = await axios.get(`${this.API}/polls/${pollId}`);
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async viewPoll(pollId) {
        try {
            const response = await axios.get(`${this.API}/polls/${pollId}/view`);
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async votePoll(pollId, vote, options = {}) {
        try {
            const response = await axios.post(`${this.API}/polls/vote`, { pollId, vote, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updatePoll(ballot) {
        try {
            const response = await axios.put(`${this.API}/polls/update`, { ballot });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async publishPoll(pollId, options = {}) {
        try {
            const response = await axios.post(`${this.API}/polls/${pollId}/publish`, { options });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async unpublishPoll(pollId) {
        try {
            const response = await axios.post(`${this.API}/polls/${pollId}/unpublish`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }
}
