import axios from 'axios';

const VERSION = '/api/v1';

interface IPFSClientConfig {
    url?: string;
    waitUntilReady?: boolean;
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
    console?: any;
}

function throwError(error: any) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

class IPFSClient {
    private config: IPFSClientConfig;
    private API: string;

    constructor(config = {}) {
        this.config = config;
        this.API = VERSION;
    }

    public async connect(): Promise<void> {
        if (this.config.url) {
            this.API = `${this.config.url}${VERSION}`;
        }

        // Only used for unit testing
        // TBD replace console with a real logging package
        if (this.config.console) {
            // eslint-disable-next-line
            console = this.config.console;
        }

        if (this.config.waitUntilReady) {
            await this.waitUntilReady();
        }
    }

    async waitUntilReady() {
        let { intervalSeconds = 5, chatty = false, becomeChattyAfter = 0, maxRetries = 0 } = this.config;
        let ready = false;
        let retries = 0;

        if (chatty) {
            console.log(`Connecting to IPFS at ${this.API}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    console.log('Waiting for IPFS to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                console.log(`Connecting to IPFS at ${this.API}`);
                chatty = true;
            }
        }

        if (chatty) {
            console.log('IPFS service is ready!');
        }
    }

    public async isReady(): Promise<boolean> {
        try {
            const response = await axios.get(`${this.API}/ready`);
            return response.data;
        }
        catch (error) {
            return false;
        }
    }

    public async getVersion(): Promise<number> {
        try {
            const response = await axios.get(`${this.API}/version`);
            return response.data;
        }
        catch (error) {
            throwError(error);
            return 0;
        }
    }

    public async add<T>(data: T): Promise<string | null> {
        try {
            const response = await axios.post(`${this.API}/ipfs`, data);
            return response.data.cid;
        }
        catch (error) {
            throwError(error);
            return null;
        }
    }

    public async get<T>(b58cid: string): Promise<T | null> {
        try {
            const response = await axios.get(`${this.API}/ipfs/${b58cid}`);
            return response.data;
        }
        catch (error) {
            throwError(error);
            return null;
        }
    }

    // Factory method
    static async create(config: IPFSClientConfig = {}): Promise<IPFSClient> {
        const instance = new IPFSClient(config);
        await instance.connect();
        return instance;
    }
}

export default IPFSClient;
