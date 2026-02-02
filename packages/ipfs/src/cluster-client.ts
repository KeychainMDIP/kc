import { IPFSClient } from './types.js';
import KuboClient from './kubo-client.js';

export interface ClusterClientConfig {
    kuboUrl: string;
    clusterUrl: string;
    clusterAuthHeader?: string;
    waitUntilReady?: boolean;
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
}

class ClusterClient implements IPFSClient {
    private kubo!: KuboClient;
    private clusterUrl = '';
    private authHeaderName: string | null = null;
    private authHeaderValue: string | null = null;

    static async create(config: ClusterClientConfig): Promise<ClusterClient> {
        const client = new ClusterClient();
        await client.connect(config);
        return client;
    }

    async connect(config: ClusterClientConfig): Promise<void> {
        this.clusterUrl = this.normalizeClusterUrl(config.clusterUrl);
        this.setAuthHeader(config.clusterAuthHeader);

        this.kubo = await KuboClient.create({
            url: config.kuboUrl,
            waitUntilReady: config.waitUntilReady,
            intervalSeconds: config.intervalSeconds,
            chatty: config.chatty,
            becomeChattyAfter: config.becomeChattyAfter,
            maxRetries: config.maxRetries,
        });
    }

    async addText(text: string): Promise<string> {
        const cid = await this.kubo.addText(text);
        await this.pinInCluster(cid);
        return cid;
    }

    async getText(cid: string): Promise<string> {
        return this.kubo.getText(cid);
    }

    async addData(data: Buffer): Promise<string> {
        const cid = await this.kubo.addData(data);
        await this.pinInCluster(cid);
        return cid;
    }

    async getData(cid: string): Promise<Buffer> {
        return this.kubo.getData(cid);
    }

    async addJSON(json: any): Promise<string> {
        const cid = await this.kubo.addJSON(json);
        await this.pinInCluster(cid);
        return cid;
    }

    async getJSON(cid: string): Promise<any> {
        return this.kubo.getJSON(cid);
    }

    private normalizeClusterUrl(url: string): string {
        const trimmed = url.trim();
        return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    }

    private setAuthHeader(header?: string): void {
        if (!header || header.trim() === '') {
            this.authHeaderName = null;
            this.authHeaderValue = null;
            return;
        }

        const separatorIndex = header.indexOf(':');
        if (separatorIndex === -1) {
            this.authHeaderName = 'Authorization';
            this.authHeaderValue = header.trim();
            return;
        }

        this.authHeaderName = header.slice(0, separatorIndex).trim() || 'Authorization';
        this.authHeaderValue = header.slice(separatorIndex + 1).trim();
    }

    private buildClusterHeaders(): Record<string, string> | undefined {
        const auth = this.getAuthHeader();
        if (!auth) {
            return undefined;
        }

        return { [auth.name]: auth.value };
    }

    private async clusterPost(path: string): Promise<void> {
        const response = await fetch(`${this.clusterUrl}${path}`, {
            method: 'POST',
            headers: this.buildClusterHeaders(),
        });

        if (response.ok) {
            return;
        }

        let body = '';
        try {
            body = await response.text();
        }
        catch (error) {
            body = '';
        }

        const detail = body ? `: ${body}` : '';
        throw new Error(`Cluster request failed (${response.status} ${response.statusText})${detail}`);
    }

    private async pinInCluster(cid: string): Promise<void> {
        console.log(`Pinning CID in IPFS Cluster: ${cid}`);
        await this.clusterPost(`/pins/${encodeURIComponent(cid)}`);
    }

    protected getAuthHeader(): { name: string; value: string } | null {
        if (!this.authHeaderName || !this.authHeaderValue) {
            return null;
        }

        return { name: this.authHeaderName, value: this.authHeaderValue };
    }

    protected getClusterUrl(): string {
        return this.clusterUrl;
    }
}

export default ClusterClient;
