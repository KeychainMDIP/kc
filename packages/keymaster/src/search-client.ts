import {
    WaitUntilReadyOptions,
    SearchClientOptions,
    SearchEngine,
} from './types.js'

import axiosModule, { AxiosError, type AxiosInstance, type AxiosStatic } from 'axios';
import { childLogger, createConsoleLogger, type LoggerLike } from '@mdip/common/logger';
import { isRetryableHttpError, waitForTimeout } from '@mdip/common/utils';

const VERSION = '/api/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

function throwError(error: AxiosError | any): never {
    if (error.response) {
        throw error.response.data;
    }

    throw error;
}

export default class SearchClient implements SearchEngine {
    private API: string = "/api/v1";
    private axios: AxiosInstance;
    private log: LoggerLike = childLogger({ service: 'search-client' });

    constructor() {
        const axios =
            (axiosModule as AxiosStatic & { default?: AxiosInstance })?.default ??
            (axiosModule as AxiosInstance);

        this.axios = axios.create({ timeout: DEFAULT_REQUEST_TIMEOUT_MS });
    }

    // Factory method
    static async create(options: SearchClientOptions): Promise<SearchClient> {
        const searchClient = new SearchClient();
        await searchClient.connect(options);
        return searchClient;
    }

    async connect(options: SearchClientOptions = {}): Promise<void> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error('timeoutMs must be a positive finite number');
        }

        this.axios.defaults.signal = options.signal;
        this.axios.defaults.timeout = timeoutMs;

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
            ready = await this.isReady(options.signal);

            retries += 1;

            if (!ready && maxRetries > 0 && retries > maxRetries) {
                throw new Error(`Search Server did not become ready after ${retries} attempts`);
            }

            if (!ready) {
                if (chatty) {
                    this.log.debug('Waiting for Search-server to be ready...');
                }
                await waitForTimeout(intervalSeconds * 1000, options.signal);
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

    async isReady(signal?: AbortSignal): Promise<boolean> {
        try {
            const response = await this.axios.get(`${this.API}/ready`, signal ? { signal } : undefined);
            return response.data.ready;
        }
        catch (error) {
            if (isRetryableHttpError(error)) {
                return false;
            }
            throw error;
        }
    }

    async search(where: object): Promise<string[]> {
        try {
            const response = await this.axios.post(`${this.API}/query`, where);
            return response.data as string[];
        }
        catch (error) {
            throwError(error);
        }
    }
}
