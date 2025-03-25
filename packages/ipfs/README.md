# MDIP IPFS

MDIP utilities for integrating with IPFS.

## Installation

```bash
npm install @mdip/ipfs
```

## Usage

### basic use

```js
import HeliaClient from '@mdip/ipfs';

const ipfs = new HeliaClient();

await ipfs.start();

const data = { data: 'whatever' };
const cid = await ipfs.addJSON(data);
const retrieve = await ipfs.getJSON(cid); // retrieve == data

await ipfs.stop();
```

### create factory

The static factory method `create` can be used to create and start an IPFS instance:

```js
const ipfs = await HeliaClient.create();
```

### FS blockstore mode

Passing `datadir` in options to `start` or `create` will persist the data to the specified folder.

```js
const ipfs = await HeliaClient.create({ datadir: 'data/ipfs' });
```

### minimal mode

Starting IPFS in `minimal` mode avoids starting a Helia IPFS server.
Only `add` works to generate CIDs. Nothing is persisted so `get` always returns null.

```js
const ipfs = await HeliaClient.create({ minimal: true });
```
