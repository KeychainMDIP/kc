import axios from 'axios';

export let URL = 'http://localhost:4228';

function throwError(error) {
    if (error.response) {
        throw error.response.data;
    }

    throw error.message;
}

export async function start() {
    await waitUntilReady();
}

export async function stop() {

}

export async function waitUntilReady(intervalSeconds = 1, chatty = true) {
    let ready = false;

    if (chatty) {
        console.log(`Connecting to Helia at ${URL}`);
    }

    while (!ready) {
        ready = await isReady();

        if (!ready) {
            if (chatty) {
                console.log('Waiting for Helia to be ready...');
            }
            // wait for 1 second before checking again
            await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }
    }

    if (chatty) {
        console.log('Helia service is ready!');
    }
}

export function setURL(url) {
    URL = url;
}

export function isReady() {
    return axios.get(`${URL}/api/v1/ready`)
        .then(response => response.data)
        .catch(error => false);
}

export function add(json) {
    return axios.post(`${URL}/api/v1/ipfs`, json)
        .then(response => response.data.cid)
        .catch(error => throwError(error));
}

export function get(cid) {
    return axios.get(`${URL}/api/v1/ipfs/${cid}`)
        .then(response => response.data)
        .catch(error => throwError(error));
}
