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

    /**
     * @swagger
     * /ready:
     *   get:
     *     summary: Check if the Gatekeeper service is ready.
     *     description: Returns a 200 status if the Gatekeeper service is ready.
     *     tags: [General]
     *     responses:
     *       200:
     *         description: Gatekeeper service is ready.
     *         content:
     *           text/plain:
     *             schema:
     *               type: boolean
     *               example: true
     */
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

    /**
     * @swagger
     * /did:
     *   post:
     *     summary: Create a new DID
     *     description: Creates a DID document based on the provided operation object.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - type
     *               - created
     *               - mdip
     *               - signature
     *             properties:
     *               type:
     *                 type: string
     *                 enum: [ "create" ]
     *                 description: Must be "create" for a valid create operation.
     *               created:
     *                 type: string
     *                 format: date-time
     *                 description: Timestamp indicating when the operation was created.
     *               mdip:
     *                 type: object
     *                 required:
     *                   - version
     *                   - type
     *                   - registry
     *                 properties:
     *                   version:
     *                     type: integer
     *                     description: Version.
     *                     example: 1
     *                   type:
     *                     type: string
     *                     enum: ["agent", "asset"]
     *                     description: MDIP type.
     *                   registry:
     *                     type: string
     *                     description: Registry where the DID will be registered.
     *                     example: "hyperswarm"
     *                   validUntil:
     *                     type: string
     *                     format: date-time
     *                     description: Optional timestamp until which the DID is valid.
     *               signature:
     *                 type: object
     *                 required:
     *                   - value
     *                 properties:
     *                   value:
     *                     type: string
     *                     description: The actual cryptographic signature in base64/hex.
     *                   signer:
     *                     type: string
     *                     description: DID or identifier of the signer.
     *                   signed:
     *                     type: string
     *                     format: date-time
     *                     description: The timestamp when the signature was created.
     *               publicJwk:
     *                 type: object
     *                 description: Required if mdip.type = "agent". Contains the public key in JWK format.
     *               controller:
     *                 type: string
     *                 description: Required if mdip.type = "asset". Must match the "signer" in the signature.
     *     responses:
     *       200:
     *         description: Successfully created the DID.
     *       400:
     *         description: Invalid request.
     *       500:
     *         description: Server error.
     */
    async createDID(operation) {
        try {
            const response = await axios.post(`${this.API}/did`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
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

    async updateDID(operation) {
        try {
            const response = await axios.post(`${this.API}/did/${operation.did}`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async deleteDID(operation) {
        try {
            const response = await axios.delete(`${this.API}/did/${operation.did}`, { data: operation });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
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
