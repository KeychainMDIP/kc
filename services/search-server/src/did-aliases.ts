import { isValidDID } from '@mdip/ipfs/utils';
import type { DIDsDb } from './types.js';

export async function findDIDReadTarget(didDb: DIDsDb, did: string) {
    const events = await didDb.getDIDEvents(did);
    if (events.length > 0 || !isValidDID(did)) {
        return { storedDid: did, events };
    }

    const storedDid = await didDb.findDIDBySuffix(did.split(':').pop()!);
    return storedDid
        ? { storedDid, events: await didDb.getDIDEvents(storedDid) }
        : { storedDid: did, events };
}
