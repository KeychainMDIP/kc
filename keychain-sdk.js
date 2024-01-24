import canonicalize from 'canonicalize';
import * as cipher from './cipher.js';
import * as keychain from './keychain.js';

async function verifySig(json) {
    if (!json.signature) {
        return false;
    }

    const jsonCopy = JSON.parse(JSON.stringify(json));

    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msg = canonicalize(jsonCopy);
    const msgHash = cipher.hashMessage(msg);

    // console.log(`msgHash        = ${msgHash}`);
    // console.log(`signature.hash = ${signature.hash}`);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    const diddoc = await keychain.resolveDid(signature.signer, signature.created);
    const doc = JSON.parse(diddoc);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

    return isValid;
}

export {
    verifySig,
}
