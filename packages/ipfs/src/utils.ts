import { CID } from 'multiformats';

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
