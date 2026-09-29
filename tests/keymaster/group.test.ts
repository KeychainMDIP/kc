import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { InvalidDIDError, ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { jest } from '@jest/globals';

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

function holdFirstTwoGroupReads(groupDID: string) {
    const resolveDID = keymaster.resolveDID.bind(keymaster);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });

    return jest.spyOn(keymaster, 'resolveDID').mockImplementation(async (did, options) => {
        const doc = await resolveDID(did, options);
        if (did === groupDID && reads < 2) {
            reads += 1;
            if (reads === 2) release();
            await bothRead;
        }
        return doc;
    });
}

describe('createGroup', () => {
    it('should create a new named group', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const doc = await keymaster.resolveDID(groupDid);

        expect(doc.didDocument!.id).toBe(groupDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expectedGroup = {
            group: {
                name: groupName,
                members: [],
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expectedGroup);
    });

    it('should create a new named group with a different DID name', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const didName = 'mockName';
        await keymaster.createGroup(groupName, { name: didName });
        const doc = await keymaster.resolveDID(didName);

        const expectedGroup = {
            group: {
                name: groupName,
                members: [],
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expectedGroup);
    });
});

describe('addGroupMember', () => {
    it('should add a DID member to the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.addGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should add a DID alias to the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const alias = 'mockAlias';
        await keymaster.addName(alias, dataDid);
        const ok = await keymaster.addGroupMember(groupDid, alias);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not add an unknown DID alias to the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            await keymaster.addGroupMember(groupDid, 'mockAlias');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });

    it('should add a DID to a group alias', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const alias = 'mockAlias';
        await keymaster.addName(alias, groupDid);
        const ok = await keymaster.addGroupMember(alias, dataDid);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not add a DID member to an unknown group alias', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.addGroupMember('mockAlias', dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });

    it('should add a member to the group only once', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.addGroupMember(groupDid, dataDid);
        await keymaster.addGroupMember(groupDid, dataDid);
        await keymaster.addGroupMember(groupDid, dataDid);

        const ok = await keymaster.addGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should not increment version when adding a member a 2nd time', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.addGroupMember(groupDid, dataDid);
        const dox1 = await keymaster.resolveDID(groupDid);
        const version1 = dox1.didDocumentMetadata!.version;

        await keymaster.addGroupMember(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata!.version;

        expect(version2).toBe(version1);
    });

    it('should add multiple members to the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const memberCount = 5;

        for (let i = 0; i < memberCount; i++) {
            const mockAnchor = { name: `mock-${i}` };
            const dataDid = await keymaster.createAsset(mockAnchor);
            await keymaster.addGroupMember(groupDid, dataDid);
        }

        const group = (await keymaster.getGroup(groupDid))!;

        expect(group.members.length).toBe(memberCount);
    });

    it('should reject one concurrent addition without losing the other', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createGroup('team');
        const alice = await keymaster.createAsset({ name: 'Alice' });
        const carol = await keymaster.createAsset({ name: 'Carol' });
        const resolveDID = holdFirstTwoGroupReads(groupDID);

        const results = await Promise.allSettled([
            keymaster.addGroupMember(groupDID, alice),
            keymaster.addGroupMember(groupDID, carol),
        ]);
        resolveDID.mockRestore();

        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({
            reason: expect.objectContaining({ message: expect.stringContaining('Please try again') }),
        });
        expect((await keymaster.getGroup(groupDID))?.members).toHaveLength(1);
        const missing = results[0].status === 'rejected' ? alice : carol;
        expect(await keymaster.addGroupMember(groupDID, missing)).toBe(true);
        expect(new Set((await keymaster.getGroup(groupDID))?.members)).toEqual(new Set([alice, carol]));
    });

    it('should reject a group document read before another update', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createGroup('team');
        const stale = await keymaster.resolveDID(groupDID);
        await keymaster.updateAsset(groupDID, { note: 'newer' });
        stale.didDocumentData = { group: { name: 'team', members: [] } };

        expect(await keymaster.updateDID(stale)).toBe(false);
        expect((await keymaster.resolveDID(groupDID)).didDocumentData).toEqual({
            group: { name: 'team', members: [] }, note: 'newer',
        });
    });

    it('should report a rejected addition without retrying', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createGroup('team');
        const alice = await keymaster.createAsset({ name: 'Alice' });
        const update = jest.spyOn(keymaster, 'updateDID').mockResolvedValue(false);

        await expect(keymaster.addGroupMember(groupDID, alice)).rejects.toThrow('Please try again');
        expect(update).toHaveBeenCalledTimes(1);
        expect((await keymaster.getGroup(groupDID))?.members).toEqual([]);
    });

    it('should update an old-style group without losing its other fields', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createAsset({ name: 'team', members: [], note: 'legacy' });
        const alice = await keymaster.createAsset({ name: 'Alice' });

        expect(await keymaster.addGroupMember(groupDID, alice)).toBe(true);
        expect((await keymaster.resolveDID(groupDID)).didDocumentData).toEqual({
            name: 'team', members: [alice], note: 'legacy',
        });
    });

    it('should not add a non-DID to the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.addGroupMember(groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, 100);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, [1, 2, 3]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, { name: 'mock' });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.addGroupMember(groupDid, 'did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: memberId');
        }
    });

    it('should not add a member to a non-group', async () => {
        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(null, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(100, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember([1, 2, 3], dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember({ name: 'mock' }, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.addGroupMember(agentDid, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: groupId');
        }

        try {
            await keymaster.addGroupMember(dataDid, agentDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
        }
    });

    it('should not add a group to itself', async () => {
        await keymaster.createId('Bob');
        const groupDid = await keymaster.createGroup('group');

        try {
            await keymaster.addGroupMember(groupDid, groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: can't add a group to itself");
        }
    });

    it('should not add a member that contains group', async () => {
        await keymaster.createId('Bob');
        const group1Did = await keymaster.createGroup('group-1');
        const group2Did = await keymaster.createGroup('group-2');
        const group3Did = await keymaster.createGroup('group-3');

        await keymaster.addGroupMember(group1Did, group2Did);
        await keymaster.addGroupMember(group2Did, group3Did);

        try {
            await keymaster.addGroupMember(group3Did, group1Did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: can't create mutual membership");
        }
    });
});

describe('removeGroupMember', () => {
    it('should remove a DID member from a group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.addGroupMember(groupDid, dataDid);

        const ok = await keymaster.removeGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should reject one concurrent change without losing the other', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createGroup('team');
        const alice = await keymaster.createAsset({ name: 'Alice' });
        const carol = await keymaster.createAsset({ name: 'Carol' });
        await keymaster.addGroupMember(groupDID, alice);
        const resolveDID = holdFirstTwoGroupReads(groupDID);

        const results = await Promise.allSettled([
            keymaster.addGroupMember(groupDID, carol),
            keymaster.removeGroupMember(groupDID, alice),
        ]);
        resolveDID.mockRestore();

        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({
            reason: expect.objectContaining({ message: expect.stringContaining('Please try again') }),
        });
        if (results[0].status === 'rejected') {
            expect(await keymaster.addGroupMember(groupDID, carol)).toBe(true);
        }
        else {
            expect(await keymaster.removeGroupMember(groupDID, alice)).toBe(true);
        }
        expect((await keymaster.getGroup(groupDID))?.members).toEqual([carol]);
    });

    it('should report a rejected removal without retrying', async () => {
        await keymaster.createId('Bob');
        const groupDID = await keymaster.createGroup('team');
        const alice = await keymaster.createAsset({ name: 'Alice' });
        await keymaster.addGroupMember(groupDID, alice);
        const update = jest.spyOn(keymaster, 'updateDID').mockResolvedValue(false);

        await expect(keymaster.removeGroupMember(groupDID, alice)).rejects.toThrow('Please try again');
        expect(update).toHaveBeenCalledTimes(1);
        expect((await keymaster.getGroup(groupDID))?.members).toEqual([alice]);
    });

    it('should remove a DID alias from a group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.addGroupMember(groupDid, dataDid);

        const alias = 'mockAlias';
        await keymaster.addName(alias, dataDid);

        const ok = await keymaster.removeGroupMember(groupDid, alias);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should be OK to remove a DID that is not in the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.removeGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should not increment version when removing a non-existent member', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dox1 = await keymaster.resolveDID(groupDid);
        const version1 = dox1.didDocumentMetadata!.version;

        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.removeGroupMember(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata!.version;

        expect(version2).toBe(version1);
    });

    it('should not remove a non-DID from the group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeGroupMember(groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, 100);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, [1, 2, 3]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, { name: 'mock' });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.removeGroupMember(groupDid, 'did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: memberId');
        }
    });

    it('should not remove a member from a non-group', async () => {
        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeGroupMember();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(null, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(100, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember([1, 2, 3], dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember({ name: 'mock' }, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.removeGroupMember(agentDid, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
        }

        try {
            await keymaster.removeGroupMember(dataDid, agentDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
        }
    });
});

describe('testGroup', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    function limitGroupResolutions() {
        const getGroup = keymaster.getGroup.bind(keymaster);
        let resolutions = 0;

        return jest.spyOn(keymaster, 'getGroup').mockImplementation(async (id) => {
            // Bound the regression test even if cycle protection is removed.
            if (++resolutions > 10) {
                throw new Error('Group resolution limit exceeded');
            }
            return getGroup(id);
        });
    }

    it('should return true when member in group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.addGroupMember(groupDid, dataDid);

        const test = await keymaster.testGroup(groupDid, dataDid);

        expect(test).toBe(true);
    });

    it('should return false when member not in group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.testGroup(groupDid, dataDid);

        expect(test).toBe(false);
    });

    it('should return true when testing group only', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        const test = await keymaster.testGroup(groupDid);

        expect(test).toBe(true);
    });

    it('should return false when testing non-group only', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.testGroup(dataDid);

        expect(test).toBe(false);
    });

    it('should return true when testing recursive groups', async () => {
        await keymaster.createId('Bob');
        const group1Did = await keymaster.createGroup('level-1');
        const group2Did = await keymaster.createGroup('level-2');
        const group3Did = await keymaster.createGroup('level-3');
        const group4Did = await keymaster.createGroup('level-4');
        const group5Did = await keymaster.createGroup('level-5');

        await keymaster.addGroupMember(group1Did, group2Did);
        await keymaster.addGroupMember(group2Did, group3Did);
        await keymaster.addGroupMember(group3Did, group4Did);
        await keymaster.addGroupMember(group4Did, group5Did);

        const test1 = await keymaster.testGroup(group1Did, group2Did);
        expect(test1).toBe(true);

        const test2 = await keymaster.testGroup(group1Did, group3Did);
        expect(test2).toBe(true);

        const test3 = await keymaster.testGroup(group1Did, group4Did);
        expect(test3).toBe(true);

        const test4 = await keymaster.testGroup(group1Did, group5Did);
        expect(test4).toBe(true);
    });

    it.each([1, 2, 3])('should stop after visiting each group in a %i-group cycle', async (count) => {
        const unrelated = await keymaster.createId('Bob');
        const groups: string[] = [];
        for (let i = 0; i < count; i++) {
            groups.push(await keymaster.createGroup(`group-${i}`));
        }
        for (let i = 0; i < count; i++) {
            await keymaster.updateAsset(groups[i], {
                group: { name: `group-${i}`, members: [groups[(i + 1) % count]] },
            });
        }
        await keymaster.addName('root', groups[0]);
        const getGroup = limitGroupResolutions();

        expect(await keymaster.testGroup('root', unrelated)).toBe(false);
        expect(getGroup).toHaveBeenCalledTimes(count);

        getGroup.mockClear();
        expect(await keymaster.testGroup('root')).toBe(true);
        expect(await keymaster.testGroup('root', groups[1 % count])).toBe(true);
        expect(getGroup).toHaveBeenCalledTimes(2);
    });

    it('should find a member on a later branch after skipping a cycle', async () => {
        const member = await keymaster.createId('Bob');
        const root = await keymaster.createGroup('root');
        const cyclic = await keymaster.createGroup('cyclic');
        const valid = await keymaster.createGroup('valid');
        await keymaster.addGroupMember(valid, member);
        await keymaster.updateAsset(root, { group: { name: 'root', members: [cyclic, valid] } });
        await keymaster.updateAsset(cyclic, { group: { name: 'cyclic', members: [root] } });
        const getGroup = limitGroupResolutions();

        expect(await keymaster.testGroup(root, member)).toBe(true);
        expect(getGroup).toHaveBeenCalledTimes(3);
    });

    it('should resolve a shared subgroup only once per traversal', async () => {
        const unrelated = await keymaster.createId('Bob');
        const root = await keymaster.createGroup('root');
        const left = await keymaster.createGroup('left');
        const right = await keymaster.createGroup('right');
        const shared = await keymaster.createGroup('shared');
        await keymaster.addGroupMember(left, shared);
        await keymaster.addGroupMember(right, shared);
        await keymaster.addGroupMember(root, left);
        await keymaster.addGroupMember(root, right);
        const getGroup = limitGroupResolutions();

        expect(await keymaster.testGroup(root, unrelated)).toBe(false);
        expect(getGroup).toHaveBeenCalledTimes(4);
    });

    it('should keep traversal state separate for concurrent and subsequent calls', async () => {
        const member = await keymaster.createId('Bob');
        const root = await keymaster.createGroup('root');
        const nested = await keymaster.createGroup('nested');
        await keymaster.addGroupMember(root, nested);
        await keymaster.addGroupMember(nested, member);
        await keymaster.addName('root', root);
        const getGroup = limitGroupResolutions();

        expect(await Promise.all([
            keymaster.testGroup('root', 'Bob'),
            keymaster.testGroup(root, member),
        ])).toEqual([true, true]);
        expect(await keymaster.testGroup(root, member)).toBe(true);
        expect(getGroup).toHaveBeenCalledTimes(6);
    });

    it('should stop cycles involving legacy group assets', async () => {
        const unrelated = await keymaster.createId('Bob');
        const legacy = await keymaster.createAsset({ name: 'legacy', members: [] });
        const group = await keymaster.createGroup('group');
        await keymaster.updateAsset(legacy, { members: [group] });
        await keymaster.updateAsset(group, { group: { name: 'group', members: [legacy] } });
        const getGroup = limitGroupResolutions();

        expect(await keymaster.testGroup(legacy, unrelated)).toBe(false);
        expect(getGroup).toHaveBeenCalledTimes(2);
    });

    it('should still reject mutual membership beyond an existing cycle', async () => {
        await keymaster.createId('Bob');
        const target = await keymaster.createGroup('target');
        const root = await keymaster.createGroup('root');
        const cyclic = await keymaster.createGroup('cyclic');
        const nested = await keymaster.createGroup('nested');
        await keymaster.addGroupMember(nested, target);
        await keymaster.updateAsset(root, { group: { name: 'root', members: [cyclic, nested] } });
        await keymaster.updateAsset(cyclic, { group: { name: 'cyclic', members: [root] } });
        const getGroup = limitGroupResolutions();

        await expect(keymaster.addGroupMember(target, root))
            .rejects.toThrow("can't create mutual membership");
        expect(getGroup).toHaveBeenCalledTimes(3);
    });
});

describe('getGroup', () => {
    it('should return the specified group', async () => {
        await keymaster.createId('Bob');
        const groupName = 'mock';
        const groupDid = await keymaster.createGroup(groupName);

        const group = (await keymaster.getGroup(groupDid))!;

        expect(group.name).toBe(groupName);
        expect(group.members).toStrictEqual([]);
    });

    it('should return null on invalid DID', async () => {
        const did = await keymaster.createId('Bob');
        const group = (await keymaster.getGroup(did));

        expect(group).toBeNull();
    });

    it('should return old style group (TEMP during did:test)', async () => {
        await keymaster.createId('Bob');
        const oldGroup = {
            name: 'mock',
            members: [],
        };
        const groupDid = await keymaster.createAsset(oldGroup);

        const group = await keymaster.getGroup(groupDid);

        expect(group).toStrictEqual(oldGroup);
    });

    it('should return null if non-group DID specified', async () => {
        const agentDID = await keymaster.createId('Bob');
        const group = await keymaster.getGroup(agentDID);

        expect(group).toBe(null);
    });

    it('should raise an exception if no DID specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.getGroup();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });
});

describe('listGroups', () => {
    it('should return list of groups', async () => {
        await keymaster.createId('Bob');

        const group1 = await keymaster.createGroup('mock-1');
        const group2 = await keymaster.createGroup('mock-2');
        const group3 = await keymaster.createGroup('mock-3');
        const schema1 = await keymaster.createSchema();
        // add a bogus DID to trigger the exception case
        await keymaster.addToOwned('did:test:mock53');

        const groups = await keymaster.listGroups();

        expect(groups.includes(group1)).toBe(true);
        expect(groups.includes(group2)).toBe(true);
        expect(groups.includes(group3)).toBe(true);
        expect(groups.includes(schema1)).toBe(false);
    });
});
