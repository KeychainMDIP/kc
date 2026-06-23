import { ChallengeReceiptRecord } from "./types.js";

interface MaybeChallengeReceipt {
    version?: unknown;
    attesterDid?: unknown;
    schemaDid?: unknown;
    requesterDid?: unknown;
    responseCommitment?: unknown;
}

interface MaybeMdipDocument {
    didDocument?: {
        id?: unknown;
    };
    didDocumentData?: {
        challengeReceipt?: unknown;
    };
    didDocumentMetadata?: {
        updated?: unknown;
        created?: unknown;
    };
}

function isDid(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('did:');
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isIsoDateString(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function getOperationUpdatedAt(doc: MaybeMdipDocument): string | null {
    const updatedAt = doc.didDocumentMetadata?.updated ?? doc.didDocumentMetadata?.created;

    return isIsoDateString(updatedAt) ? updatedAt : null;
}

export function extractChallengeReceipts(
    defaultReceiptDid: string,
    doc: object
): ChallengeReceiptRecord[] {
    const mdipDoc = doc as MaybeMdipDocument;
    const receiptDid = isDid(mdipDoc.didDocument?.id)
        ? mdipDoc.didDocument.id
        : defaultReceiptDid;

    if (!isDid(receiptDid)) {
        return [];
    }

    const value = mdipDoc.didDocumentData?.challengeReceipt;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }

    const receipt = value as MaybeChallengeReceipt;

    const updatedAt = getOperationUpdatedAt(mdipDoc);

    if (receipt.version !== 1 ||
        !isDid(receipt.attesterDid) ||
        !isDid(receipt.schemaDid) ||
        !isDid(receipt.requesterDid) ||
        !updatedAt ||
        !isNonEmptyString(receipt.responseCommitment)) {
        return [];
    }

    return [
        {
            receiptDid,
            attesterDid: receipt.attesterDid,
            schemaDid: receipt.schemaDid,
            requesterDid: receipt.requesterDid,
            responseCommitment: receipt.responseCommitment,
            updatedAt,
        },
    ];
}
