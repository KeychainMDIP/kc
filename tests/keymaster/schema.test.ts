import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { mockSchema } from './helper.ts';

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

describe('createSchema', () => {
    it('should create a credential from a schema', async () => {
        await keymaster.createId('Bob');

        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
        expect((doc.didDocumentData! as { schema: Record<string, unknown> }).schema).toStrictEqual(mockSchema);
    });

    it('should create a default schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const doc = await keymaster.resolveDID(did);

        const expectedSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "propertyName": {
                    "type": "string"
                }
            },
            "required": [
                "propertyName"
            ]
        };

        expect((doc.didDocumentData! as { schema: Record<string, unknown> }).schema).toStrictEqual(expectedSchema);
    });

    it('should throw an exception on create invalid schema', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ mock: 'not a schema' });
            throw new ExpectedExceptionError();
        } catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: schema');
        }
    });

    it('should throw an exception on schema missing properties', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ "$schema": "http://json-schema.org/draft-07/schema#" });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schema');
        }
    });
});

describe('listSchemas', () => {
    it('should return list of schemas', async () => {
        await keymaster.createId('Bob');

        const schema1 = await keymaster.createSchema();
        const schema2 = await keymaster.createSchema();
        const schema3 = await keymaster.createSchema();
        const group1 = await keymaster.createGroup('mockGroup');

        const schemas = await keymaster.listSchemas();

        expect(schemas.includes(schema1)).toBe(true);
        expect(schemas.includes(schema2)).toBe(true);
        expect(schemas.includes(schema3)).toBe(true);
        expect(schemas.includes(group1)).toBe(false);
    });
});

describe('getSchema', () => {
    it('should return the schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema(mockSchema);
        const schema = await keymaster.getSchema(did);

        expect(schema).toStrictEqual(mockSchema);
    });

    it('should return null on invalid id', async () => {
        const did = await keymaster.createId('Bob');
        const schema = await keymaster.getSchema(did);

        expect(schema).toBeNull();
    });

    it('should return the old style schema (TEMP during did:test)', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset(mockSchema);
        const schema = await keymaster.getSchema(did);

        expect(schema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on get invalid schema', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.getSchema('bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('setSchema', () => {
    it('should update the schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const ok = await keymaster.setSchema(did, mockSchema);
        const newSchema = await keymaster.getSchema(did);

        expect(ok).toBe(true);
        expect(newSchema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on set invalid schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();

        try {
            await keymaster.setSchema(did, { mock: 'not a schema' });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schema');
        }
    });
});

describe('testSchema', () => {
    it('should return true for a valid schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        await keymaster.setSchema(did, mockSchema);

        const isSchema = await keymaster.testSchema(did);

        expect(isSchema).toBe(true);
    });

    it('should return false for a non-schema DID', async () => {
        const agentDID = await keymaster.createId('Bob');
        const isSchema = await keymaster.testSchema(agentDID);

        expect(isSchema).toBe(false);
    });

    it('should return false for non-schemas', async () => {
        // @ts-expect-error Testing invalid usage, missing arg
        let isSchema = await keymaster.testSchema();
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema(3);
        expect(isSchema).toBe(false);

        isSchema = await keymaster.testSchema('mock7');
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema([1, 2, 3]);
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema([1, 2, 3]);
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema({});
        expect(isSchema).toBe(false);
    });
});

describe('createTemplate', () => {
    it('should create template from a valid schema', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        await keymaster.setSchema(did, mockSchema);

        const template = await keymaster.createTemplate(did);
        const expectedTemplate = {
            "$schema": did,
            email: expect.any(String),
        };

        expect(template).toStrictEqual(expectedTemplate);
    });

    it('should raise an exception when no DID provided', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.createTemplate();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schemaId');
        }
    });
});
