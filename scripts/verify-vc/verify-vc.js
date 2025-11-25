import { GatekeeperClient } from '@mdip/gatekeeper';
import CipherNode from '@mdip/cipher';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function main() {
    const GATEKEEPER_SERVICE_URL = process.env.GATEKEEPER_SERVICE_URL || 'http://localhost:4224';
    const gatekeeper = new GatekeeperClient();
    await gatekeeper.connect({
        url: GATEKEEPER_SERVICE_URL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true
    });

    const cipher = new CipherNode();

    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node verify-vc.js <vc-file>");
        process.exit(1);
    }
    const contents = fs.readFileSync(file).toString();
    const vc = JSON.parse(contents);

    console.log(`verifying credential: ${JSON.stringify(vc, null, 4)}`);

    const signature = vc.signature;

    // Get public key of VC issuer by resolving their DID
    const doc = await gatekeeper.resolveDID(signature.signer, { atTime: signature.signed });
    const verificationMethods = doc.didDocument.verificationMethod;
    const publicKeyJwk = verificationMethods[0].publicKeyJwk;

    console.log(`Public Key JWK: ${JSON.stringify(publicKeyJwk, null, 4)}`);

    // Verify the signature using standard JWK verification
    const validSig = cipher.verifySig(signature.hash, signature.value, publicKeyJwk);
    console.log(`Signature valid: ${validSig}`);

    // Check hash of VC without the signature
    delete vc.signature;
    const canonicalized = cipher.canonicalizeJSON(vc);
    const hash = cipher.hashMessage(canonicalized);
    const hashMatches = (hash === signature.hash);
    console.log(`Hash matches: ${hashMatches}`);

    if (validSig && hashMatches) {
        console.log("Credential is valid");
    } else {
        console.log("Credential is NOT valid");
    }
}

main().catch(error => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
});
