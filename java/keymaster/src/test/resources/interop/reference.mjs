// Execute the current reference packages, rather than duplicating their behavior in Java fixtures.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import GatekeeperClient from '@mdip/gatekeeper/client';
import CipherNode from '@mdip/cipher/node';
import CipherWeb from '@mdip/cipher/web';
import Keymaster, { WalletJsonMemory } from '@mdip/keymaster';

const [action, inputFile, outputFile] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputFile, 'utf8'));
const cipher = new CipherNode();
const wallet = new WalletJsonMemory();
const gatekeeper = new GatekeeperClient();
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 30_000);
try {
    await gatekeeper.connect({ url: process.env.KC_GATEKEEPER_URL, timeoutMs: 5000, signal: controller.signal });
    assert.deepEqual(await gatekeeper.listRegistries(), ['local']);
    const keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'interop passphrase',
        defaultRegistry: 'local', didPrefix: 'did:interop' });
    let result;
    if (action === 'verify') {
        await keymaster.saveWallet(input.wallet, true);
        assert.deepEqual((await keymaster.loadWallet()).interop, input.metadata);
        await keymaster.setCurrentId('Holder');
        assert.equal(await keymaster.acceptCredential(input.vcDid), true);
        const vc = await keymaster.getCredential(input.vcDid);
        assert.deepEqual(vc.credential, input.claims);
        assert.equal(await keymaster.verifySignature(vc), true);
        await keymaster.setCurrentId('Verifier');
        const verification = await keymaster.verifyResponse(input.responseDid, { publish: false });
        assert.equal(verification.match, true);
        assert.equal(verification.requested, 1);
        assert.equal(verification.vps.length, 1);
        assert.equal(verification.responder, input.holderDid);
        const receipts = await keymaster.publishChallengeReceipts(input.responseDid, { registry: 'local' });
        const index = await gatekeeper.exportIndex({ mode: 'changes', cursor: input.cursor, includeOperations: true, limit: 5000 });
        result = { receipts, index, wallet: await keymaster.exportEncryptedWallet() };
    } else if (action === 'create') {
        const cursor = (await gatekeeper.exportIndex({ mode: 'snapshot', limit: 1 })).checkpointCursor;
        await keymaster.newWallet();
        const issuerDid = await keymaster.createId('Issuer');
        const holderDid = await keymaster.createId('Holder');
        const requesterDid = await keymaster.createId('Verifier');
        await keymaster.setCurrentId('Issuer');
        const schemaDid = await keymaster.createSchema(input.schema);
        const credential = await keymaster.bindCredential(schemaDid, holderDid);
        credential.credential = input.claims;
        const vcDid = await keymaster.issueCredential(credential);
        await keymaster.setCurrentId('Holder');
        assert.equal(await keymaster.acceptCredential(vcDid), true);
        await keymaster.setCurrentId('Verifier');
        const challengeDid = await keymaster.createChallenge({ credentials: [{ schema: schemaDid, issuers: [issuerDid] }] }, { registry: 'local' });
        await keymaster.setCurrentId('Holder');
        const responseDid = await keymaster.createResponse(challengeDid, { registry: 'local' });
        await keymaster.setCurrentId('Verifier');
        const data = await keymaster.loadWallet();
        data.interop = input.metadata;
        await keymaster.saveWallet(data, true);
        result = { issuerDid, holderDid, requesterDid, schemaDid, vcDid, responseDid, cursor,
            wallet: await keymaster.exportEncryptedWallet() };
    } else {
        throw new Error(`Unknown interoperability action: ${action}`);
    }
    // CipherWeb shares these primitives with browser builds. No browser runtime is started here.
    const browserCipher = new CipherWeb();
    const pair = cipher.generateJwk(cipher.generateHDKey(await keymaster.decryptMnemonic()).privateKey);
    const message = 'cross-runtime José 🧪';
    const hash = cipher.hashMessage(message);
    assert.equal(browserCipher.verifySig(hash, cipher.signHash(hash, pair.privateJwk), pair.publicJwk), true);
    assert.equal(cipher.verifySig(hash, browserCipher.signHash(hash, pair.privateJwk), pair.publicJwk), true);
    assert.equal(browserCipher.decryptMessage(pair.publicJwk, pair.privateJwk,
        cipher.encryptMessage(pair.publicJwk, pair.privateJwk, message)), message);
    assert.equal(cipher.decryptMessage(pair.publicJwk, pair.privateJwk,
        browserCipher.encryptMessage(pair.publicJwk, pair.privateJwk, message)), message);
    await writeFile(outputFile, JSON.stringify(result));
} finally {
    clearTimeout(deadline);
    controller.abort();
}
