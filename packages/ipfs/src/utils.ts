import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as rawCodec from 'multiformats/codecs/raw';
import * as sha256 from 'multiformats/hashes/sha2';

export function isValidCID(cid: any): boolean {
    try {
        CID.parse(cid);
        return true;
    } catch (error) {
        return false;
    }
}

export function isValidDID(did: string): boolean {
    if (typeof did !== 'string') {
        return false;
    }

    if (!did.startsWith('did:')) {
        return false;
    }

    const parts = did.split(':');

    if (parts.length < 3) {
        return false;
    }

    const suffix = parts.pop();
    return isValidCID(suffix);
}

export async function generateCID(data: any): Promise<string> {
    let buf;
    let code;

    if (typeof data === 'string') {
        buf = new TextEncoder().encode(data);
        code = rawCodec.code;
    }
    else if (data instanceof Buffer) {
        buf = data;
        code = rawCodec.code;
    }
    else {
        buf = jsonCodec.encode(data);
        code = jsonCodec.code;
    }

    const hash = await sha256.sha256.digest(buf);
    const cid = CID.createV1(code, hash);
    
    return cid.toString(base58btc);
}
