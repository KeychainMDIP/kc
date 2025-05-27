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
// Import using subpaths
import CipherNode from '@mdip/cipher/node';

//Non-subpath import
import CipherNode from '@mdip/cipher';

const cipher = new CipherNode();
```

### Web browsers

```js
// Import using subpaths
import CipherWeb from '@mdip/cipher/web';

//Non-subpath import
import CipherWeb from '@mdip/cipher';

const cipher = new CipherWeb();
```
