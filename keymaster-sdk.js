import axios from 'axios';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function getCurrentId() {
    try {
        const getCurrentId = await axios.get(`/api/v1/current-id`);
        return getCurrentId.data;
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
        const getIds = await axios.get(`/api/v1/ids`);
        return getIds.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveId(id) {
    try {
        const getDocs = await axios.get(`/api/v1/ids/${id}`);
        return getDocs.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createId(name, registry) {
    try {
        const getResponse = await axios.post(`/api/v1/ids`, { name: name, registry: registry });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeId(id) {
    try {
        const getResponse = await axios.delete(`/api/v1/ids/${id}`);
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupId(id) {
    try {
        const getResponse = await axios.post(`/api/v1/ids/${id}/backup`);
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverId(did) {
    try {
        const getResponse = await axios.post(`/api/v1/recover-id`, { did: did });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function listNames() {
    try {
        const getIds = await axios.get(`/api/v1/names`);
        return getIds.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createChallenge() {
    try {
        const getResponse = await axios.get(`/api/v1/challenge`);
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createResponse(challenge) {
    try {
        const getResponse = await axios.post(`/api/v1/response`, { challenge: challenge });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function verifyResponse(response, challenge) {
    try {
        const getResponse = await axios.post(`/api/v1/verify-response`, { response: response, challenge: challenge });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}
