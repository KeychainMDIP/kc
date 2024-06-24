import axios from 'axios';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function loadWallet() {
    try {
        const response = await axios.get(`/api/v1/wallet`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function saveWallet(wallet) {
    try {
        const response = await axios.put(`/api/v1/wallet`, { wallet });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function newWallet(mnemonic, overwrite = false) {
    try {
        const response = await axios.post(`/api/v1/wallet`, { mnemonic, overwrite });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupWallet() {
    try {
        const response = await axios.post(`/api/v1/backup-wallet`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverWallet() {
    try {
        const response = await axios.post(`/api/v1/recover-wallet`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function decryptMnemonic() {
    try {
        const response = await axios.get(`/api/v1/mnemonic`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listRegistries() {
    try {
        const response = await axios.get(`/api/v1/registries`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getCurrentId() {
    try {
        const response = await axios.get(`/api/v1/current-id`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function setCurrentId(name) {
    try {
        const response = await axios.put(`/api/v1/current-id`, { name: name });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listIds() {
    try {
        const response = await axios.get(`/api/v1/ids`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveId(id) {
    try {
        const response = await axios.get(`/api/v1/ids/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createId(name, registry) {
    try {
        const response = await axios.post(`/api/v1/ids`, { name: name, registry: registry });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeId(id) {
    try {
        const response = await axios.delete(`/api/v1/ids/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupId(id) {
    try {
        const response = await axios.post(`/api/v1/ids/${id}/backup`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverId(did) {
    try {
        const response = await axios.post(`/api/v1/recover-id`, { did: did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listNames() {
    try {
        const response = await axios.get(`/api/v1/names`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function addName(name, did) {
    try {
        const response = await axios.post(`/api/v1/names`, { name: name, did: did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeName(name) {
    try {
        const response = await axios.delete(`/api/v1/names/${name}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveDID(name) {
    try {
        const response = await axios.get(`/api/v1/names/${name}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createChallenge() {
    try {
        const response = await axios.get(`/api/v1/challenge`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createResponse(challengeDID) {
    try {
        const response = await axios.post(`/api/v1/response`, { challenge: challengeDID });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function verifyResponse(responseDID, challengeDID) {
    try {
        const response = await axios.post(`/api/v1/verify-response`, { response: responseDID, challenge: challengeDID });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createGroup(group) {
    try {
        const response = await axios.post(`/api/v1/groups`, { name: group });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getGroup(group) {
    try {
        const response = await axios.get(`/api/v1/groups/${group}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupAdd(group, member) {
    try {
        const response = await axios.post(`/api/v1/groups/${group}/add`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupRemove(group, member) {
    try {
        const response = await axios.post(`/api/v1/groups/${group}/remove`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function groupTest(group, member) {
    try {
        const response = await axios.post(`/api/v1/groups/${group}/test`, { member });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createSchema(schema) {
    try {
        const response = await axios.post(`/api/v1/schemas`, { schema });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getSchema(id) {
    try {
        const response = await axios.get(`/api/v1/schemas/${id}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function setSchema(id, schema) {
    try {
        const response = await axios.put(`/api/v1/schemas/${id}`, { schema });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function testSchema(id) {
    try {
        const response = await axios.post(`/api/v1/schemas/${id}/test`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function testAgent(id) {
    try {
        const response = await axios.post(`/api/v1/agents/${id}/test`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function bindCredential(schema, subject) {
    try {
        const response = await axios.post(`/api/v1/bind-credential`, { schema, subject });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function issueCredential(credential) {
    try {
        const response = await axios.post(`/api/v1/issue-credential`, { credential });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listCredentials() {
    try {
        const response = await axios.get(`/api/v1/credentials`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function acceptCredential(did) {
    try {
        const response = await axios.post(`/api/v1/credentials`, { did });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getCredential(did) {
    try {
        const response = await axios.get(`/api/v1/credentials/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeCredential(did) {
    try {
        const response = await axios.delete(`/api/v1/credentials/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function publishCredential(did, reveal) {
    try {
        const response = await axios.post(`/api/v1/credentials/${did}/publish`, { reveal });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function unpublishCredential(did) {
    try {
        const response = await axios.post(`/api/v1/credentials/${did}/unpublish`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}


