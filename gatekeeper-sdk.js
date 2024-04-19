import axios from 'axios';
import config from './config.js';

export const URL = `${config.gatekeeperURL}:${config.gatekeeperPort}`;

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function start() {
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

export async function getVersion() {
    try {
        const response = await axios.get(`${URL}/api/v1/version`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createDID(operation) {
    try {
        const response = await axios.post(`${URL}/api/v1/did/`, operation);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveDID(did, asof = null) {
    try {
        if (asof) {
            const response = await axios.get(`${URL}/api/v1/did/${did}?asof=${asof}`);
            return response.data;
        }
        else {
            const response = await axios.get(`${URL}/api/v1/did/${did}`);
            return response.data;
        }
    }
    catch (error) {
        throwError(error);
    }
}

export async function updateDID(operation) {
    try {
        const response = await axios.post(`${URL}/api/v1/did/${operation.did}`, operation);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function deleteDID(operation) {
    try {
        const response = await axios.delete(`${URL}/api/v1/did/${operation.did}`, { data: operation });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getDIDs() {
    try {
        const response = await axios.get(`${URL}/api/v1/did/`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportDID(did) {
    try {
        const response = await axios.get(`${URL}/api/v1/export/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importDID(ops) {
    try {
        const response = await axios.post(`${URL}/api/v1/import/`, ops);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function mergeBatch(batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/merge/`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importBatch(batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/importbatch/`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getQueue(registry) {
    try {
        const response = await axios.get(`${URL}/api/v1/queue/${registry}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function clearQueue(registry, batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/queue/${registry}/clear`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
