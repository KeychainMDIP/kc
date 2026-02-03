import {
    MdipDocument,
    ResolveDIDOptions,
} from '@mdip/gatekeeper/types';
import {
    Challenge,
    ChallengeResponse,
    CheckWalletResult,
    CreateAssetOptions,
    DmailItem,
    DmailMessage,
    FileAssetOptions,
    CreateResponseOptions,
    EncryptOptions,
    FileAsset,
    FixWalletResult,
    Group,
    GroupVault,
    GroupVaultOptions,
    ImageAsset,
    IssueCredentialsOptions,
    KeymasterClientOptions,
    KeymasterInterface,
    NoticeMessage,
    Poll,
    StoredWallet,
    VerifiableCredential,
    ViewPollResult,
    WaitUntilReadyOptions,
    WalletFile,
    WalletEncFile,
} from './types.js'

import { Buffer } from 'buffer';
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

export default class KeymasterClient implements KeymasterInterface {
    private API: string = "/api/v1";
    private log: LoggerLike = childLogger({ service: 'keymaster-client' });

    // Factory method
    static async create(options: KeymasterClientOptions): Promise<KeymasterClient> {
        const keymaster = new KeymasterClient();
        await keymaster.connect(options);
        return keymaster;
    }

    async connect(options: KeymasterClientOptions = {}): Promise<void> {
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
            this.log.info(`Connecting to Keymaster at ${this.API}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    this.log.debug('Waiting for Keymaster to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                this.log.info(`Connecting to Keymaster at ${this.API}`);
                chatty = true;
            }
        }

        if (chatty) {
            this.log.info('Keymaster service is ready!');
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

    async loadWallet(): Promise<WalletFile> {
        try {
            const response = await axios.get(`${this.API}/wallet`);
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async saveWallet(
        wallet: StoredWallet
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/wallet`, { wallet });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async newWallet(
        mnemonic?: string,
        overwrite = false
    ): Promise<WalletFile> {
        try {
            const response = await axios.post(`${this.API}/wallet/new`, { mnemonic, overwrite });
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async backupWallet(): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/wallet/backup`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async recoverWallet(): Promise<WalletFile> {
        try {
            const response = await axios.post(`${this.API}/wallet/recover`);
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }

    async checkWallet(): Promise<CheckWalletResult> {
        try {
            const response = await axios.post(`${this.API}/wallet/check`);
            return response.data.check;
        }
        catch (error) {
            throwError(error);
        }
    }

    async fixWallet(): Promise<FixWalletResult> {
        try {
            const response = await axios.post(`${this.API}/wallet/fix`);
            return response.data.fix;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptMnemonic(): Promise<string> {
        try {
            const response = await axios.get(`${this.API}/wallet/mnemonic`);
            return response.data.mnemonic;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listRegistries(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/registries`);
            return response.data.registries;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getCurrentId(): Promise<string | undefined> {
        try {
            const response = await axios.get(`${this.API}/ids/current`);
            return response.data.current;
        }
        catch (error) {
            throwError(error);
        }
    }

    async setCurrentId(name: string): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/ids/current`, { name });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listIds(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/ids`);
            return response.data.ids;
        }
        catch (error) {
            throwError(error);
        }
    }

    async rotateKeys(): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/keys/rotate`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async encryptMessage(
        msg: string,
        receiver: string,
        options: EncryptOptions = {}
    ) {
        try {
            const response = await axios.post(`${this.API}/keys/encrypt/message`, { msg, receiver, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptMessage(did: string): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/keys/decrypt/message`, { did });
            return response.data.message;
        }
        catch (error) {
            throwError(error);
        }
    }

    async encryptJSON(
        json: unknown,
        receiver: string,
        options?: EncryptOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/keys/encrypt/json`, { json, receiver, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async decryptJSON(did: string): Promise<unknown> {
        try {
            const response = await axios.post(`${this.API}/keys/decrypt/json`, { did });
            return response.data.json;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createId(
        name: string,
        options?: { registry?: string }
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/ids`, { name, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    public async removeId(id: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/ids/${id}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async renameId(
        id: string,
        name: string
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/ids/${id}/rename`, { name });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async backupId(id?: string): Promise<boolean> {
        try {
            if (!id) {
                id = await this.getCurrentId();
            }
            const response = await axios.post(`${this.API}/ids/${id}/backup`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async recoverId(did: string): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/ids/${did}/recover`);
            return response.data.recovered;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listNames(): Promise<Record<string, string>> {
        try {
            const response = await axios.get(`${this.API}/names`);
            return response.data.names;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addName(name: string, did: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/names`, { name, did });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getName(name: string): Promise<string | null> {
        try {
            const response = await axios.get(`${this.API}/names/${name}`);
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeName(name: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/names/${name}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resolveDID(
        id: string,
        options?: ResolveDIDOptions
    ): Promise<MdipDocument> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
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

    async revokeDID(id: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/did/${id}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createAsset(
        data: unknown,
        options?: CreateAssetOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/assets`, { data, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async cloneAsset(
        id: string,
        options?: CreateAssetOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/assets/${id}/clone`, { options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listAssets(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/assets`);
            return response.data.assets;
        }
        catch (error) {
            throwError(error);
        }
    }

    async resolveAsset(id: string, options?: ResolveDIDOptions): Promise<unknown | null> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                const response = await axios.get(`${this.API}/assets/${id}?${queryParams.toString()}`);
                return response.data.asset;
            }
            else {
                const response = await axios.get(`${this.API}/assets/${id}`);
                return response.data.asset;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateAsset(id: string, data: Record<string, unknown>): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/assets/${id}`, { data });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async transferAsset(id: string, controller: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/assets/${id}/transfer`, { controller });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createChallenge(challenge: Challenge = {}, options: { registry?: string; validUntil?: string } = {}) {
        try {
            const response = await axios.post(`${this.API}/challenge`, { challenge, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createResponse(
        challenge: string,
        options?: CreateResponseOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/response`, { challenge, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async verifyResponse(
        responseDID: string,
        options?: { retries?: number; delay?: number }
    ): Promise<ChallengeResponse> {
        try {
            const response = await axios.post(`${this.API}/response/verify`, { response: responseDID, options });
            return response.data.verify;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createGroup(
        name: string,
        options?: CreateAssetOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/groups`, { name, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getGroup(group: string): Promise<Group | null> {
        try {
            const response = await axios.get(`${this.API}/groups/${group}`);
            return response.data.group;
        }
        catch (error) {
            throwError(error);
        }
    }

    public async addGroupMember(
        group: string,
        member: string
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/add`, { member });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeGroupMember(
        group: string,
        member: string
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/remove`, { member });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testGroup(
        group: string,
        member?: string
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groups/${group}/test`, { member });
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listGroups(owner?: string): Promise<string[]> {
        try {
            if (owner) {
                const response = await axios.get(`${this.API}/groups?owner=${owner}`);
                return response.data.groups;
            }
            else {
                const response = await axios.get(`${this.API}/groups`);
                return response.data.groups;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async createSchema(
        schema?: unknown,
        options?: CreateAssetOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/schemas`, { schema, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getSchema(id: string): Promise<unknown | null> {
        try {
            const response = await axios.get(`${this.API}/schemas/${id}`);
            return response.data.schema;
        }
        catch (error) {
            throwError(error);
        }
    }

    async setSchema(
        id: string,
        schema: unknown
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/schemas/${id}`, { schema });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testSchema(id: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/schemas/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listSchemas(owner?: string): Promise<string[]> {
        try {
            if (owner) {
                const response = await axios.get(`${this.API}/schemas?owner=${owner}`);
                return response.data.schemas;
            }
            else {
                const response = await axios.get(`${this.API}/schemas`);
                return response.data.schemas;
            }

        }
        catch (error) {
            throwError(error);
        }
    }

    async createTemplate(schemaId: string): Promise<Record<string, unknown>> {
        try {
            const response = await axios.post(`${this.API}/schemas/${schemaId}/template`);
            return response.data.template;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testAgent(id: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/agents/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async bindCredential(
        schema: string,
        subject: string,
        options?: {
            validFrom?: string;
            validUntil?: string;
            credential?: Record<string, unknown>;
        }
    ): Promise<VerifiableCredential> {
        try {
            const response = await axios.post(`${this.API}/credentials/bind`, { schema, subject, options });
            return response.data.credential;
        }
        catch (error) {
            throwError(error);
        }
    }

    async issueCredential(
        credential: Partial<VerifiableCredential>,
        options?: IssueCredentialsOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/credentials/issued`, { credential, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async sendCredential(
        did: string,
        options?: CreateAssetOptions
    ): Promise<string | null> {
        try {
            const response = await axios.post(`${this.API}/credentials/issued/${did}/send`, { options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateCredential(
        did: string,
        credential: VerifiableCredential
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/credentials/issued/${did}`, { credential });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listCredentials(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/credentials/held`);
            return response.data.held;
        }
        catch (error) {
            throwError(error);
        }
    }

    async acceptCredential(did: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/credentials/held`, { did });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getCredential(did: string): Promise<VerifiableCredential | null> {
        try {
            const response = await axios.get(`${this.API}/credentials/held/${did}`);
            return response.data.credential;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeCredential(did: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/credentials/held/${did}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async publishCredential(
        did: string,
        options?: { reveal?: boolean }
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/credentials/held/${did}/publish`, { options });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async unpublishCredential(did: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/credentials/held/${did}/unpublish`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listIssued(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.API}/credentials/issued`);
            return response.data.issued;
        }
        catch (error) {
            throwError(error);
        }
    }

    async revokeCredential(did: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/credentials/issued/${did}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async pollTemplate(): Promise<Poll> {
        try {
            const response = await axios.get(`${this.API}/templates/poll`);
            return response.data.template;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createPoll(
        poll: Poll,
        options?: CreateAssetOptions
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/polls`, { poll, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    public async getPoll(pollId: string): Promise<Poll | null> {
        try {
            const response = await axios.get(`${this.API}/polls/${pollId}`);
            return response.data.poll;
        }
        catch (error) {
            throwError(error);
        }
    }

    async viewPoll(pollId: string): Promise<ViewPollResult> {
        try {
            const response = await axios.get(`${this.API}/polls/${pollId}/view`);
            return response.data.poll;
        }
        catch (error) {
            throwError(error);
        }
    }

    async votePoll(
        pollId: string,
        vote: number,
        options?: {
            spoil?: boolean;
            registry?: string;
            validUntil?: string
        }
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/polls/${pollId}/vote`, { vote, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updatePoll(ballot: string): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/polls/update`, { ballot });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async publishPoll(
        pollId: string,
        options?: { reveal?: boolean }
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/polls/${pollId}/publish`, { options });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async unpublishPoll(pollId: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/polls/${pollId}/unpublish`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createImage(
        data: Buffer,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/images`, data, {
                headers: {
                    // eslint-disable-next-line
                    'Content-Type': 'application/octet-stream',
                    'X-Options': JSON.stringify(options), // Pass options as a custom header
                }
            });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateImage(
        id: string,
        data: Buffer
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/images/${id}`, data, {
                headers: {
                    'Content-Type': 'application/octet-stream'
                }
            });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getImage(id: string): Promise<ImageAsset | null> {
        try {
            const response = await axios.get(`${this.API}/images/${id}`);
            return response.data.image;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testImage(id: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/images/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createDocument(
        data: Buffer,
        options: FileAssetOptions = {}
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/documents`, data, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Options': JSON.stringify(options), // Pass options as a custom header
                }
            });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateDocument(
        id: string,
        data: Buffer,
        options: FileAssetOptions = {}
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/documents/${id}`, data, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Options': JSON.stringify(options), // Pass options as a custom header
                }
            });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getDocument(id: string): Promise<FileAsset | null> {
        try {
            const response = await axios.get(`${this.API}/documents/${id}`);
            return response.data.document;
        }
        catch (error) {
            throwError(error);
        }
    }

    async testDocument(id: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/documents/${id}/test`);
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createGroupVault(options: GroupVaultOptions = {}): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/groupVaults`, { options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getGroupVault(id: string, options?: ResolveDIDOptions): Promise<GroupVault> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                const response = await axios.get(`${this.API}/groupVaults/${id}?${queryParams.toString()}`);
                return response.data.groupVault;
            }
            else {
                const response = await axios.get(`${this.API}/groupVaults/${id}`);
                return response.data.groupVault;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async testGroupVault(id: string, options?: ResolveDIDOptions): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groupVaults/${id}/test`, { options });
            return response.data.test;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addGroupVaultMember(
        vaultId: string,
        memberId: string
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groupVaults/${vaultId}/members`, { memberId });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeGroupVaultMember(
        vaultId: string,
        memberId: string
    ): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/groupVaults/${vaultId}/members/${memberId}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listGroupVaultMembers(vaultId: string): Promise<Record<string, any>> {
        try {
            const response = await axios.get(`${this.API}/groupVaults/${vaultId}/members`);
            return response.data.members;
        }
        catch (error) {
            throwError(error);
        }
    }

    async addGroupVaultItem(
        vaultId: string,
        name: string,
        buffer: Buffer
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/groupVaults/${vaultId}/items`, buffer, {
                headers: {
                    // eslint-disable-next-line
                    'Content-Type': 'application/octet-stream',
                    'X-Options': JSON.stringify({ name }), // Pass name as a custom header
                }
            });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeGroupVaultItem(
        vaultId: string,
        name: string
    ): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/groupVaults/${vaultId}/items/${name}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async listGroupVaultItems(vaultId: string, options?: ResolveDIDOptions): Promise<Record<string, any>> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                const response = await axios.get(`${this.API}/groupVaults/${vaultId}/items?${queryParams.toString()}`);
                return response.data.items;
            }
            else {
                const response = await axios.get(`${this.API}/groupVaults/${vaultId}/items`);
                return response.data.items;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async getGroupVaultItem(vaultId: string, name: string, options?: ResolveDIDOptions): Promise<Buffer | null> {
        try {
            let url = `${this.API}/groupVaults/${vaultId}/items/${name}`;
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                url += `?${queryParams.toString()}`;
            }

            const response = await axios.get(url, {
                responseType: 'arraybuffer'
            });

            if (!response.data || (Buffer.isBuffer(response.data) && response.data.length === 0)) {
                return null;
            }

            return Buffer.from(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;

            // Return null for 404 Not Found
            if (axiosError.response && axiosError.response.status === 404) {
                return null;
            }

            if (axiosError.response && axiosError.response.data instanceof Uint8Array) {
                const textDecoder = new TextDecoder();
                const errorMessage = textDecoder.decode(axiosError.response.data);
                axiosError.response.data = JSON.parse(errorMessage);
            }
            throwError(axiosError);
        }
    }

    async listDmail(): Promise<Record<string, DmailItem>> {
        try {
            const response = await axios.get(`${this.API}/dmail`);
            return response.data.dmail;
        } catch (error) {
            throwError(error);
        }
    }

    async createDmail(
        message: DmailMessage,
        options: GroupVaultOptions = {}
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/dmail`, { message, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateDmail(
        did: string,
        message: DmailMessage
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/dmail/${did}`, { message });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async sendDmail(did: string): Promise<string | null> {
        try {
            const response = await axios.post(`${this.API}/dmail/${did}/send`);
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async fileDmail(
        did: string,
        tags: string[]
    ): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/dmail/${did}/file`, { tags });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeDmail(did: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/dmail/${did}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getDmailMessage(did: string, options?: ResolveDIDOptions): Promise<DmailMessage | null> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                const response = await axios.get(`${this.API}/dmail/${did}?${queryParams.toString()}`);
                return response.data.message;
            }
            else {
                const response = await axios.get(`${this.API}/dmail/${did}`);
                return response.data.message;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async listDmailAttachments(did: string, options?: ResolveDIDOptions): Promise<Record<string, any>> {
        try {
            if (options) {
                const queryParams = new URLSearchParams(options as Record<string, string>);
                const response = await axios.get(`${this.API}/dmail/${did}/attachments?${queryParams.toString()}`);
                return response.data.attachments;
            }
            else {
                const response = await axios.get(`${this.API}/dmail/${did}/attachments`);
                return response.data.attachments;
            }
        }
        catch (error) {
            throwError(error);
        }
    }

    async addDmailAttachment(did: string, name: string, buffer: Buffer): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/dmail/${did}/attachments`, buffer, {
                headers: {
                    // eslint-disable-next-line
                    'Content-Type': 'application/octet-stream',
                    'X-Options': JSON.stringify({ name }), // Pass name as a custom header
                }
            });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async removeDmailAttachment(did: string, name: string): Promise<boolean> {
        try {
            const response = await axios.delete(`${this.API}/dmail/${did}/attachments/${name}`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async getDmailAttachment(did: string, name: string): Promise<Buffer | null> {
        try {
            const response = await axios.get(`${this.API}/dmail/${did}/attachments/${name}`, {
                responseType: 'arraybuffer'
            });

            if (!response.data || (Buffer.isBuffer(response.data) && response.data.length === 0)) {
                return null;
            }

            return Buffer.from(response.data);
        } catch (error) {
            const axiosError = error as AxiosError;

            // Return null for 404 Not Found
            if (axiosError.response && axiosError.response.status === 404) {
                return null;
            }

            if (axiosError.response && axiosError.response.data instanceof Uint8Array) {
                const textDecoder = new TextDecoder();
                const errorMessage = textDecoder.decode(axiosError.response.data);
                axiosError.response.data = JSON.parse(errorMessage);
            }
            throwError(axiosError);
        }
    }

    async importDmail(did: string): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/dmail/import`, { did });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async createNotice(
        message: NoticeMessage,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        try {
            const response = await axios.post(`${this.API}/notices`, { message, options });
            return response.data.did;
        }
        catch (error) {
            throwError(error);
        }
    }

    async updateNotice(
        did: string,
        message: NoticeMessage
    ): Promise<boolean> {
        try {
            const response = await axios.put(`${this.API}/notices/${did}`, { message });
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async refreshNotices(): Promise<boolean> {
        try {
            const response = await axios.post(`${this.API}/notices/refresh`);
            return response.data.ok;
        }
        catch (error) {
            throwError(error);
        }
    }

    async exportEncryptedWallet(): Promise<WalletEncFile> {
        try {
            const response = await axios.get(`${this.API}/export/wallet/encrypted`);
            return response.data.wallet;
        }
        catch (error) {
            throwError(error);
        }
    }
}
