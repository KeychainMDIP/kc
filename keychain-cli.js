import { program } from 'commander';
import fs from 'fs';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster-lib.js';

program
    .version('1.0.0')
    .description('Keychain CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('create-wallet')
    .description('Create new wallet (or show existing wallet)')
    .action(() => {
        try {
            const wallet = keymaster.loadWallet();
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-wallet <recovery-phrase>')
    .description('Create new wallet from a recovery phrase')
    .action((recoveryPhrase) => {
        try {
            const wallet = keymaster.newWallet(recoveryPhrase);
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('show-wallet')
    .description('Show wallet')
    .action(() => {
        try {
            const wallet = keymaster.loadWallet();
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('show-mnemonic')
    .description('Show recovery phrase for wallet')
    .action(() => {
        try {
            const mnenomic = keymaster.decryptMnemonic();
            console.log(mnenomic);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('backup-wallet')
    .description('Backup wallet to encrypted DID and seed bank')
    .action(async () => {
        try {
            const did = await keymaster.backupWallet();
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('recover-wallet [did]')
    .description('Recover wallet from seed bank or encrypted DID')
    .action(async (did) => {
        try {
            const wallet = await keymaster.recoverWallet(did);
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-id <name> [registry]')
    .description('Create a new decentralized ID')
    .action(async (name, registry) => {
        try {
            const did = await keymaster.createId(name, registry);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('resolve-id')
    .description('Resolves the current ID')
    .action(async () => {
        try {
            const doc = await keymaster.resolveId();
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('backup-id')
    .description('Backup the current ID to its registry')
    .action(async () => {
        try {
            const ok = await keymaster.backupId();
            console.log(ok ? 'OK' : 'backup failed');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('recover-id <did>')
    .description('Recovers the ID from the DID')
    .action(async (did) => {
        try {
            const ok = await keymaster.recoverId(did);
            console.log(ok);
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
            const current = keymaster.getCurrentId();
            const ids = keymaster.listIds();

            for (let id of ids) {
                if (id === current) {
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
            keymaster.setCurrentId(name);
            console.log('OK');
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

program
    .command('resolve-did <did> [confirm]')
    .description('Return document associated with DID')
    .action(async (did, confirm) => {
        try {
            const doc = await keymaster.resolveDID(did, null, !!confirm);
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
    .description('Decrypt an encrypted message DID')
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
    .command('decrypt-json <did>')
    .description('Decrypt an encrypted JSON DID')
    .action(async (did) => {
        try {
            const plaintext = await keymaster.decrypt(did);
            const json = JSON.parse(plaintext);
            console.log(JSON.stringify(json, null, 4));
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
    .command('create-credential <file> [name]')
    .description('Create credential from schema file')
    .action(async (file, name) => {
        try {
            const schema = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createCredential(schema);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-challenge [file] [name]')
    .description('Create challenge (optionally from a file)')
    .action(async (file, name) => {
        try {
            const challenge = file ? JSON.parse(fs.readFileSync(file).toString()) : null;
            const did = await keymaster.createChallenge(challenge);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-challenge-cc <did> [name]')
    .description('Create challenge from a credential DID')
    .action(async (credentialDID, name) => {
        try {
            const credential = keymaster.lookupDID(credentialDID);
            const challenge = { credentials: [{ schema: credential }] };
            const did = await keymaster.createChallenge(challenge);

            if (name) {
                keymaster.addName(name, did);
            }

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
    .command('issue-credential <file> [registry] [name]')
    .description('Sign and encrypt a bound credential file')
    .action(async (file, registry, name) => {
        try {
            const vc = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.issueCredential(vc, registry);

            if (name) {
                keymaster.addName(name, did);
            }

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
            console.log(ok ? 'OK revoked' : 'Not revoked');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('accept-credential <did> [name]')
    .description('Save verifiable credential for current ID')
    .action(async (did, name) => {
        try {
            const ok = await keymaster.acceptCredential(did);

            if (ok) {
                console.log('OK saved');

                if (name) {
                    keymaster.addName(name, did);
                }
            }
            else {
                console.log('Not saved');
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('publish-credential <did>')
    .description('Publish the existence of a credential to the current user manifest')
    .action(async (did) => {
        try {
            const response = await keymaster.publishCredential(did, false);
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('reveal-credential <did>')
    .description('Reveal a credential to the current user manifest')
    .action(async (did) => {
        try {
            const response = await keymaster.publishCredential(did, true);
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('unpublish-credential <did>')
    .description('Remove a credential from the current user manifest')
    .action(async (did) => {
        try {
            const response = await keymaster.unpublishCredential(did);
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-response <challenge>')
    .description('Create a Verifiable Presentation from a challenge')
    .action(async (challenge) => {
        try {
            const did = await keymaster.createResponse(challenge);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('verify-response <response> <challenge>')
    .description('Decrypt and validate a Verifiable Presentation')
    .action(async (response, challenge) => {
        try {
            const vp = await keymaster.verifyResponse(response, challenge);
            console.log(JSON.stringify(vp, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('add-name <name> <did>')
    .description('Adds a name for a DID')
    .action(async (name, did) => {
        try {
            keymaster.addName(name, did);
            console.log('OK');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('remove-name <name>')
    .description('Removes a name for a DID')
    .action(async (name) => {
        try {
            keymaster.removeName(name);
            console.log('OK');
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('list-names')
    .description('Lists names of DIDs')
    .action(async () => {
        try {
            const names = await keymaster.listNames();

            if (names) {
                console.log(JSON.stringify(names, null, 4));
            }
            else {
                console.log("No names defined");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('export-did <did>')
    .description('Export DID to file')
    .action(async (did) => {
        try {
            const ops = await keymaster.exportDID(did);
            console.log(JSON.stringify(ops, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-did <file>')
    .description('Import DID from file')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const ops = JSON.parse(contents);
            const did = await keymaster.importBatch(ops);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('group-create <name>')
    .description('Create a new group')
    .action(async (name) => {
        try {
            const did = await keymaster.createGroup(name);
            console.log(did);
            keymaster.addName(name, did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('group-add <group> <member>')
    .description('Add a member to a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.groupAdd(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('group-remove <group> <member>')
    .description('Remove a member from a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.groupRemove(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('group-test <group> [member]')
    .description('Determine if a member is in a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.groupTest(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-schema <file> [name]')
    .description('Create schema from a file')
    .action(async (file, name) => {
        try {
            const schema = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createSchema(schema);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-template <schema>')
    .description('Create a template from a schema')
    .action(async (schema) => {
        try {
            const template = await keymaster.createTemplate(schema);
            console.log(JSON.stringify(template, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-asset <file>')
    .description('Create an asset from a JSON file')
    .action(async (file) => {
        try {
            const asset = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createAsset(asset);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-template')
    .description('Generate a poll template')
    .action(async () => {
        try {
            const template = await keymaster.pollTemplate();
            console.log(JSON.stringify(template, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-create <file> [name]')
    .description('Create poll')
    .action(async (file, name) => {
        try {
            const poll = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.createPoll(poll);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-view <poll>')
    .description('View poll details')
    .action(async (poll) => {
        try {
            const response = await keymaster.viewPoll(poll);
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-vote <poll> <vote> [spoil]')
    .description('Vote in a poll')
    .action(async (poll, vote, spoil) => {
        try {
            const did = await keymaster.votePoll(poll, vote, spoil);
            console.log(did);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-update <ballot>')
    .description('Add a ballot to the poll')
    .action(async (ballot) => {
        try {
            const ok = await keymaster.updatePoll(ballot);
            if (ok) {
                console.log("OK");
            }
            else {
                console.log("Update failed");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-publish <poll>')
    .description('Publish results to poll, hiding ballots')
    .action(async (poll) => {
        try {
            const ok = await keymaster.publishPoll(poll);
            if (ok) {
                console.log("OK");
            }
            else {
                console.log("Update failed");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-reveal <poll>')
    .description('Publish results to poll, revealing ballots')
    .action(async (poll) => {
        try {
            const ok = await keymaster.publishPoll(poll, true);
            if (ok) {
                console.log("OK");
            }
            else {
                console.log("Update failed");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('poll-unpublish <poll>')
    .description('Remove results from poll')
    .action(async (poll) => {
        try {
            const ok = await keymaster.unpublishPoll(poll);
            if (ok) {
                console.log("OK");
            }
            else {
                console.log("Update failed");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

async function run() {
    await keymaster.start(gatekeeper);
    program.parse(process.argv);
    await keymaster.stop();
}

run();
