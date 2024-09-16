import axios from 'axios';

export let URL = '';

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

export function setURL(url) {
    URL = url;
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
        const response = await axios.get(`${URL}/api/v1/db/reset`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function waitUntilReady(intervalSeconds = 5, chatty = true) {
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

export async function resolveDID(did, { atTime, atVersion, confirm, verify } = {}) {
    try {
        let params = '';

        if (atTime) {
            params += `atTime=${atTime}&`;
        }

        if (atVersion) {
            params += `atVersion=${atVersion}&`;
        }

        if (confirm) {
            params += `confirm=${confirm}&`;
        }

        if (verify) {
            params += `verify=${verify}&`;
        }

        const response = await axios.get(`${URL}/api/v1/did/${did}?${params}`);
        return response.data;
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

export async function getDIDs(options = {}) {
    try {
        const response = await axios.post(`${URL}/api/v1/dids/`, options);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportDIDs(dids) {
    try {
        const response = await axios.post(`${URL}/api/v1/dids/export`, { dids });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importDIDs(dids) {
    try {
        const response = await axios.post(`${URL}/api/v1/dids/import`, dids);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportBatch(dids) {
    try {
        const response = await axios.post(`${URL}/api/v1/batch/export`, { dids });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importBatch(batch) {
    try {
        const response = await axios.post(`${URL}/api/v1/batch/import`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeDIDs(dids) {
    try {
        const response = await axios.post(`${URL}/api/v1/dids/remove`, dids);
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

export async function clearQueue(registry, events) {
    try {
        const response = await axios.post(`${URL}/api/v1/queue/${registry}/clear`, events);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
