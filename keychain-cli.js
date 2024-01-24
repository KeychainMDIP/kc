import { program } from 'commander';
import fs from 'fs';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
import * as keymaster from './keymaster.js';
import * as gatekeeper from './gatekeeper.js';
import * as cipher from './cipher.js';
import assert from 'assert';

const wallet = keymaster.wallet;

async function createId(name) {
    try {
        const did = await keymaster.createId(name);
        console.log(did);
    }
    catch (error) {
        console.error(error);
    }
}

async function removeId(name) {
    try {
        keymaster.removeId(name);
        console.log(`ID ${name} removed`);
    }
    catch (error) {
        console.error(error);
    }
}

function listIds() {
    try {
        const ids = keymaster.listIds();

        for (let id of ids) {
            if (id === wallet.current) {
                console.log(id, ' <<< current');
            }
            else {
                console.log(id);
            }
        }
    }
    catch (error) {
        console.error(error);
    }
}

function useId(name) {
    try {
        keymaster.useId(name);
        listIds();
    }
    catch (error) {
        console.error(error);
    }
}

async function encryptMessage(msg, did) {
    try {
        const cipherDid = await keymaster.encrypt(msg, did);
        console.log(cipherDid);
    }
    catch (error) {
        console.error(error);
    }
}

async function encryptFile(file, did) {
    try {
        const contents = fs.readFileSync(file).toString();
        const cipherDid = await keymaster.encrypt(contents, did);
        console.log(cipherDid);
    }
    catch (error) {
        console.error(error);
    }
}

async function decryptDid(did) {
    try {
        const plaintext = await keymaster.decrypt(did);
        console.log(plaintext);
    }
    catch (error) {
        console.error(`cannot decrypt ${did}`);
    }
}

async function resolveDid(did) {
    try {
        const doc = await gatekeeper.resolveDid(did)
        console.log(doc);
    }
    catch (error) {
        console.error(`cannot resolve ${did}`);
    }
}

async function signFile(file) {
    try {
        const id = wallet.ids[wallet.current];
        const contents = fs.readFileSync(file).toString();
        const json = await keymaster.signJson(id, JSON.parse(contents));
        console.log(JSON.stringify(json, null, 4));
    }
    catch (error) {
        console.error(`cannot sign ${file}`);
    }
}

async function verifyFile(file) {
    try {
        const json = JSON.parse(fs.readFileSync(file).toString());
        const isValid = await keymaster.verifySig(json);
        console.log(`signature in ${file}`, isValid ? 'is valid' : 'is NOT valid');
    }
    catch (error) {
        console.error('cannot verify signature');
    }
}

async function createVC(file, did) {
    try {
        const id = wallet.ids[wallet.current];
        const schema = JSON.parse(fs.readFileSync(file).toString());
        const schemaDid = await gatekeeper.generateDid({
            controller: id.did,
            schema: schema,
        });
        const vc = JSON.parse(fs.readFileSync('did-vc.template').toString());
        const atom = JSONSchemaFaker.generate(schema);

        vc.issuer = id.did;
        vc.credentialSubject.id = did;
        vc.validFrom = new Date().toISOString();
        vc.type.push(schemaDid);
        vc.credential = atom;

        console.log(JSON.stringify(vc, null, 4));
    }
    catch (error) {
        console.error('cannot create VC');
    }
}

async function attestVC(file) {
    try {
        const id = wallet.ids[wallet.current];
        const vc = JSON.parse(fs.readFileSync(file).toString());
        const signed = await signJson(id, vc);
        const msg = JSON.stringify(signed);
        const cipherDid = await encrypt(msg, vc.credentialSubject.id);
        console.log(cipherDid);
    }
    catch (error) {
        console.error(`cannot attest ${file}`)
    }
}

async function revokeVC(did) {
    try {
        const id = wallet.ids[wallet.current];
        const ok = await updateDoc(id, did, {});
        assert.ok(ok);
        console.log('OK revoked');
    }
    catch (error) {
        console.error(`cannot revoke ${did}`);
    }
}

async function updateDoc(id, did, doc) {
    const txn = {
        op: "replace",
        time: new Date().toISOString(),
        did: did,
        doc: doc,
    };

    const signed = await signJson(id, txn);
    const ok = gatekeeper.saveUpdateTxn(signed);
    return ok;
}

async function saveVC(did) {
    try {
        const id = wallet.ids[wallet.current];
        const doc = JSON.parse(await gatekeeper.resolveDid(id.did));
        const manifestDid = doc.didDocumentMetadata.manifest;
        const manifest = JSON.parse(await gatekeeper.resolveDid(manifestDid));

        const vc = JSON.parse(await decrypt(did));

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        //console.log(JSON.stringify(vc, null, 4));

        let vcSet = new Set();

        if (manifest.didDocumentMetadata.data) {
            vcSet = new Set(JSON.parse(await decrypt(manifest.didDocumentMetadata.data)));
        }

        vcSet.add(did);
        const msg = JSON.stringify(Array.from(vcSet));
        manifest.didDocumentMetadata.data = await encrypt(msg, id.did);
        await updateDoc(id, manifestDid, manifest);

        console.log(vcSet);
    }
    catch (error) {
        console.error('cannot save VC');
    }
}

async function createVP(vcDid, receiverDid) {
    try {
        const id = wallet.ids[wallet.current];
        const plaintext = await decrypt(vcDid);
        const cipherDid = await encrypt(plaintext, receiverDid);
        const vp = {
            controller: id.did,
            vc: vcDid,
            vp: cipherDid
        };
        const vpDid = await gatekeeper.generateDid(vp);
        console.log(vpDid);
    }
    catch (error) {
        console.error('cannot create verifiable presentation');
    }
}

async function verifyVP(did) {
    try {
        const vpsdoc = JSON.parse(await gatekeeper.resolveDid(did));
        const vcdid = vpsdoc.didDocumentMetadata.data.vc;
        const vpdid = vpsdoc.didDocumentMetadata.data.vp;
        const vcdoc = JSON.parse(await gatekeeper.resolveDid(vcdid));
        const vpdoc = JSON.parse(await gatekeeper.resolveDid(vpdid));
        const vchash = vcdoc.didDocumentMetadata.data.cipher_hash;
        const vphash = vpdoc.didDocumentMetadata.data.cipher_hash;

        if (vchash !== vphash) {
            console.log('cannot verify (VP does not match VC)');
            return;
        }

        const vp = JSON.parse(await decrypt(vpdid));
        const isValid = await keymaster.verifySig(vp);

        if (!isValid) {
            console.log('cannot verify (signature invalid)');
        }

        console.log(vp);
    }
    catch (error) {
        console.error('cannot verify VP');
    }
}

async function rotateKeys() {
    try {
        const id = wallet.ids[wallet.current];
        const nextIndex = id.index + 1;
        const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
        const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
        const didkey = hdkey.derive(path);
        const keypair = cipher.generateJwk(didkey.privateKey);
        const doc = JSON.parse(await gatekeeper.resolveDid(id.did));
        const vmethod = doc.didDocument.verificationMethod[0];

        vmethod.id = `#key-${nextIndex + 1}`;
        vmethod.publicKeyJwk = keypair.publicJwk;
        doc.didDocument.authentication = [vmethod.id];

        const ok = await updateDoc(id, id.did, doc);

        if (ok) {
            id.index = nextIndex;
            saveWallet(wallet);

            console.log(JSON.stringify(doc, null, 2));
        }
        else {
            console.error('cannot rotate keys');
        }
    }
    catch (error) {
        console.error('cannot rotate keys');
    }
}

program
    .version('1.0.0')
    .description('Keychain CLI tool');

program
    .command('show')
    .description('Show wallet')
    .action(() => {
        console.log(JSON.stringify(wallet, null, 4));
    });

program
    .command('create-id <name>')
    .description('Create a new decentralized ID')
    .action((name) => { createId(name) });

program
    .command('remove-id <name>')
    .description('Deletes named ID')
    .action((name) => { removeId(name) });

program
    .command('list-ids')
    .description('List IDs and show current ID')
    .action(() => { listIds() });

program
    .command('use-id <name>')
    .description('Set the current ID')
    .action((name) => { useId(name) });

program
    .command('resolve-did <did>')
    .description('Return document associated with DID')
    .action((did) => { resolveDid(did) });

program
    .command('encrypt-msg <msg> <did>')
    .description('Encrypt a message for a DID')
    .action((msg, did) => { encryptMessage(msg, did) });

program
    .command('encrypt-file <file> <did>')
    .description('Encrypt a file for a DID')
    .action((file, did) => { encryptFile(file, did) });

program
    .command('decrypt-did <did>')
    .description('Decrypt an encrypted data DID')
    .action((did) => { decryptDid(did) });

program
    .command('sign-file <file>')
    .description('Sign a JSON file')
    .action((file) => { signFile(file) });

program
    .command('verify-file <file>')
    .description('Verify the signature in a JSON file')
    .action((file) => { verifyFile(file) });

program
    .command('create-vc <file> <did>')
    .description('Create verifiable credential for a DID')
    .action((file, did) => { createVC(file, did) });

program
    .command('attest-vc <file>')
    .description('Sign and encrypt VC')
    .action((file) => { attestVC(file) });

program
    .command('revoke-vc <did>')
    .description('Revokes a verifiable credential')
    .action((did) => { revokeVC(did) });

program
    .command('save-vc <file>')
    .description('Save verifiable credential for current ID')
    .action((did) => { saveVC(did) });

program
    .command('create-vp <vc-did> <receiver-did>')
    .description('Decrypt and verify the signature in a Verifiable Presentation')
    .action((vc, receiver) => { createVP(vc, receiver) });

program
    .command('verify-vp <did>')
    .description('Decrypt and verify the signature in a Verifiable Presentation')
    .action((did) => { verifyVP(did) });

program
    .command('rotate-keys')
    .description('Rotates keys for current user')
    .action(() => { rotateKeys() });

program.parse(process.argv);
