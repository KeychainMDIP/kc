import { PublishedCredentialRecord } from "./types.js";

interface MaybeVc {
    type?: unknown;
    issuer?: unknown;
    credential?: unknown;
    signature?: {
        signed?: unknown;
    };
    credentialSubject?: {
        id?: unknown;
    };
}

interface MaybeMdipDocument {
    didDocument?: {
        id?: unknown;
    };
    didDocumentData?: {
        manifest?: unknown;
    };
    didDocumentMetadata?: {
        updated?: unknown;
        created?: unknown;
    };
}

function isDid(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('did:');
}

function getFallbackUpdatedAt(doc: MaybeMdipDocument): string {
    const updatedAt = doc.didDocumentMetadata?.updated ?? doc.didDocumentMetadata?.created;

    return typeof updatedAt === 'string' ? updatedAt : '';
}

function getPublishedAt(vc: MaybeVc, doc: MaybeMdipDocument): string {
    const signedAt = vc.signature?.signed;

    if (typeof signedAt === 'string') {
        return signedAt;
    }

    return getFallbackUpdatedAt(doc);
}

export function extractPublishedCredentials(
    defaultHolderDid: string,
    doc: object
): PublishedCredentialRecord[] {
    const mdipDoc = doc as MaybeMdipDocument;
    const holderDid = isDid(mdipDoc.didDocument?.id)
        ? mdipDoc.didDocument.id
        : defaultHolderDid;

    const manifest = mdipDoc.didDocumentData?.manifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return [];
    }

    const rows: PublishedCredentialRecord[] = [];

    for (const [credentialDid, value] of Object.entries(manifest as Record<string, unknown>)) {
        if (!isDid(credentialDid) || !value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }

        const vc = value as MaybeVc;
        const type = Array.isArray(vc.type) ? vc.type : [];
        const schemaDid = type[1];
        const issuerDid = vc.issuer;
        const subjectDid = vc.credentialSubject?.id;

        if (type[0] !== 'VerifiableCredential' ||
            !isDid(schemaDid) ||
            !isDid(issuerDid) ||
            !isDid(subjectDid) ||
            subjectDid !== holderDid) {
            continue;
        }

        rows.push({
            holderDid,
            credentialDid,
            schemaDid,
            issuerDid,
            subjectDid,
            revealed: vc.credential !== null && vc.credential !== undefined,
            updatedAt: getPublishedAt(vc, mdipDoc),
        });
    }

    return rows;
}
