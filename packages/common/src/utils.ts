import HeliaClient from '@mdip/ipfs/helia';

export function copyJSON<T>(json: T): T {
    return JSON.parse(JSON.stringify(json)) as T;
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
    return HeliaClient.isValidCID(suffix);
}

export function compareOrdinals(a: number[], b: number[]): -1 | 0 | 1 {
    // An ordinal is a list of integers
    // Return -1 if a < b, 0 if a == b, 1 if a > b

    const minLength = Math.min(a.length, b.length);

    for (let i = 0; i < minLength; i++) {
        if (a[i] < b[i]) {
            return -1;
        }
        if (a[i] > b[i]) {
            return 1;
        }
    }

    // If all compared elements are equal, the longer list is considered greater
    if (a.length < b.length) {
        return -1;
    }

    if (a.length > b.length) {
        return 1;
    }

    return 0;
}
