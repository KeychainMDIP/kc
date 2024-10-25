import * as gatekeeper from '@mdip/gatekeeper/sdk';
import config from './config.js';

export async function verifyDID(did) {
    console.time('resolveDID');
    const doc = await gatekeeper.resolveDID(did, { verify: true });
    console.timeEnd('resolveDID');
    const isoDate = doc?.mdip?.validUntil;

    if (isoDate) {
        const validUntil = new Date(isoDate);
        const now = new Date();

        // Check if validUntil is a valid date
        if (isNaN(validUntil.getTime())) {
            throw new Error(exceptions.INVALID_DID);
        }

        if (validUntil < now) {
            return { expired: true, status: 'Expired' };
        }

        const minutesLeft = Math.round((validUntil.getTime() - now.getTime()) / 60 / 1000);
        return { expired: false, status: `Expires in ${minutesLeft} minutes` };
    }

    return { expired: false, status: "OK" };
}

export async function verifyDb(chatty = true) {
    if (chatty) {
        console.time('verifyDb');
    }

    const dids = await gatekeeper.getDIDs();
    const total = dids.length;
    let n = 0;
    let verified = 0;
    let expired = 0;
    let invalid = 0;
    let removeList = [];

    for (const did of dids) {
        n += 1;
        try {
            console.time('verifyDID');
            const { expired: didExpired, status } = await verifyDID(did);
            console.timeEnd('verifyDID');

            if (didExpired) {
                if (chatty) {
                    console.log(`removing ${n}/${total} ${did} ${status}`);
                }
                removeList.push(did);
                expired += 1;
            }
            else {
                if (chatty) {
                    console.log(`verifying ${n}/${total} ${did} ${status}`);
                }
                verified += 1;
            }
        }
        catch (error) {
            if (chatty) {
                console.log(`removing ${n}/${total} ${did} ${error}`);
            }
            invalid += 1;
            removeList.push(did);
        }
    }

    if (removeList.length > 0) {
        await gatekeeper.removeDIDs(removeList);
    }

    if (chatty) {
        console.timeEnd('verifyDb');
    }

    return { total, verified, expired, invalid };
}

async function main() {
    await gatekeeper.start({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    await verifyDb();
}

main();
