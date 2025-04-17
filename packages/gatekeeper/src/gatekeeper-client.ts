import axios, { AxiosError } from 'axios';
import {
    GatekeeperInterface,
    GatekeeperEvent,
    GetRecentEventsOptions,
    GetRecentEventsResult,
    Operation,
    MdipDocument,
    ResolveDIDOptions,
    GetDIDOptions,
    CheckDIDsResult,
    ImportBatchResult,
    ProcessEventsResult,
    VerifyDbResult,
} from './types.js';

const VERSION = '/api/v1';

function throwError(error: AxiosError | any): never {
    if (error.response) {
        throw error.response.data;
    }
    throw error.message;
}

export interface GatekeeperClientOptions {
    url?: string;
    console?: typeof console;
    waitUntilReady?: boolean;
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
}

export interface GetStatusResult {
    uptimeSeconds: number;
    dids: CheckDIDsResult;
    memoryUsage: NodeJS.MemoryUsage;
}

export default class GatekeeperClient implements GatekeeperInterface {
    private API: string;

    // Factory method
    static async create(options: GatekeeperClientOptions): Promise<GatekeeperClient> {
        const gatekeeper = new GatekeeperClient();
        await gatekeeper.connect(options);
        return gatekeeper;
    }

    constructor() {
        this.API = VERSION;
    }

    async connect(options?: GatekeeperClientOptions) {
        if (options?.url) {
            this.API = `${options.url}${VERSION}`;
        }

        // Only used for unit testing
        // TBD replace console with a real logging package
        if (options?.console) {
            // eslint-disable-next-line
            console = options.console;
        }

        if (options?.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options: GatekeeperClientOptions) {
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

    async listRegistries(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/registries`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resetDb(): Promise<boolean> {
        try {
            const response = await axios.get(`${this.API}/db/reset`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async verifyDb(): Promise<VerifyDbResult> {
        try {
            const response = await axios.get(`${this.API}/db/verify`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async isReady(): Promise<boolean> {
        try {
            const response = await axios.get(`${this.API}/ready`);
            return response.data;
        }
        catch (error) {
            return false;
        }
    }

    async getVersion(): Promise<number> {
        try {
            const response = await axios.get(`${this.API}/version`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getStatus(): Promise<GetStatusResult> {
        try {
            const response = await axios.get(`${this.API}/status`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createDID(operation: Operation): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/did`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resolveDID(did: string, options?: ResolveDIDOptions): Promise<MdipDocument> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
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

    // eslint-disable-next-line sonarjs/no-identical-functions
    async updateDID(operation: Operation): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/did`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    // eslint-disable-next-line sonarjs/no-identical-functions
    async deleteDID(operation: Operation): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/did`, operation);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getDIDs(options?: GetDIDOptions): Promise<string[] | MdipDocument[]> {
        try {
            const response = await axios.post(`${this.API}/dids`, options);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async exportDIDs(dids?: string[]): Promise<GatekeeperEvent[][]> {
        try {
            const response = await axios.post(`${this.API}/dids/export`, { dids });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async importDIDs(dids: GatekeeperEvent[][]): Promise<ImportBatchResult> {
        try {
            const response = await axios.post(`${this.API}/dids/import`, dids);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async exportBatch(dids?: string[]): Promise<GatekeeperEvent[]> {
        try {
            const response = await axios.post(`${this.API}/batch/export`, { dids });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async importBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult> {
        try {
            const response = await axios.post(`${this.API}/batch/import`, batch);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeDIDs(dids: string[]): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/dids/remove`, dids);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getQueue(registry: string): Promise<Operation[]> {
        try {
            const response = await axios.get(`${this.API}/queue/${registry}`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async clearQueue(registry: string, events: Operation[]): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/queue/${registry}/clear`, events);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async processEvents(): Promise<ProcessEventsResult> {
        try {
            const response = await axios.post(`${this.API}/events/process`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addJSON(data: object): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/cas/json`, data);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getJSON(cid: string): Promise<object> {
        try {
            const response = await axios.get(`${this.API}/cas/json/${cid}`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addText(data: string): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/cas/text`, data, {
                headers: {
                    'Content-Type': 'text/plain'
                }
            });
            return response.data;
        } catch (error) {
            throwError(error);
        }
    }

    async getText(cid: string): Promise<string> {
        try {
            const response = await axios.get(`${this.API}/cas/text/${cid}`);
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addData(data: Buffer): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/cas/data`, data, {
                headers: {
                    'Content-Type': 'application/octet-stream'
                }
            });
            return response.data;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getData(cid: string): Promise<Buffer> {
        try {
            const response = await axios.get(`${this.API}/cas/data/${cid}`, {
                responseType: 'arraybuffer'
            });
            return Buffer.from(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response && axiosError.response.data instanceof Uint8Array) {
                const textDecoder = new TextDecoder();
                const errorMessage = textDecoder.decode(axiosError.response.data);
                axiosError.response.data = JSON.parse(errorMessage);
            }
            throwError(axiosError);
        }
    }

    async getRecentEvents(options: GetRecentEventsOptions): Promise<GetRecentEventsResult> {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString(),
        });

        if (options.registry) {
            params.set('registry', options.registry);
        }

        try {
            const response = await axios.get(`${this.API}/events/recent?${params.toString()}`);
            return response.data;
        } catch (error) {
            throwError(error);
        }
    }
}
