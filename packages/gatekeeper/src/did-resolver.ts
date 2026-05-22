import CipherNode from '@mdip/cipher/node';
import { InvalidOperationError } from '@mdip/common/errors';
import { copyJSON } from '@mdip/common/utils';
import { generateCID, isValidDID } from '@mdip/ipfs/utils';

import type {
    GenerateCID,
    GenerateDocFromOperationOptions,
    MdipDocument,
    Operation,
    ResolveDIDFromEventsParams,
} from './types.js';

export const ValidVersions = [1];
export const ValidTypes = ['agent', 'asset'];
// Registries that are considered valid when importing DIDs from the network
export const ValidRegistries = [
    'local',
    'hyperswarm',
    'TESS',
    'TBTC',
    'TFTC',
    'Signet',
    'Signet-Inscription',
    'BTC-Inscription'
];

const cipher = new CipherNode();

export async function generateOperationCID(operation: unknown): Promise<string> {
    const canonical = cipher.canonicalizeJSON(operation);
    return generateCID(JSON.parse(canonical));
}

export async function generateDIDFromOperation(
    operation: Operation,
    options?: {
        didPrefix?: string;
        generateCID?: GenerateCID;
    }
): Promise<string> {
    const generateOperationCIDForDID = options?.generateCID ?? generateOperationCID;
    const cid = await generateOperationCIDForDID(operation);
    const prefix = operation.mdip?.prefix || options?.didPrefix || 'did:test';
    return `${prefix}:${cid}`;
}

export async function generateDocFromOperation(
    anchor: Operation,
    options?: GenerateDocFromOperationOptions
): Promise<MdipDocument> {
    let doc: MdipDocument = {};
    try {
        if (!anchor?.mdip) {
            return {};
        }

        if (!ValidVersions.includes(anchor.mdip.version)) {
            return {};
        }

        if (!ValidTypes.includes(anchor.mdip.type)) {
            return {};
        }

        if (!ValidRegistries.includes(anchor.mdip.registry)) {
            return {};
        }

        const did = options?.defaultDID
            ?? (options?.generateDID
                ? await options.generateDID(anchor)
                : await generateDIDFromOperation(anchor, options));

        if (anchor.mdip.type === 'agent') {
            // TBD support different key types?
            doc = {
                "didDocument": {
                    "@context": ["https://www.w3.org/ns/did/v1"],
                    "id": did,
                    "verificationMethod": [
                        {
                            "id": "#key-1",
                            "controller": did,
                            "type": "EcdsaSecp256k1VerificationKey2019",
                            "publicKeyJwk": anchor.publicJwk,
                        }
                    ],
                    "authentication": [
                        "#key-1"
                    ],
                },
                "didDocumentMetadata": {
                    "created": anchor.created,
                },
                "didDocumentData": {},
                "mdip": anchor.mdip,
            };
        }

        if (anchor.mdip.type === 'asset') {
            doc = {
                "didDocument": {
                    "@context": ["https://www.w3.org/ns/did/v1"],
                    "id": did,
                    "controller": anchor.controller,
                },
                "didDocumentMetadata": {
                    "created": anchor.created,
                },
                "didDocumentData": anchor.data,
                "mdip": anchor.mdip,
            };
        }

        if (doc.didDocumentMetadata && anchor.mdip.prefix) {
            doc.didDocumentMetadata.canonicalId = did;
        }
    }
    catch {
    }

    return doc;
}

function generateStandardDatetime(time: any): string {
    const date = new Date(time);
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function invalidDIDDocument(): MdipDocument {
    return {
        didResolutionMetadata: {
            error: "invalidDid"
        },
        didDocument: {},
        didDocumentMetadata: {}
    };
}

function notFoundDIDDocument(): MdipDocument {
    return {
        didResolutionMetadata: {
            error: "notFound"
        },
        didDocument: {},
        didDocumentMetadata: {}
    };
}

export async function resolveDIDFromEvents(params: ResolveDIDFromEventsParams): Promise<MdipDocument> {
    const {
        did,
        events,
        options,
        didPrefix,
        getBlock,
        verifyCreateOperation,
        verifyUpdateOperation,
        now = () => new Date(),
    } = params;
    const { versionTime, versionSequence, confirm = false, verify = false } = options || {};
    const generateOperationCIDForVersion = params.generateCID ?? generateOperationCID;
    const generateDIDForDoc = params.generateDID
        ?? ((operation: Operation) => generateDIDFromOperation(operation, {
            didPrefix,
            generateCID: generateOperationCIDForVersion,
        }));

    if (!did || !isValidDID(did)) {
        return invalidDIDDocument();
    }

    if (events.length === 0) {
        return notFoundDIDDocument();
    }

    const anchor = events[0];
    let doc = await generateDocFromOperation(anchor.operation, {
        defaultDID: did,
        didPrefix,
        generateCID: generateOperationCIDForVersion,
        generateDID: generateDIDForDoc,
    });

    if (versionTime && doc.mdip?.created && new Date(doc.mdip.created) > new Date(versionTime)) {
        // TBD What to return if DID was created after specified time?
    }

    const created = generateStandardDatetime(doc.didDocumentMetadata?.created);
    const canonicalId = doc.didDocumentMetadata?.canonicalId;
    let versionNum = 1;
    let confirmed = true;

    for (const { time, operation, registry, blockchain, opid } of events) {
        const versionId = opid || await generateOperationCIDForVersion(operation);
        const updated = generateStandardDatetime(time);
        let timestamp;

        if (doc.mdip?.registry) {
            let lowerBound;
            let upperBound;

            if (operation.blockid && getBlock) {
                const lowerBlock = await getBlock(doc.mdip.registry, operation.blockid);

                if (lowerBlock) {
                    lowerBound = {
                        time: lowerBlock.time,
                        timeISO: new Date(lowerBlock.time * 1000).toISOString(),
                        blockid: lowerBlock.hash,
                        height: lowerBlock.height,
                    };
                }
            }

            if (blockchain && getBlock) {
                const upperBlock = await getBlock(doc.mdip.registry, blockchain.height);

                if (upperBlock) {
                    upperBound = {
                        time: upperBlock.time,
                        timeISO: new Date(upperBlock.time * 1000).toISOString(),
                        blockid: upperBlock.hash,
                        height: upperBlock.height,
                        txid: blockchain.txid,
                        txidx: blockchain.index,
                        batchid: blockchain.batch,
                        opidx: blockchain.opidx,
                    };
                }
            }

            if (lowerBound || upperBound) {
                timestamp = {
                    chain: doc.mdip.registry,
                    opid: versionId,
                    lowerBound,
                    upperBound,
                };
            }
        }

        if (operation.type === 'create') {
            if (verify) {
                if (!verifyCreateOperation) {
                    throw new InvalidOperationError('verifyCreateOperation');
                }

                const valid = await verifyCreateOperation(operation);

                if (!valid) {
                    throw new InvalidOperationError('signature');
                }
            }

            doc.didDocumentMetadata = {
                created,
                canonicalId,
                versionId,
                version: versionNum.toString(),
                confirmed,
                timestamp,
            };
            continue;
        }

        if (versionTime && new Date(time) > new Date(versionTime)) {
            break;
        }

        if (versionSequence && versionNum === versionSequence) {
            break;
        }

        confirmed = confirmed && doc.mdip?.registry === registry;

        if (confirm && !confirmed) {
            break;
        }

        if (verify) {
            if (!verifyUpdateOperation) {
                throw new InvalidOperationError('verifyUpdateOperation');
            }

            const valid = await verifyUpdateOperation(operation, doc);

            if (!valid) {
                throw new InvalidOperationError('signature');
            }

            if (operation.previd && operation.previd !== doc.didDocumentMetadata?.versionId) {
                throw new InvalidOperationError('previd');
            }
        }

        if (operation.type === 'update') {
            versionNum += 1;

            doc = operation.doc || {};
            doc.didDocumentMetadata = {
                created,
                updated,
                canonicalId,
                versionId,
                version: versionNum.toString(),
                confirmed,
                timestamp,
            };
            continue;
        }

        if (operation.type === 'delete') {
            versionNum += 1;

            doc.didDocument = { id: did };
            doc.didDocumentData = {};
            doc.didDocumentMetadata = {
                deactivated: true,
                created,
                deleted: updated,
                canonicalId,
                versionId,
                version: versionNum.toString(),
                confirmed,
                timestamp,
            };
        }
    }

    doc.didResolutionMetadata = {
        retrieved: now().toISOString(),
    };

    delete (doc as any)['@context'];

    if (doc.mdip) {
        delete doc.mdip.opid;
        delete doc.mdip.registration;
    }

    return copyJSON(doc);
}
