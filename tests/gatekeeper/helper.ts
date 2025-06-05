import CipherNode from '@mdip/cipher/node';
import { Operation, MdipDocument } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import type { EcdsaJwkPair } from '@mdip/cipher/types';

export default class TestHelper {
    private gatekeeper: Gatekeeper;
    private cipher: CipherNode;

    constructor(gatekeeper: Gatekeeper, cipher: CipherNode) {
        this.gatekeeper = gatekeeper;
        this.cipher = cipher;
    }

    async createAgentOp(
        keypair: EcdsaJwkPair,
        options: {
            version?: number;
            registry?: string;
            prefix?: string;
        } = {}
    ): Promise<Operation> {
        const { version = 1, registry = 'local', prefix } = options;
        const operation: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: version,
                type: "agent",
                registry: registry,
            },
            publicJwk: keypair.publicJwk,
        };

        if (prefix) {
            operation.mdip!.prefix = prefix;
        }

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...operation,
            signature: {
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature
            }
        };
    }

    async createUpdateOp(
        keypair: EcdsaJwkPair,
        did: string,
        doc: MdipDocument,
        options: {
            excludePrevid?: boolean;
            mockPrevid?: string;
            mockBlockid?: string;
        } = {}
    ): Promise<Operation> {
        const { excludePrevid = false, mockPrevid } = options;
        const current = await this.gatekeeper.resolveDID(did);
        const previd = excludePrevid ? undefined : mockPrevid ? mockPrevid : current.didDocumentMetadata?.versionId;
        const { mockBlockid } = options;

        const operation: Operation = {
            type: "update",
            did,
            previd,
            ...(mockBlockid !== undefined && { blockid: mockBlockid }),
            doc,
        };

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...operation,
            signature: {
                signer: did,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };
    }

    async createDeleteOp(
        keypair: EcdsaJwkPair,
        did: string
    ): Promise<Operation> {
        const current = await this.gatekeeper.resolveDID(did);
        const previd = current.didDocumentMetadata?.versionId;

        const operation: Operation = {
            type: "delete",
            did,
            previd,
        };

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...operation,
            signature: {
                signer: did,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };
    }

    async createAssetOp(
        agent: string,
        keypair: EcdsaJwkPair,
        options: {
            registry?: string;
            validUntil?: string | null;
        } = {}
    ): Promise<Operation> {
        const { registry = 'local', validUntil = null } = options;
        const dataAnchor: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry,
                validUntil: validUntil || undefined
            },
            controller: agent,
            data: "mockData",
        };

        const msgHash = this.cipher.hashJSON(dataAnchor);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...dataAnchor,
            signature: {
                signer: agent,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };
    }
}
