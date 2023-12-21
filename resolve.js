import axios from 'axios';

async function main() {
    try {
        const getDid = await axios.get('http://localhost:3000/identifiers/did:mdip:test:EiABcMneglbnoit4TT42xssCBcRb00xyqJj3pSQ6Z060oQ');
        const did = getDid.data;

        console.log(JSON.stringify(did, null, 4));
    } catch (error) {
        console.log(error);
    }
}

main();

