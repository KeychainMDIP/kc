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

export async function listRegistries() {
    try {
        const response = await axios.get(`${URL}/api/v1/registries`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resetDb() {
    try {
        const response = await axios.get(`${URL}/api/v1/reset-db`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function waitUntilReady(intervalSeconds = 1, chatty = true) {
    let ready = false;

    if (chatty) {
        console.log(`Connecting to gatekeeper at ${URL}`);
    }

    while (!ready) {
        ready = await isReady();

        if (!ready) {
            if (chatty) {
                console.log('Waiting for Gatekeeper to be ready...');
            }
            // wait for 1 second before checking again
            await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }
    }

    if (chatty) {
        console.log('Gatekeeper service is ready!');
    }
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

export async function resolveDID(did, asof = null, confirm = false) {
    try {
        if (asof || confirm) {
            const response = await axios.get(`${URL}/api/v1/did/${did}?asof=${asof}&confirm=${confirm}`);
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

export async function exportDIDs(dids) {
    try {
        const response = await axios.post(`${URL}/api/v1/export-dids`, dids);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importDIDs(batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/import-dids/`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importBatch(batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/import-batch/`, batch);
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

export async function clearQueue(events) {
    try {
        const response = await axios.post(`${URL}/api/v1/queue/clear`, events);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
