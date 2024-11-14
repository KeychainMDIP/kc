# MDIP IPFS

MDIP utilities for integrating with IPFS.

## Installation

```bash
npm install @mdip/ipfs
```

## Usage

### basic use

```js
import IPFS from '@mdip/ipfs';

const ipfs = new IPFS();

await ipfs.start();

const data = { data: 'whatever' };
const cid = await ipfs.add(data);
const retrieve = await ipfs.get(cid); // retrieve == data

await ipfs.stop();
```

### create factory

The static factory method `create` can be used to create and start an IPFS instance:

```js
const ipfs = await IPFS.create();
```

### FS blockstore mode

Passing `datadir` in options to `start` or `create` will persist the data to the specified folder.

```js
const ipfs = await IPFS.create({ datadir: 'data/ipfs' });
```

### minimal mode

Starting IPFS in `minimal` mode avoids starting a Helia IPFS server.
Only `add` works to generate CIDs. Nothing is persisted so `get` always returns null.

```js
const ipfs = await IPFS.create({ minimal: true });
```
