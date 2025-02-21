import IPFS from '@mdip/ipfs';

export function copyJSON(json) {
    return JSON.parse(JSON.stringify(json));
}

export function isValidDID(did) {
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
    return IPFS.isValidCID(suffix);
}

export function compareOrdinals(a, b) {
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
