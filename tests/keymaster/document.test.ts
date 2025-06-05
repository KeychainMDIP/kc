import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher });
});

describe('createDocument', () => {
    it('should create DID from text data', async () => {
        const mockDocument = Buffer.from('This is a mock text document.', 'utf-8');
        const cid = await generateCID(mockDocument);
        const filename = 'mockDocument.txt';

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createDocument(mockDocument, { filename });
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            document: {
                cid,
                filename,
                bytes: 29,
                // eslint-disable-next-line
                type: 'text/plain',
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should create DID from binary data', async () => {
        const mockDocument = Buffer.from([0x00, 0xFF, 0xAB, 0xCD, 0x01, 0x02, 0x03, 0x04]);
        const cid = await generateCID(mockDocument);
        const filename = 'mockDocument.bin';

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createDocument(mockDocument, { filename });
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            document: {
                cid,
                filename,
                bytes: 8,
                type: 'application/octet-stream',
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should handle case where no filename is provided', async () => {
        const mockDocument = Buffer.from('This is another mock binary document.', 'utf-8');
        const cid = await generateCID(mockDocument);

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createDocument(mockDocument);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            document: {
                cid,
                filename: 'document',
                bytes: 37,
                type: 'text/plain',
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should handle case where filename has no extension', async () => {
        const mockDocument = Buffer.from('This is another mock document.', 'utf-8');
        const cid = await generateCID(mockDocument);
        const filename = 'mockDocument';

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createDocument(mockDocument, { filename });
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            document: {
                cid,
                filename,
                bytes: 30,
                type: 'text/plain',
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expected);
    });
});

describe('updateDocument', () => {
    it('should update named DID from document data', async () => {
        const mockdoc_v1 = Buffer.from('This is the first version.', 'utf-8');
        const mockdoc_v2 = Buffer.from('This is the second version.', 'utf-8');
        const cid = await generateCID(mockdoc_v2);
        const name = 'mockdoc';
        const filename = 'mockdoc.txt';

        await keymaster.createId('Bob');
        await keymaster.createDocument(mockdoc_v1, { name, filename });
        const ok = await keymaster.updateDocument(name, mockdoc_v2, { filename });
        const doc = await keymaster.resolveDID(name);

        const expected = {
            document: {
                cid,
                filename,
                bytes: 27,
                type: 'text/plain',
            }
        };

        expect(ok).toBe(true);
        expect(doc.didDocumentData).toStrictEqual(expected);
        expect(doc.didDocumentMetadata!.version).toBe(2);
    });

    it('should handle case where no filename is provided', async () => {
        const mockdoc_v1 = Buffer.from('This is another first version.', 'utf-8');
        const mockdoc_v2 = Buffer.from('This is another second version.', 'utf-8');
        const cid = await generateCID(mockdoc_v2);
        const name = 'mockdoc';

        await keymaster.createId('Bob');
        await keymaster.createDocument(mockdoc_v1, { name });
        const ok = await keymaster.updateDocument(name, mockdoc_v2);
        const doc = await keymaster.resolveDID(name);

        const expected = {
            document: {
                cid,
                filename: 'document',
                bytes: 31,
                type: 'text/plain',
            }
        };

        expect(ok).toBe(true);
        expect(doc.didDocumentData).toStrictEqual(expected);
        expect(doc.didDocumentMetadata!.version).toBe(2);
    });

    it('should handle case where filename has no extension', async () => {
        const mockdoc_v1 = Buffer.from('This is yet another first version.', 'utf-8');
        const mockdoc_v2 = Buffer.from('This is yet another second version.', 'utf-8');
        const cid = await generateCID(mockdoc_v2);
        const name = 'mockdoc';
        const filename = 'mockdoc';

        await keymaster.createId('Bob');
        await keymaster.createDocument(mockdoc_v1, { name, filename });
        const ok = await keymaster.updateDocument(name, mockdoc_v2, { filename });
        const doc = await keymaster.resolveDID(name);

        const expected = {
            document: {
                cid,
                filename,
                bytes: 35,
                type: 'text/plain',
            }
        };

        expect(ok).toBe(true);
        expect(doc.didDocumentData).toStrictEqual(expected);
        expect(doc.didDocumentMetadata!.version).toBe(2);
    });
});

describe('getDocument', () => {
    it('should return the document asset', async () => {
        const mockDocument = Buffer.from('This is a mock binary document.', 'utf-8');
        const cid = await generateCID(mockDocument);
        const filename = 'mockDocument.txt';

        await keymaster.createId('Bob');
        const did = await keymaster.createDocument(mockDocument, { filename });
        const asset = await keymaster.getDocument(did);

        const document = {
            cid,
            filename,
            bytes: 31,
            type: 'text/plain',
        };

        expect(asset).toStrictEqual(document);
    });
});

describe('testDocument', () => {
    it('should return true for document DID', async () => {
        const mockDocument = Buffer.from('This is a test document.', 'utf-8');

        await keymaster.createId('Bob');
        const did = await keymaster.createDocument(mockDocument);
        const isDocument = await keymaster.testDocument(did);

        expect(isDocument).toBe(true);
    });

    it('should return true for document name', async () => {
        const mockDocument = Buffer.from('This is another test document.', 'utf-8');

        await keymaster.createId('Bob');
        const name = 'mockDocument';
        await keymaster.createDocument(mockDocument, { name });
        const isDocument = await keymaster.testDocument(name);

        expect(isDocument).toBe(true);
    });

    it('should return false for non-document DID', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const isDocument = await keymaster.testDocument(did);

        expect(isDocument).toBe(false);
    });

    it('should return false if no DID specified', async () => {
        // @ts-expect-error Testing invalid usage, missing arg
        const isDocument = await keymaster.testDocument();
        expect(isDocument).toBe(false);
    });

    it('should return false if invalid DID specified', async () => {
        const isDocument = await keymaster.testDocument('mock');
        expect(isDocument).toBe(false);
    });
});
