import { program } from 'commander';
import fs from 'fs';
import assert from 'assert';
import * as keymaster from './keymaster.js';

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
            if (id === keymaster.wallet.current) {
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
        const did = await keymaster.encrypt(msg, did);
        console.log(did);
    }
    catch (error) {
        console.error(error);
    }
}

async function encryptFile(file, did) {
    try {
        const contents = fs.readFileSync(file).toString();
        const did = await keymaster.encrypt(contents, did);
        console.log(did);
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
        const doc = await keymaster.resolveDid(did);
        console.log(JSON.stringify(doc, null, 4));
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
        const vc = await keymaster.createVC(file, did);
        console.log(JSON.stringify(vc, null, 4));
    }
    catch (error) {
        console.error('cannot create VC');
    }
}

async function attestVC(file) {
    try {
        const did = await keymaster.attestVC(file);
        console.log(did);
    }
    catch (error) {
        console.error(`cannot attest ${file}`)
    }
}

async function revokeVC(did) {
    try {
        const ok = await keymaster.revokeVC(did);
        assert.ok(ok);
        console.log('OK revoked');
    }
    catch (error) {
        console.error(`cannot revoke ${did}`);
    }
}

async function acceptVC(did) {
    try {
        const ok = await keymaster.acceptVC(did);
        assert.ok(ok);
        // listVCs();
        console.log('OK saved');
    }
    catch (error) {
        console.error(error);
    }
}

async function createVP(vcDid, receiverDid) {
    try {
        const did = keymaster.createVP(vcDid, receiverDid);
        console.log(did);
    }
    catch (error) {
        console.error(error);
    }
}

async function verifyVP(did) {
    try {
        const vp = keymaster.verifyVP(did);
        console.log(JSON.stringify(vp, null, 4));
    }
    catch (error) {
        console.error('cannot verify VP');
    }
}

async function rotateKeys() {
    try {
        const doc = await keymaster.rotateKeys();
        console.log(JSON.stringify(doc, 4, null));
    }
    catch (error) {
        console.error(error);
    }
}

program
    .version('1.0.0')
    .description('Keychain CLI tool');

program
    .command('show')
    .description('Show wallet')
    .action(() => {
        console.log(JSON.stringify(keymaster.wallet, null, 4));
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
    .command('accept-vc <did>')
    .description('Save verifiable credential for current ID')
    .action((did) => { acceptVC(did) });

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
