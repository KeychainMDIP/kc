import { DIDsDb } from "../types.js";

type JSONObject = Record<string, unknown>;

export default class DIDsDbMemory implements DIDsDb {
    private docs = new Map<string, JSONObject>();
    private config = new Map<string, string>();
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    async connect(): Promise<void> {};
    async disconnect(): Promise<void> {};

    async loadUpdatedAfter(): Promise<string | null> {
        return this.config.get('updated_after') ?? null;
    }

    async saveUpdatedAfter(timestamp: string): Promise<void> {
        this.config.set('updated_after', timestamp);
    }

    async storeDID(did: string, doc: object): Promise<void> {
        this.docs.set(did, JSON.parse(JSON.stringify(doc)) as JSONObject);
    }

    async getDID(did: string): Promise<object | null> {
        const v = this.docs.get(did);
        return v ? JSON.parse(JSON.stringify(v)) : null;
    }

    async searchDocs(q: string): Promise<string[]> {
        const out: string[] = [];
        for (const [did, doc] of this.docs.entries()) {
            if (JSON.stringify(doc).includes(q)) out.push(did);
        }
        return out;
    }

    async queryDocs(where: Record<string, unknown>): Promise<string[]> {
        const entry = Object.entries(where)[0] as [string, any] | undefined;
        if (!entry) {
            return [];
        }
        const [rawPath, cond] = entry;
        if (typeof cond !== 'object' || !Array.isArray((cond as any).$in)) {
            throw new Error('Only {$in:[…]} supported');
        }
        const list = (cond as any).$in;

        const isKeyWildcard = rawPath.endsWith('.*');
        const isValueWildcard = rawPath.includes('.*.');
        const isArrayTail = DIDsDbMemory.ARRAY_WILDCARD_END.test(rawPath);
        const isArrayMid = DIDsDbMemory.ARRAY_WILDCARD_MID.test(rawPath);

        const result: string[] = [];

        for (const [did, doc] of this.docs.entries()) {
            let match = false;

            if (isArrayTail) {
                const basePath = rawPath.replace(DIDsDbMemory.ARRAY_WILDCARD_END, '');
                const arr = this.getPath(doc, basePath);
                if (Array.isArray(arr)) {
                    match = arr.some(v => list.includes(v));
                }
            } else if (isArrayMid) {
                const [prefix, suffix] = rawPath.split('[*].');
                const arr = this.getPath(doc, prefix);
                if (Array.isArray(arr)) {
                    match = arr.some(el => list.includes(this.getPath(el, suffix)));
                }
            } else if (isKeyWildcard) {
                const basePath = rawPath.slice(0, -2);
                const obj = this.getPath(doc, basePath);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    const keys = Object.keys(obj as Record<string, unknown>);
                    match = keys.some(k => list.includes(k));
                }
            } else if (isValueWildcard) {
                const [prefix, suffix] = rawPath.split('.*.');
                const obj = this.getPath(doc, prefix);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    const values = Object.values(obj as Record<string, unknown>);
                    match = values.some(v => list.includes(this.getPath(v, suffix)));
                }
            } else {
                const val = this.getPath(doc, rawPath);
                match = list.includes(val);
            }

            if (match) {
                result.push(did);
            }
        }

        return result;
    }

    async wipeDb(): Promise<void> {
        this.docs.clear();
        this.config.clear();
    }

    private getPath(root: unknown, path: string): any {
        if (!path || root == null) {
            return undefined;
        }

        const clean = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
        if (!clean) {
            return root;
        }

        const parts = clean.split('.');

        let cur: any = root;
        for (const rawPart of parts) {
            if (cur == null) {
                return undefined;
            }

            const idx = Number.isInteger(+rawPart) ? +rawPart : null;

            if (idx !== null && Array.isArray(cur)) {
                cur = cur[idx];
                continue;
            }

            if (typeof cur === 'object') {
                cur = (cur as Record<string, unknown>)[rawPart];
            } else {
                return undefined;
            }
        }
        return cur;
    }
}
