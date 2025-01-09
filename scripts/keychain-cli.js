import { program } from 'commander';
import fs from 'fs';
import dotenv from 'dotenv';

import GatekeeperClient from '@mdip/gatekeeper/client';
import * as keymaster_lib from '@mdip/keymaster/lib';
import KeymasterClient from '@mdip/keymaster/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import WalletEncrypted from '@mdip/keymaster/wallet/json-enc';
import WalletCache from '@mdip/keymaster/wallet/cache';
import * as cipher from '@mdip/cipher/node';

dotenv.config();

const gatekeeperURL = process.env.KC_GATEKEEPER_URL || 'http://localhost:4224';
const keymasterURL = process.env.KC_KEYMASTER_URL;
let keymaster;

const keymasterPassphrase = process.env.KC_ENCRYPTED_PASSPHRASE;
const walletCache = process.env.KC_WALLET_CACHE ? process.env.KC_WALLET_CACHE === 'true' : false;

const UPDATE_OK = "OK";
const UPDATE_FAILED = "Update failed";

program
    .version('1.0.0')
    .description('Keychain CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('create-wallet')
    .description('Create new wallet (or show existing wallet)')
    .action(async () => {
        try {
            const wallet = await keymaster.loadWallet();
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('check-wallet')
    .description('Validate DIDs in wallet')
    .action(async () => {
        try {
            const { checked, invalid, deleted } = await keymaster.checkWallet();

            if (invalid === 0 && deleted === 0) {
                console.log(`${checked} DIDs checked, no problems found`);
            }
            else {
                console.log(`${checked} DIDs checked, ${invalid} invalid DIDs found, ${deleted} deleted DIDs found`);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('fix-wallet')
    .description('Remove invalid DIDs from the wallet')
    .action(async () => {
        try {
            const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

            console.log(`${idsRemoved} IDs and ${ownedRemoved} owned DIDs and ${heldRemoved} held DIDs and ${namesRemoved} names were removed`);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('import-wallet <recovery-phrase>')
    .description('Create new wallet from a recovery phrase')
    .action(async (recoveryPhrase) => {
        try {
            const wallet = await keymaster.newWallet(recoveryPhrase);
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('show-wallet')
    .description('Show wallet')
    .action(async () => {
        try {
            const wallet = await keymaster.loadWallet();
            console.log(JSON.stringify(wallet, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('show-mnemonic')
    .description('Show recovery phrase for wallet')
    .action(async () => {
        try {
            const mnenomic = await keymaster.decryptMnemonic();
            console.log(mnenomic);
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('create-id <name> [registry]')
    .description('Create a new decentralized ID')
    .action(async (name, registry) => {
        try {
            const did = await keymaster.createId(name, { registry });
            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('resolve-id')
    .description('Resolves the current ID')
    .action(async () => {
        try {
            const current = await keymaster.getCurrentId();
            const doc = await keymaster.resolveDID(current);
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('backup-id')
    .description('Backup the current ID to its registry')
    .action(async () => {
        try {
            const ok = await keymaster.backupId();
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('recover-id <did>')
    .description('Recovers the ID from the DID')
    .action(async (did) => {
        try {
            const response = await keymaster.recoverId(did);
            console.log(response);
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('list-ids')
    .description('List IDs and show current ID')
    .action(async () => {
        try {
            const current = await keymaster.getCurrentId();
            const ids = await keymaster.listIds();

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
            console.error(error.message || error);
        }
    });

program
    .command('use-id <name>')
    .description('Set the current ID')
    .action(async (name) => {
        try {
            keymaster.setCurrentId(name);
            console.log(UPDATE_OK);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('rotate-keys')
    .description('Generates new set of keys for current ID')
    .action(async () => {
        try {
            const doc = await keymaster.rotateKeys();
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('resolve-did <did> [confirm]')
    .description('Return document associated with DID')
    .action(async (did, confirm) => {
        try {
            const doc = await keymaster.resolveDID(did, { confirm: !!confirm });
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot resolve ${did}`);
        }
    });

program
    .command('resolve-did-version <did> <version>')
    .description('Return specified version of document associated with DID')
    .action(async (did, version) => {
        try {
            const doc = await keymaster.resolveDID(did, { atVersion: version });
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot resolve ${did}`);
        }
    });

program
    .command('encrypt-message <message> <did>')
    .description('Encrypt a message for a DID')
    .action(async (msg, did) => {
        try {
            const cipherDid = await keymaster.encryptMessage(msg, did);
            console.log(cipherDid);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('encrypt-file <file> <did>')
    .description('Encrypt a file for a DID')
    .action(async (file, did) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const cipherDid = await keymaster.encryptMessage(contents, did);
            console.log(cipherDid);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('decrypt-did <did>')
    .description('Decrypt an encrypted message DID')
    .action(async (did) => {
        try {
            const plaintext = await keymaster.decryptMessage(did);
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
            const json = await keymaster.decryptJSON(did);
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
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('create-schema <file> [name]')
    .description('Create schema DID from schema file')
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
            console.error(error.message || error);
        }
    });

program
    .command('create-challenge [file] [name]')
    .description('Create challenge (optionally from a file)')
    .action(async (file, name) => {
        try {
            const challenge = file ? JSON.parse(fs.readFileSync(file).toString()) : undefined;
            const did = await keymaster.createChallenge(challenge);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('create-challenge-cc <did> [name]')
    .description('Create challenge from a credential DID')
    .action(async (credentialDID, name) => {
        try {
            const challenge = { credentials: [{ schema: credentialDID }] };
            const did = await keymaster.createChallenge(challenge);

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('bind-credential <schema> <subject>')
    .description('Create bound credential for a user')
    .action(async (schema, subject) => {
        try {
            const vc = await keymaster.bindCredential(schema, subject);
            console.log(JSON.stringify(vc, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('issue-credential <file> [registry] [name]')
    .description('Sign and encrypt a bound credential file')
    .action(async (file, registry, name) => {
        try {
            const vc = JSON.parse(fs.readFileSync(file).toString());
            const did = await keymaster.issueCredential(vc, { registry });

            if (name) {
                keymaster.addName(name, did);
            }

            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('list-issued')
    .description('List issued credentials')
    .action(async () => {
        try {
            const response = await keymaster.listIssued();

            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('revoke-credential <did>')
    .description('Revokes a verifiable credential')
    .action(async (did) => {
        try {
            const ok = await keymaster.revokeCredential(did);
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('accept-credential <did> [name]')
    .description('Save verifiable credential for current ID')
    .action(async (did, name) => {
        try {
            const ok = await keymaster.acceptCredential(did);

            if (ok) {
                console.log(UPDATE_OK);

                if (name) {
                    keymaster.addName(name, did);
                }
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('list-credentials')
    .description('List credentials by current ID')
    .action(async () => {
        try {
            const held = await keymaster.listCredentials();
            console.log(JSON.stringify(held, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('get-credential <did>')
    .description('Get credential by DID')
    .action(async (did) => {
        try {
            const credential = await keymaster.getCredential(did);
            console.log(JSON.stringify(credential, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('publish-credential <did>')
    .description('Publish the existence of a credential to the current user manifest')
    .action(async (did) => {
        try {
            const response = await keymaster.publishCredential(did, { reveal: false });
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('reveal-credential <did>')
    .description('Reveal a credential to the current user manifest')
    .action(async (did) => {
        try {
            const response = await keymaster.publishCredential(did, { reveal: true });
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('create-response <challenge>')
    .description('Create a response to a challenge')
    .action(async (challenge) => {
        try {
            const did = await keymaster.createResponse(challenge);
            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('verify-response <response>')
    .description('Decrypt and validate a response to a challenge')
    .action(async (response) => {
        try {
            const vp = await keymaster.verifyResponse(response);
            console.log(JSON.stringify(vp, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('add-name <name> <did>')
    .description('Adds a name for a DID')
    .action(async (name, did) => {
        try {
            keymaster.addName(name, did);
            console.log(UPDATE_OK);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('remove-name <name>')
    .description('Removes a name for a DID')
    .action(async (name) => {
        try {
            keymaster.removeName(name);
            console.log(UPDATE_OK);
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('create-group <name>')
    .description('Create a new group')
    .action(async (name) => {
        try {
            const did = await keymaster.createGroup(name);
            console.log(did);
            keymaster.addName(name, did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('list-groups')
    .description('List groups owned by current ID')
    .action(async () => {
        try {
            const groups = await keymaster.listGroups();
            console.log(JSON.stringify(groups, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('get-group <did>')
    .description('Get group by DID')
    .action(async (did) => {
        try {
            const group = await keymaster.getGroup(did);
            console.log(JSON.stringify(group, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('add-group-member <group> <member>')
    .description('Add a member to a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.addGroupMember(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('remove-group-member <group> <member>')
    .description('Remove a member from a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.removeGroupMember(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('test-group <group> [member]')
    .description('Determine if a member is in a group')
    .action(async (group, member) => {
        try {
            const response = await keymaster.testGroup(group, member);
            console.log(response);
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('list-schemas')
    .description('List schemas owned by current ID')
    .action(async () => {
        try {
            const schemas = await keymaster.listSchemas();
            console.log(JSON.stringify(schemas, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });


program
    .command('get-schema <did>')
    .description('Get schema by DID')
    .action(async (did) => {
        try {
            const schema = await keymaster.getSchema(did);
            console.log(JSON.stringify(schema, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('create-schema-template <schema>')
    .description('Create a template from a schema')
    .action(async (schema) => {
        try {
            const template = await keymaster.createTemplate(schema);
            console.log(JSON.stringify(template, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
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
            console.error(error.message || error);
        }
    });

program
    .command('get-asset <did>')
    .description('Get asset by DID')
    .action(async (did) => {
        try {
            const asset = await keymaster.resolveAsset(did);
            console.log(JSON.stringify(asset, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('list-assets')
    .description('List assets owned by current ID')
    .action(async () => {
        try {
            const assets = await keymaster.listAssets();
            console.log(JSON.stringify(assets, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('create-poll-template')
    .description('Generate a poll template')
    .action(async () => {
        try {
            const template = await keymaster.pollTemplate();
            console.log(JSON.stringify(template, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('create-poll <file> [name]')
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
            console.error(error.message || error);
        }
    });

program
    .command('view-poll <poll>')
    .description('View poll details')
    .action(async (poll) => {
        try {
            const response = await keymaster.viewPoll(poll);
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('vote-poll <poll> <vote> [spoil]')
    .description('Vote in a poll')
    .action(async (poll, vote, spoil) => {
        try {
            const did = await keymaster.votePoll(poll, vote, spoil);
            console.log(did);
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('update-poll <ballot>')
    .description('Add a ballot to the poll')
    .action(async (ballot) => {
        try {
            const ok = await keymaster.updatePoll(ballot);
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('publish-poll <poll>')
    .description('Publish results to poll, hiding ballots')
    .action(async (poll) => {
        try {
            const ok = await keymaster.publishPoll(poll);
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('reveal-poll <poll>')
    .description('Publish results to poll, revealing ballots')
    .action(async (poll) => {
        try {
            const ok = await keymaster.publishPoll(poll, { reveal: true });
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('unpublish-poll <poll>')
    .description('Remove results from poll')
    .action(async (poll) => {
        try {
            const ok = await keymaster.unpublishPoll(poll);
            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('encrypt-wallet')
    .description('Encrypt wallet')
    .action(async () => {
        try {
            if (!keymasterPassphrase) {
                console.error('KC_ENCRYPTED_PASSPHRASE not set');
                return;
            }

            const wallet_json = new WalletJson();
            let wallet = wallet_json.loadWallet();

            if (wallet && (wallet.salt && wallet.iv && wallet.data)) {
                console.error('Wallet already encrypted');
                return;
            }

            if (wallet === null) {
                const gatekeeper = new GatekeeperClient();
                await keymaster.start({
                    gatekeeper,
                    wallet: wallet_json,
                    cipher,
                });
                await keymaster.newWallet();
                wallet = wallet_json.loadWallet();

                if (wallet === null) {
                    console.error('Failed to create new wallet');
                    return;
                }
            }

            const wallet_enc = new WalletEncrypted(wallet_json, keymasterPassphrase);
            const ok = wallet_enc.saveWallet(wallet, true);

            if (ok) {
                console.log(UPDATE_OK);
            }
            else {
                console.log(UPDATE_FAILED);
            }
        } catch (error) {
            console.error(error.message || error);
        }
    });

program
    .command('perf-test [N]')
    .description('Performance test to create N credentials')
    .action(async (N = 100) => {
        try {
            const currentID = await keymaster.getCurrentId();
            const expires = new Date();
            expires.setMinutes(expires.getMinutes() + 1);
            const testOptions = { registry: 'local', validUntil: expires.toISOString() };

            console.time('createSchema');
            const schemaDID = await keymaster.createSchema(undefined, testOptions);
            console.timeEnd('createSchema');
            console.log(`schemaDID: ${schemaDID}`);

            console.time('total');
            for (let i = 0; i < N; i++) {
                console.log(`credential ${i + 1}/${N}`);

                console.time('bindCredential');
                const credential = await keymaster.bindCredential(schemaDID, currentID);
                console.timeEnd('bindCredential');

                console.time('issueCredential');
                const credentialDID = await keymaster.issueCredential(credential, testOptions);
                console.timeEnd('issueCredential');

                console.time('decryptJSON');
                await keymaster.decryptJSON(credentialDID);
                console.timeEnd('decryptJSON');
            }
            console.timeEnd('total');
        }
        catch (error) {
            console.error(error.message || error);
        }
    });

function getDBWallet() {
    let wallet = new WalletJson();

    if (keymasterPassphrase) {
        wallet = new WalletEncrypted(wallet, keymasterPassphrase);
    }

    if (walletCache) {
        wallet = new WalletCache(wallet);
    }

    return wallet;
}

async function run() {
    if (keymasterURL) {
        keymaster = new KeymasterClient();
        await keymaster.connect({
            url: keymasterURL,
            waitUntilReady: true,
            intervalSeconds: 1,
            chatty: false,
            becomeChattyAfter: 5
        });
        program.parse(process.argv);
    }
    else {
        keymaster = keymaster_lib;
        const gatekeeper = new GatekeeperClient();
        await gatekeeper.connect({
            url: gatekeeperURL,
            waitUntilReady: false
        });
        await keymaster.start({
            gatekeeper,
            wallet: getDBWallet(),
            cipher,
        });
        program.parse(process.argv);
        await keymaster.stop();
    }
}

run();
