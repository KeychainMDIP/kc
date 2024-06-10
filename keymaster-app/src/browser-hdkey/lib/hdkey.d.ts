/// <reference types="node" />
declare const BITCOIN_VERSIONS: {
    private: number;
    public: number;
};
declare class HDKey {
    versions: {
        private: number;
        public: number;
    };
    depth: number;
    index: number;
    chainCode?: Buffer;
    parentFingerprint: number;
    private _privateKey?;
    private _publicKey?;
    private _fingerprint;
    private _identifier;
    constructor(versions?: typeof BITCOIN_VERSIONS);
    get fingerprint(): number;
    get identifier(): Buffer;
    get pubKeyHash(): Buffer;
    get privateKey(): Buffer | undefined;
    get publicKey(): Buffer | undefined;
    set privateKey(value: Buffer | undefined);
    setPublicKey(value: Buffer): void;
    get privateExtendedKey(): string | null;
    get publicExtendedKey(): string | null;
    derive(path: string): HDKey;
    deriveChild(index: number): HDKey;
    sign(hash: Buffer): Buffer;
    verify(hash: Buffer, signature: Buffer): boolean;
    wipePrivateData(): this;
    toJSON(): {
        xpriv: string | null;
        xpub: string | null;
    };
    static fromMasterSeed(seedBuffer: Buffer, versions?: typeof BITCOIN_VERSIONS): HDKey;
    static fromExtendedKey(base58key: string, versions?: typeof BITCOIN_VERSIONS): HDKey;
    static fromJSON(obj: ReturnType<HDKey["toJSON"]>): HDKey;
}
export default HDKey;
