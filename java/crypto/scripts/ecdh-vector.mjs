import CipherNode from '@mdip/cipher/node';
import { base64url } from 'multiformats/bases/base64';
import * as secp from '@noble/secp256k1';

const c = new CipherNode();
const senderPriv = base64url.baseDecode('4oQSnMCSJXmlNbv00aOyV3MJDSjJCbwP7XO14CIsw3I');
const receiverPriv = base64url.baseDecode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI');

const sender = c.generateJwk(senderPriv);
const receiver = c.generateJwk(receiverPriv);

const pub = c.convertJwkToCompressedBytes(receiver.publicJwk);
const ss = secp.getSharedSecret(senderPriv, pub);
const key32 = ss.slice(0, 32);

console.log(JSON.stringify({
  sharedSecretCompressedHex: Buffer.from(ss).toString('hex'),
  key32Hex: Buffer.from(key32).toString('hex')
}, null, 2));
