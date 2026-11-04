# MDIP IPFS

MDIP utilities for integrating with IPFS.

## Installation

```bash
npm install @mdip/ipfs
```

## Usage

### Basic use

```js
import HeliaClient from '@mdip/ipfs/helia';

const ipfs = new HeliaClient();

await ipfs.start();

const data = { data: 'whatever' };
const cid = await ipfs.addJSON(data);
const retrieve = await ipfs.getJSON(cid); // retrieve == data

await ipfs.stop();
```

### Create factory

The static factory method `create` can be used to create and start an IPFS instance:

```js
const ipfs = await HeliaClient.create();
```

### FS blockstore mode

Passing `datadir` to the constructor or `create` will persist data to the specified folder.

```js
const ipfs = await HeliaClient.create({ datadir: 'data/ipfs' });
```

### Minimal mode

Starting IPFS in `minimal` mode avoids starting a Helia IPFS server.
The `addJSON`, `addText`, and `addData` methods still generate CIDs. Nothing is persisted, so the corresponding `get` methods throw `NotConnectedError`.

```js
const ipfs = await HeliaClient.create({ minimal: true });
```
