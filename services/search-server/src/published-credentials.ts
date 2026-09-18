import type { GatekeeperEvent, IdentityListOptions, IdentityRecord, PublishedCredentialRecord } from "./types.js";
import { getDIDSuffix } from './did-aliases.js';

interface MaybeVc {
    type?: unknown;
    issuer?: unknown;
    validFrom?: unknown;
    credential?: unknown;
    signature?: {
        signed?: unknown;
    };
    credentialSubject?: {
        id?: unknown;
    };
}

export interface PublishedCredentialEvidence {
    credential: PublishedCredentialRecord;
    validFrom?: string;
}

interface MaybeMdipDocument {
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

export function extractPublishedCredentialEvidence(
    defaultHolderDid: string,
    doc: object
): PublishedCredentialEvidence[] {
    const mdipDoc = doc as MaybeMdipDocument;
    const holderDid = defaultHolderDid;

    const manifest = mdipDoc.didDocumentData?.manifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return [];
    }

    const rows: PublishedCredentialEvidence[] = [];

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
            !isDid(holderDid) ||
            !isDid(schemaDid) ||
            !isDid(issuerDid) ||
            !isDid(subjectDid) ||
            getDIDSuffix(subjectDid) !== getDIDSuffix(holderDid)) {
            continue;
        }

        rows.push({
            credential: {
                holderDid,
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid: holderDid,
                revealed: vc.credential !== null && vc.credential !== undefined,
                updatedAt: getPublishedAt(vc, mdipDoc),
            },
            ...(typeof vc.validFrom === 'string' ? { validFrom: vc.validFrom } : {}),
        });
    }

    return rows;
}

export function extractPublishedCredentials(
    defaultHolderDid: string,
    doc: object
): PublishedCredentialRecord[] {
    return extractPublishedCredentialEvidence(defaultHolderDid, doc)
        .map(evidence => evidence.credential);
}

function getCredentialClaims(doc: object, credentialDid: string): Record<string, unknown> | undefined {
    const manifest = (doc as MaybeMdipDocument).didDocumentData?.manifest as Record<string, MaybeVc> | undefined;
    const claims = manifest?.[credentialDid]?.credential;
    return claims && typeof claims === 'object' && !Array.isArray(claims)
        ? claims as Record<string, unknown> : undefined;
}

export function extractIdentityFields(
    doc: object,
    published: PublishedCredentialRecord[]
): Map<string, Set<string>> {
    const schemaFields = new Map<string, Set<string>>();
    for (const record of published) {
        const claims = getCredentialClaims(doc, record.credentialDid);
        if (!claims) continue;
        const suffix = getDIDSuffix(record.schemaDid);
        const fields = schemaFields.get(suffix) ?? new Set<string>();
        for (const field of Object.keys(claims)) fields.add(field);
        schemaFields.set(suffix, fields);
    }
    return schemaFields;
}

export function extractIdentity(
    did: string,
    doc: object,
    { schemaDid, fields = [] }: IdentityListOptions
): IdentityRecord {
    const published = extractPublishedCredentials(did, doc);
    const identity: IdentityRecord = {
        did,
        manifestSchemaDids: [...new Set(published.map(record => record.schemaDid))].sort(),
    };

    if (fields.length > 0) {
        identity.credentials = published
            .filter(record => record.revealed && (!schemaDid
                || getDIDSuffix(record.schemaDid) === getDIDSuffix(schemaDid)))
            .sort((a, b) => a.credentialDid < b.credentialDid ? -1 : a.credentialDid > b.credentialDid ? 1 : 0)
            .flatMap(record => {
                const claims = getCredentialClaims(doc, record.credentialDid);
                if (!claims) {
                    return [];
                }
                const selected = fields.filter(field => Object.hasOwn(claims, field));
                if (selected.length === 0) return [];
                return [{
                    credentialDid: record.credentialDid,
                    issuerDid: record.issuerDid,
                    updatedAt: record.updatedAt,
                    fields: Object.fromEntries(selected.map(field => [field, claims[field]])),
                }];
            });
    }

    return identity;
}

export function extractPublishedCredentialHistory(
    defaultHolderDid: string,
    events: GatekeeperEvent[]
): PublishedCredentialEvidence[] {
    return events.flatMap(event => event.operation.type === 'update' && event.operation.doc
        ? extractPublishedCredentialEvidence(defaultHolderDid, event.operation.doc)
        : []
    );
}

export function deduplicateDIDPrefixReferences(
    references: string[],
    publishedCredentials: PublishedCredentialRecord[] = []
): string[] {
    return Array.from(new Set([
        ...references,
        ...publishedCredentials.flatMap(record => [record.credentialDid, record.schemaDid]),
    ]));
}
