# MDIP cipher

MDIP cryptography utilities for encryption/decryption and creating/verifying signatures.

## Installation

```bash
npm install @mdip/cipher
```

## Usage

The cipher library comes in two versions for servers and web browsers.
The classes are identical but have different package dependencies.

### Node server applications

```js
import CipherNode from '@mdip/cipher/node';
const cipher = new CipherNode();
```

### Web browsers

```js
import CipherWeb from '@mdip/cipher/web';
const cipher = new CipherWeb();
```
