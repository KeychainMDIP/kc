import axios from 'axios';

let URL = '';
let API = '/api/v1';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function start(options = {}) {
    if (options.url) {
        URL = options.url;
        API = `${URL}${API}`;
    }

    if (options.waitUntilReady) {
        await waitUntilReady(options);
    }
}

async function waitUntilReady(options = {}) {
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

        retries += 1;

        if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
            console.log(`Connecting to gatekeeper at ${URL}`);
            chatty = true;
        }
    }

    if (chatty) {
        console.log('Gatekeeper service is ready!');
    }
}

export async function stop() {
}

export async function listRegistries() {
    try {
        const response = await axios.get(`${API}/registries`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function resetDb() {
    try {
        const response = await axios.get(`${API}/db/reset`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function verifyDb() {
    try {
        const response = await axios.get(`${API}/db/verify`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function isReady() {
    try {
        const response = await axios.get(`${API}/ready`);
        return response.data;
    }
    catch (error) {
        return false;
    }
}

export async function getVersion() {
    try {
        const response = await axios.get(`${API}/version`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function createDID(operation) {
    try {
        const response = await axios.post(`${API}/did/`, operation);
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

        const response = await axios.get(`${API}/did/${did}?${params}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function updateDID(operation) {
    try {
        const response = await axios.post(`${API}/did/${operation.did}`, operation);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function deleteDID(operation) {
    try {
        const response = await axios.delete(`${API}/did/${operation.did}`, { data: operation });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getDIDs(options = {}) {
    try {
        const response = await axios.post(`${API}/dids/`, options);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportDIDs(dids) {
    try {
        const response = await axios.post(`${API}/dids/export`, { dids });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importDIDs(dids) {
    try {
        const response = await axios.post(`${API}/dids/import`, dids);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function exportBatch(dids) {
    try {
        const response = await axios.post(`${API}/batch/export`, { dids });
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function importBatch(batch) {
    try {
        const response = await axios.post(`${API}/batch/import`, batch);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function removeDIDs(dids) {
    try {
        const response = await axios.post(`${API}/dids/remove`, dids);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function getQueue(registry) {
    try {
        const response = await axios.get(`${API}/queue/${registry}`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function clearQueue(registry, events) {
    try {
        const response = await axios.post(`${API}/queue/${registry}/clear`, events);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}

export async function processEvents() {
    try {
        const response = await axios.post(`${API}/events/process`);
        return response.data;
    }
    catch (error) {
        throwError(error);
    }
}
