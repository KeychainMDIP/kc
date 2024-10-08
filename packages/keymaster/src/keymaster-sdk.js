import axios from 'axios';

let URL = '';

function throwError(error) {
    if (error.response?.data?.error) {
        throw error.response.data.error;
    }

    throw error.message;
}

export async function start(options = {}) {
    if (options.url) {
        URL = options.url;
    }

    if (options.waitUntilReady) {
        await waitUntilReady(options);
    }
}

async function waitUntilReady(options) {
    let { intervalSeconds, chatty, becomeChattyAfter } = options;
    let ready = false;
    let retries = 0;

    if (!intervalSeconds) {
        intervalSeconds = 5;
    }

    if (!chatty) {
        chatty = false;
    }

    if (!becomeChattyAfter) {
        becomeChattyAfter = 0;
    }

    if (chatty) {
        console.log(`Connecting to Keymaster at ${URL}`);
    }

    while (!ready) {
        ready = await isReady();

        if (!ready) {
            if (chatty) {
                console.log('Waiting for Keymaster to be ready...');
            }
            // wait for 1 second before checking again
            await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }

        retries += 1;

        if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
            console.log(`Connecting to Keymaster at ${URL}`);
            chatty = true;
        }
    }

    if (chatty) {
        console.log('Keymaster service is ready!');
    }
}

export async function stop() {
}

export async function isReady() {
    try {
        const response = await axios.get(`${URL}/api/v1/ready`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function loadWallet() {
    try {
        const response = await axios.get(`${URL}/api/v1/wallet`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function saveWallet(wallet) {
    try {
        const response = await axios.put(`${URL}/api/v1/wallet`, { wallet });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function newWallet(mnemonic, overwrite = false) {
    try {
        const response = await axios.post(`${URL}/api/v1/wallet/new`, { mnemonic, overwrite });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupWallet() {
    try {
        const response = await axios.post(`${URL}/api/v1/wallet/backup`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverWallet() {
    try {
        const response = await axios.post(`${URL}/api/v1/wallet/recover`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function checkWallet() {
    try {
        const response = await axios.post(`${URL}/api/v1/wallet/check`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function fixWallet() {
    try {
        const response = await axios.post(`${URL}/api/v1/wallet/fix`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function decryptMnemonic() {
    try {
        const response = await axios.get(`${URL}/api/v1/wallet/mnemonic`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listRegistries() {
    try {
        const response = await axios.get(`${URL}/api/v1/registries`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getCurrentId() {
    try {
        const response = await axios.get(`${URL}/api/v1/ids/current`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function setCurrentId(name) {
    try {
        const response = await axios.put(`${URL}/api/v1/ids/current`, { name });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listIds() {
    try {
        const response = await axios.get(`${URL}/api/v1/ids`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function encryptMessage(msg, receiver, options = {}) {
    try {
        const response = await axios.post(`${URL}/api/v1/keys/encrypt/message`, { msg, receiver, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function decryptMessage(did) {
    try {
        const response = await axios.post(`${URL}/api/v1/keys/decrypt/message`, { did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function encryptJSON(json, receiver, options = {}) {
    try {
        const response = await axios.post(`${URL}/api/v1/keys/encrypt/json`, { json, receiver, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function decryptJSON(did) {
    try {
        const response = await axios.post(`${URL}/api/v1/keys/decrypt/json`, { did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveId(id) {
    try {
        const response = await axios.get(`${URL}/api/v1/ids/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createId(name, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/ids/new`, { name, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeId(id) {
    try {
        const response = await axios.delete(`${URL}/api/v1/ids/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupId(id) {
    try {
        const response = await axios.post(`${URL}/api/v1/ids/${id}/backup`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverId(did) {
    try {
        const response = await axios.post(`${URL}/api/v1/ids/${did}/recover`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listNames() {
    try {
        const response = await axios.get(`${URL}/api/v1/names`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function addName(name, did) {
    try {
        const response = await axios.post(`${URL}/api/v1/names`, { name, did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeName(name) {
    try {
        const response = await axios.delete(`${URL}/api/v1/names/${name}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveDID(name) {
    try {
        const response = await axios.get(`${URL}/api/v1/names/${name}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveAsset(name) {
    try {
        const response = await axios.get(`${URL}/api/v1/assets/${name}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createChallenge(challengeSpec, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/challenge`, { challenge: challengeSpec, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createResponse(challengeDID, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/response`, { challenge: challengeDID, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function verifyResponse(responseDID, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/response/verify`, { response: responseDID, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createGroup(name, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/groups`, { name, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getGroup(group) {
    try {
        const response = await axios.get(`${URL}/api/v1/groups/${group}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupAdd(group, member) {
    try {
        const response = await axios.post(`${URL}/api/v1/groups/${group}/add`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupRemove(group, member) {
    try {
        const response = await axios.post(`${URL}/api/v1/groups/${group}/remove`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupTest(group, member) {
    try {
        const response = await axios.post(`${URL}/api/v1/groups/${group}/test`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createSchema(schema, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/schemas`, { schema, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getSchema(id) {
    try {
        const response = await axios.get(`${URL}/api/v1/schemas/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function setSchema(id, schema) {
    try {
        const response = await axios.put(`${URL}/api/v1/schemas/${id}`, { schema });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function testSchema(id) {
    try {
        const response = await axios.post(`${URL}/api/v1/schemas/${id}/test`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function testAgent(id) {
    try {
        const response = await axios.post(`${URL}/api/v1/agents/${id}/test`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function bindCredential(schema, subject, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/bind`, { schema, subject, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function issueCredential(credential, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/issued`, { credential, options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function updateCredential(did, credential) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/issued/${did}`, { credential });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listCredentials() {
    try {
        const response = await axios.get(`${URL}/api/v1/credentials/held`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function acceptCredential(did) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/held/`, { did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getCredential(did) {
    try {
        const response = await axios.get(`${URL}/api/v1/credentials/held/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeCredential(did) {
    try {
        const response = await axios.delete(`${URL}/api/v1/credentials/held/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function publishCredential(did, options) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/held/${did}/publish`, { options });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function unpublishCredential(did) {
    try {
        const response = await axios.post(`${URL}/api/v1/credentials/held/${did}/unpublish`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listIssued() {
    try {
        const response = await axios.get(`${URL}/api/v1/credentials/issued`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function revokeCredential(did) {
    try {
        const response = await axios.delete(`${URL}/api/v1/credentials/issued/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
