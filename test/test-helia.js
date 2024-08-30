import * as helia from '../src/helia-sdk.js';

await helia.waitUntilReady();

for (let i = 0; i < 1000; i++) {
    const seed = { mock: Math.random() };
    helia.add(seed).then((cid) => {
        console.log(`${i} ${cid} ${JSON.stringify(seed)}`);
    });
}

