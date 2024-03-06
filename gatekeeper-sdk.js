import axios from 'axios';
import config from './config.js';

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

export async function createDID(txn) {
    try {
        const response = await axios.post(`${config.gatekeeperURL}/did/`, txn);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resolveDID(did, asof = null) {
    try {
        if (asof) {
            const response = await axios.get(`${config.gatekeeperURL}/did/${did}?asof=${asof}`);
            return response.data;
        }
        else {
            const response = await axios.get(`${config.gatekeeperURL}/did/${did}`);
            return response.data;
        }
    }
    catch (error) {
        throwError(error);
    }
}

export async function updateDID(txn) {
    try {
        const response = await axios.post(`${config.gatekeeperURL}/did/${txn.did}`, txn);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function deleteDID(txn) {
    try {
        const response = await axios.delete(`${config.gatekeeperURL}/did/${txn.did}`, { data: txn });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportDID(did) {
    try {
        const response = await axios.get(`${config.gatekeeperURL}/export/${did}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importDID(txns) {
    try {
        const response = await axios.post(`${config.gatekeeperURL}/import/`, txns);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function mergeBatch(batch) {
    try {
        const response = await axios.post(`${config.gatekeeperURL}/merge/`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
