import axios from 'axios';

const URL = 'http://localhost:3000';

export async function start() {
}

export async function stop() {
}

export async function getPeerId() {
    try {
        const getPeerId = await axios.get(`${URL}/peerid`);
        return getPeerId.data;
    }
    catch (error) {

    }
}

export async function createDID(txn) {
    try {
        const getDid = await axios.post(`${URL}/did/`, txn);
        return getDid.data;
    }
    catch (error) {

    }
}

export async function resolveDID(did, asof = null) {
    try {
        const getDoc = await axios.get(`${URL}/did/${did}?asof=${asof}`);
        return getDoc.data;
    }
    catch (error) {

    }
}

export async function updateDID(txn) {
    try {
        const getDid = await axios.post(`${URL}/did/${txn.did}`, txn);
        return getDid.data;
    }
    catch (error) {

    }
}

export async function deleteDID(txn) {
    try {
        const getDid = await axios.delete(`http://localhost:3000/did/${txn.did}`, { data: txn });
        return getDid.data;
    }
    catch (error) {

    }
}
