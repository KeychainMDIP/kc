import { program } from 'commander';
import fs from 'fs';
import assert from 'assert';
import * as keymaster from './keymaster.js';

program
    .version('1.0.0')
    .description('Keychain CLI tool');

program
    .command('show')
    .description('Show wallet')
    .action(() => {
        const wallet = keymaster.loadWallet();
        console.log(JSON.stringify(wallet, null, 4));
    });

program
    .command('create-id <name>')
    .description('Create a new decentralized ID')
    .action(async (name) => {
        try {
            const did = await keymaster.createId(name);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('remove-id <name>')
    .description('Deletes named ID')
    .action(async (name) => {
        try {
            keymaster.removeId(name);
            console.log(`ID ${name} removed`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('list-ids')
    .description('List IDs and show current ID')
    .action(async () => {
        try {
            const wallet = keymaster.loadWallet();
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
    });

program
    .command('use-id <name>')
    .description('Set the current ID')
    .action(async (name) => {
        try {
            keymaster.useId(name);
            console.log('OK');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('resolve-did <did>')
    .description('Return document associated with DID')
    .action(async (did) => {
        try {
            const doc = await keymaster.resolveDid(did);
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot resolve ${did}`);
        }
    });

program
    .command('encrypt-msg <msg> <did>')
    .description('Encrypt a message for a DID')
    .action(async (msg, did) => {
        try {
            const cipherDid = await keymaster.encrypt(msg, did);
            console.log(cipherDid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('encrypt-file <file> <did>')
    .description('Encrypt a file for a DID')
    .action(async (file, did) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const cipherDid = await keymaster.encrypt(contents, did);
            console.log(cipherDid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('decrypt-did <did>')
    .description('Decrypt an encrypted data DID')
    .action(async (did) => {
        try {
            const plaintext = await keymaster.decrypt(did);
            console.log(plaintext);
        }
        catch (error) {
            console.error(`cannot decrypt ${did}`);
        }
    });

program
    .command('sign-file <file>')
    .description('Sign a JSON file')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const json = await keymaster.addSignature(JSON.parse(contents));
            console.log(JSON.stringify(json, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('verify-file <file>')
    .description('Verify the signature in a JSON file')
    .action(async (file) => {
        try {
            const json = JSON.parse(fs.readFileSync(file).toString());
            const isValid = await keymaster.verifySignature(json);
            console.log(`signature in ${file}`, isValid ? 'is valid' : 'is NOT valid');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-credential <file>')
    .description('Create credential from schema file')
    .action(async (file) => {
        try {
            const schema = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createCredential(schema);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-challenge <file>')
    .description('Create challenge from a file')
    .action(async (file) => {
        try {
            const challenge = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createChallenge(challenge);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('issue-challenge <challenge> <user>')
    .description('Issue a challenge to a user')
    .action(async (challenge, user) => {
        try {
            const did = await keymaster.issueChallenge(challenge, user);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });


program
    .command('bind-credential <file> <did>')
    .description('Create bound credential for a user')
    .action(async (file, did) => {
        try {
            const vc = await keymaster.bindCredential(file, did);
            console.log(JSON.stringify(vc, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('attest-credential <file>')
    .description('Sign and encrypt a bound credential file')
    .action(async (file) => {
        try {
            const vc = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.attestCredential(vc);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('revoke-credential <did>')
    .description('Revokes a verifiable credential')
    .action(async (did) => {
        try {
            const ok = await keymaster.revokeCredential(did);
            assert.ok(ok);
            console.log('OK revoked');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('accept-credential <did>')
    .description('Save verifiable credential for current ID')
    .action(async (did) => {
        try {
            const ok = await keymaster.acceptCredential(did);
            assert.ok(ok);
            console.log('OK saved');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-vp <challenge>')
    .description('Create a Verifiable Presentation from a challenge')
    .action(async (challenge) => {
        try {
            const did = await keymaster.createVP(challenge);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('verify-vp <did>')
    .description('Decrypt and validate a Verifiable Presentation')
    .action(async (did) => {
        try {
            const vp = await keymaster.verifyVP(did);
            console.log(JSON.stringify(vp, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('rotate-keys')
    .description('Rotates keys for current user')
    .action(async () => {
        try {
            const doc = await keymaster.rotateKeys();
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program.parse(process.argv);
