import * as bs58check from "bs58check";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp256k1 from "bells-secp256k1";
import { sha512 } from "@noble/hashes/sha512";
import { hmac } from "@noble/hashes/hmac";
import { Buffer } from 'buffer';
const MASTER_SECRET = Buffer.from("Bitcoin seed", "utf8");
const HARDENED_OFFSET = 0x80000000;
const LEN = 78;
const BITCOIN_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };
class HDKey {
    constructor(versions) {
        this.versions = BITCOIN_VERSIONS;
        this.depth = 0;
        this.index = 0;
        this.parentFingerprint = 0;
        this._fingerprint = 0;
        this._identifier = Buffer.alloc(20, 0);
        if (versions)
            this.versions = versions;
    }
    get fingerprint() {
        return this._fingerprint;
    }
    get identifier() {
        return this._identifier;
    }
    get pubKeyHash() {
        return this.identifier;
    }
    get privateKey() {
        return this._privateKey;
    }
    get publicKey() {
        return this._publicKey;
    }
    set privateKey(value) {
        if (!value)
            return;
        equal(value.length, 32, "Private key must be 32 bytes.");
        assert(secp256k1.isPrivate(value) === true, "Invalid private key");
        this._privateKey = value;
        this._publicKey = Buffer.from(secp256k1.pointFromScalar(value, true));
        this._identifier = Buffer.from(hash160(this._publicKey));
        this._fingerprint = this._identifier.subarray(0, 4).readUInt32BE(0);
    }
    setPublicKey(value) {
        assert(value.length === 33 || value.length === 65, "Public key must be 33 or 65 bytes.");
        assert(secp256k1.isPointCompressed(value) || secp256k1.isPoint(value), "Invalid public key");
        const publicKey = value.length === 65
            ? Buffer.from(secp256k1.pointFromScalar(value, true))
            : value;
        this._publicKey = Buffer.from(publicKey);
        this._identifier = Buffer.from(hash160(publicKey));
        this._fingerprint = this._identifier.subarray(0, 4).readUInt32BE(0);
        this._privateKey = undefined;
    }
    get privateExtendedKey() {
        if (this._privateKey)
            return bs58check.encode(serialize(this, this.versions.private, Buffer.concat([Buffer.alloc(1, 0), this._privateKey])));
        else
            return null;
    }
    get publicExtendedKey() {
        if (!this._publicKey)
            return null;
        return bs58check.encode(serialize(this, this.versions.public, this._publicKey));
    }
    derive(path) {
        if (path === "m" || path === "M" || path === "m'" || path === "M'") {
            return this;
        }
        const entries = path.split("/");
        let hdkey = this;
        entries.forEach(function (c, i) {
            if (i === 0) {
                assert(/^[mM]{1}/.test(c), 'Path must start with "m" or "M"');
                return;
            }
            const hardened = c.length > 1 && c[c.length - 1] === "'";
            let childIndex = parseInt(c, 10); // & (HARDENED_OFFSET - 1)
            assert(childIndex < HARDENED_OFFSET, "Invalid index");
            if (hardened)
                childIndex += HARDENED_OFFSET;
            hdkey = hdkey.deriveChild(childIndex);
        });
        return hdkey;
    }
    deriveChild(index) {
        const isHardened = index >= HARDENED_OFFSET;
        const indexBuffer = Buffer.allocUnsafe(4);
        indexBuffer.writeUInt32BE(index, 0);
        let data;
        if (isHardened) {
            assert(this.privateKey, "Could not derive hardened child key");
            let pk = this.privateKey;
            const zb = Buffer.alloc(1, 0);
            pk = Buffer.concat([zb, pk]);
            data = Buffer.concat([pk, indexBuffer]);
        }
        else {
            data = Buffer.concat([this._publicKey, indexBuffer]);
        }
        const I = Buffer.from(hmac(sha512, this.chainCode, data));
        const IL = I.subarray(0, 32);
        const IR = I.subarray(32);
        const hd = new HDKey(this.versions);
        if (this.privateKey) {
            try {
                hd.privateKey = Buffer.from(secp256k1.privateAdd(Buffer.from(this.privateKey), IL));
            }
            catch (err) {
                return this.deriveChild(index + 1);
            }
        }
        else {
            try {
                hd.setPublicKey(Buffer.from(secp256k1.pointAddScalar(this._publicKey, IL, true)));
            }
            catch (err) {
                return this.deriveChild(index + 1);
            }
        }
        hd.chainCode = IR;
        hd.depth = this.depth + 1;
        hd.parentFingerprint = this.fingerprint; // .readUInt32BE(0)
        hd.index = index;
        return hd;
    }
    sign(hash) {
        return Buffer.from(secp256k1.sign(Uint8Array.from(hash), Uint8Array.from(this._privateKey)));
    }
    verify(hash, signature) {
        return secp256k1.verify(Uint8Array.from(signature), Uint8Array.from(hash), Uint8Array.from(this._publicKey));
    }
    wipePrivateData() {
        if (this._privateKey)
            Buffer.from(crypto.getRandomValues(new Uint8Array(this._privateKey.length))).copy(this._privateKey);
        this._privateKey = undefined;
        return this;
    }
    toJSON() {
        return {
            xpriv: this.privateExtendedKey,
            xpub: this.publicExtendedKey,
        };
    }
    static fromMasterSeed(seedBuffer, versions) {
        const I = Buffer.from(hmac(sha512, MASTER_SECRET, seedBuffer));
        const IL = I.subarray(0, 32);
        const IR = I.subarray(32);
        const hdkey = new HDKey(versions);
        hdkey.chainCode = IR;
        hdkey.privateKey = IL;
        return hdkey;
    }
    static fromExtendedKey(base58key, versions) {
        versions = versions || BITCOIN_VERSIONS;
        const hdkey = new HDKey(versions);
        const keyBuffer = Buffer.from(bs58check.decode(base58key));
        const version = keyBuffer.readUInt32BE(0);
        assert(version === versions.private || version === versions.public, "Version mismatch: does not match private or public");
        hdkey.depth = keyBuffer.readUInt8(4);
        hdkey.parentFingerprint = keyBuffer.readUInt32BE(5);
        hdkey.index = keyBuffer.readUInt32BE(9);
        hdkey.chainCode = keyBuffer.subarray(13, 45);
        const key = keyBuffer.subarray(45);
        if (key.readUInt8(0) === 0) {
            // private
            assert(version === versions.private, "Version mismatch: version does not match private");
            hdkey.privateKey = key.slice(1); // cut off first 0x0 byte
        }
        else {
            assert(version === versions.public, "Version mismatch: version does not match public");
            hdkey.setPublicKey(key);
        }
        return hdkey;
    }
    static fromJSON(obj) {
        return HDKey.fromExtendedKey(obj.xpriv);
    }
}
function serialize(hdkey, version, key) {
    var _a;
    const buffer = Buffer.allocUnsafe(LEN);
    buffer.writeUInt32BE(version, 0);
    buffer.writeUInt8(hdkey.depth, 4);
    const fingerprint = hdkey.depth ? hdkey.parentFingerprint : 0x00000000;
    buffer.writeUInt32BE(fingerprint, 5);
    buffer.writeUInt32BE(hdkey.index, 9);
    (_a = hdkey.chainCode) === null || _a === void 0 ? void 0 : _a.copy(buffer, 13);
    key.copy(buffer, 45);
    return buffer;
}
function hash160(buf) {
    return ripemd160(sha256(buf));
}
const assert = (condition, error) => {
    if (!condition)
        throw new Error(error);
};
const equal = (a, b, error) => {
    if (a !== b)
        throw new Error(error);
};
export default HDKey;
