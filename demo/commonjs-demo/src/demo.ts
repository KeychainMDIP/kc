import Keymaster from '@mdip/keymaster';
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import CipherNode from '@mdip/cipher/node';

import dotenv from 'dotenv';

dotenv.config();

const GATEKEEPER_SERVICE_URL = process.env.GATEKEEPER_SERVICE_URL || 'http://localhost:4224';

async function main() {
    const gatekeeperClient = new GatekeeperClient();
    try {
        await gatekeeperClient.connect({
            url: GATEKEEPER_SERVICE_URL,
            waitUntilReady: true,
            intervalSeconds: 5,
            chatty: true
        });
        console.log('Successfully connected to Gatekeeper service.');
    } catch (error) {
        console.error(`Failed to connect to Gatekeeper service at ${GATEKEEPER_SERVICE_URL}:`, error);
        process.exit(1);
    }

    const wallet = new WalletJsonMemory();
    const cipher = new CipherNode();

    const keymaster = new Keymaster({
        gatekeeper: gatekeeperClient,
        wallet,
        cipher,
        defaultRegistry: 'local'
    });

    try {
        const uniqueIdName = `user_${Date.now()}`;

        const userDID = await keymaster.createId(uniqueIdName);
        console.log('Created User DID:', userDID);

        const didDocument = await keymaster.resolveDID(userDID);
        console.log('User DID Document:');
        console.log(JSON.stringify(didDocument, null, 2));

    } catch (error) {
        console.error(`An error occurred during the demo: ${error}`);
    }
}

main().catch(error => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
});
