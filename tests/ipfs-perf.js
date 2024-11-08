
import IPFS from '@mdip/ipfs';
import * as uuid from 'uuid';

//const ipfs = new IPFS({ datadir: 'data/ipfs' });
const ipfs = new IPFS();

console.time('start');
await ipfs.start();
console.timeEnd('start');

console.time('total');

let promises = [];

for (let i = 0; i < 10000; i++) {
    promises.push(
        ipfs.add(uuid.v4()).then(cid => {
            console.log(`${i} ${cid}`);
        }).catch(err => {
            console.error(`Error adding item ${i}:`, err);
        })
    );

    if (promises.length === 100) {
        await Promise.all(promises);
        promises = [];
    }
}

console.timeEnd('total');

console.time('stop');
await ipfs.stop();
console.timeEnd('stop');

// console.log('Active Handles:', process._getActiveHandles());
// console.log('Active Requests:', process._getActiveRequests());

// Add a slight delay to ensure cleanup, then force exit if still hanging
setTimeout(() => {
    console.log('Forcing process exit');
    process.exit(0);
}, 1000);
