import sharp from 'sharp';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { generateCID } from '@mdip/ipfs/utils';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});

afterAll(async () => {
    if (ipfs) {
        await ipfs.stop();
    }
});

beforeEach(() => {
    const db = new DbJsonMemory('test');
    gatekeeper = new Gatekeeper({ db, ipfs, registries: ['local', 'hyperswarm', 'TFTC'] });
    wallet = new WalletJsonMemory();
    cipher = new CipherNode();
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
});

describe('createImage', () => {
    it('should create DID from image data', async () => {
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        const cid = await generateCID(mockImage);

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createImage(mockImage);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            image: {
                cid,
                bytes: 392,
                type: 'image/png',
                width: 100,
                height: 100,
            }
        }
        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should throw an exception on invalid image buffer', async () => {
        try {
            await keymaster.createImage(Buffer.from('mock'));
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: buffer');
        }
    });
});

describe('updateImage', () => {
    it('should update image DID from image data', async () => {
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createImage(mockImage);

        const mockImage2 = await sharp({
            create: {
                width: 200,
                height: 200,
                channels: 3,
                background: { r: 0, g: 255, b: 0 }
            }
        }).jpeg().toBuffer();
        const cid = await generateCID(mockImage2);
        const ok = await keymaster.updateImage(dataDid, mockImage2);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            image: {
                cid,
                bytes: 522,
                type: 'image/jpg',
                width: 200,
                height: 200,
            }
        }
        expect(doc.didDocumentData).toStrictEqual(expected);
        expect(doc.didDocumentMetadata!.version).toBe("2");
    });

    it('should add image to an empty asset', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createAsset({});

        const mockImage = await sharp({
            create: {
                width: 200,
                height: 200,
                channels: 3,
                background: { r: 0, g: 255, b: 0 }
            }
        }).png().toBuffer();
        const cid = await generateCID(mockImage);
        const ok = await keymaster.updateImage(dataDid, mockImage);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            image: {
                cid,
                bytes: 779,
                type: 'image/png',
                width: 200,
                height: 200,
            }
        }
        expect(doc.didDocumentData).toStrictEqual(expected);
        expect(doc.didDocumentMetadata!.version).toBe("2");
    });

    it('should throw an exception on invalid update image buffer', async () => {
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();

        await keymaster.createId('Bob');
        const dataDid = await keymaster.createImage(mockImage);

        try {
            await keymaster.updateImage(dataDid, Buffer.from('mock'));
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: buffer');
        }
    });
});

describe('getImage', () => {
    it('should return the image', async () => {
        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();

        await keymaster.createId('Bob');
        const did = await keymaster.createImage(mockImage);
        const image = await keymaster.getImage(did);

        expect(image).not.toBeNull();
        expect(image!.type).toStrictEqual('image/png');
        expect(image!.width).toStrictEqual(100);
        expect(image!.height).toStrictEqual(100);
        expect(image!.bytes).toStrictEqual(392);
    });

    it('should return null on invalid did', async () => {
        const did = await keymaster.createId('Bob');
        const image = await keymaster.getImage(did);

        expect(image).toBeNull();
    });

    it('should throw an exception on get invalid image', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.getImage('bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('testImage', () => {
    it('should return true for image DID', async () => {
        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();

        await keymaster.createId('Bob');
        const did = await keymaster.createImage(mockImage);
        const isImage = await keymaster.testImage(did);

        expect(isImage).toBe(true);
    });

    it('should return true for image name', async () => {
        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        const name = 'mockImage';

        await keymaster.createId('Bob');
        await keymaster.createImage(mockImage, { name });
        const isImage = await keymaster.testImage(name);

        expect(isImage).toBe(true);
    });

    it('should return false for non-image DID', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const isImage = await keymaster.testImage(did);

        expect(isImage).toBe(false);
    });

    it('should return false if no DID specified', async () => {
        // @ts-expect-error Testing invalid usage, missing arg
        const isImage = await keymaster.testImage();
        expect(isImage).toBe(false);
    });

    it('should return false if invalid DID specified', async () => {
        const isImage = await keymaster.testImage('mock');
        expect(isImage).toBe(false);
    });
});
