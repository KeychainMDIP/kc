import axios from 'axios';

export async function start() {
}

export async function stop() {
}

export async function getPeerId() {
    try {
        const getPeerId = await axios.get(`http://localhost:3000/peerid`);
        return getPeerId.data;
    }
    catch (error) {

    }
}

export async function resolveDid(did, asof = null) {
    try {
        const getDoc = await axios.get(`http://localhost:3000/did/${did}?asof=${asof}`);
        return getDoc.data;
    }
    catch (error) {

    }
}

export async function createDid(txn) {
    try {
        const getDid = await axios.post(`http://localhost:3000/did/`, txn);
        return getDid.data;
    }
    catch (error) {

    }
}

export async function updateDid(txn) {
    try {
        const getDid = await axios.post(`http://localhost:3000/did/${txn.did}`, txn);
        return getDid.data;
    }
    catch (error) {

    }
}

export async function deleteDid(txn) {
    try {
        const getDid = await axios.delete(`http://localhost:3000/did/${txn.did}`, txn);
        return getDid.data;
    }
    catch (error) {

    }
}
