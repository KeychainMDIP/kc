import {
    WaitUntilReadyOptions,
    SearchClientOptions,
    SearchEngine,
} from './types.js'

import axiosModule, { AxiosError, type AxiosInstance, type AxiosStatic } from 'axios';
import { childLogger, createConsoleLogger, type LoggerLike } from '@mdip/common/logger';

const axios =
    (axiosModule as AxiosStatic & { default?: AxiosInstance })?.default ??
    (axiosModule as AxiosInstance);

const VERSION = '/api/v1';

function throwError(error: AxiosError | any): never {
    if (error.response) {
        throw error.response.data;
    }

    throw error;
}

export default class SearchClient implements SearchEngine {
    private API: string = "/api/v1";
    private log: LoggerLike = childLogger({ service: 'search-client' });

    // Factory method
    static async create(options: SearchClientOptions): Promise<SearchClient> {
        const searchClient = new SearchClient();
        await searchClient.connect(options);
        return searchClient;
    }

    async connect(options: SearchClientOptions = {}): Promise<void> {
        if (options.url) {
            this.API = `${options.url}${VERSION}`;
        }

        // Only used for unit testing
        // TBD replace console with a real logging package
        if (options.console) {
            this.log = createConsoleLogger(options.console);
        }

        if (options.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options: WaitUntilReadyOptions = {}): Promise<void> {
        let { intervalSeconds = 5, chatty = false, becomeChattyAfter = 0, maxRetries = 0 } = options;
        let ready = false;
        let retries = 0;

        if (chatty) {
            this.log.info(`Connecting to Search-server at ${this.API}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    this.log.debug('Waiting for Search-server to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                this.log.info(`Connecting to Search-server at ${this.API}`);
                chatty = true;
            }
        }

        if (chatty) {
            this.log.info('Search-server is ready!');
        }
    }

    async isReady(): Promise<boolean> {
        try {
            const response = await axios.get(`${this.API}/ready`);
            return response.data.ready;
        }
        catch (error) {
            return false;
        }
    }

    async search(where: object): Promise<string[]> {
        try {
            const response = await axios.post(`${this.API}/query`, where);
            return response.data as string[];
        }
        catch (error) {
            throwError(error);
        }
    }
}
