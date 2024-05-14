import axios from 'axios';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function getCurrentId() {
    try {
        const getCurrentId = await axios.get(`/api/v1/id/current`);
        return getCurrentId.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function setCurrentId(name) {
    try {
        const response = await axios.post(`/api/v1/id/current`, { name: name });
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

export async function resolveId() {
    try {
        const getDocs = await axios.get(`/api/v1/id/resolve`);
        return getDocs.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeId(name) {
    try {
        const getResponse = await axios.post(`/api/v1/id/remove`, { name: name });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function backupId(name) {
    try {
        const getResponse = await axios.post(`/api/v1/id/backup`, { name: name });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function recoverId(did) {
    try {
        const getResponse = await axios.post(`/api/v1/id/recover`, { did: did });
        return getResponse.data;
    }
    catch (error) {
        throwError(error);
    }
}
