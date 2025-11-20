import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { Poll } from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { InvalidDIDError, ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';

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

describe('pollTemplate', () => {
    it('should return a poll template', async () => {
        const template = await keymaster.pollTemplate();

        const expectedTemplate = {
            type: 'poll',
            version: 1,
            description: 'What is this poll about?',
            roster: 'DID of the eligible voter group',
            options: ['yes', 'no', 'abstain'],
            deadline: expect.any(String),
        };

        expect(template).toStrictEqual(expectedTemplate);
    });
});

const mockJson = {
    key: "value",
    list: [1, 2, 3],
    obj: { name: "some object" }
};

describe('createPoll', () => {
    it('should create a poll from a valid template', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const asset = await keymaster.resolveAsset(did) as { poll: Poll };

        expect(asset.poll).toStrictEqual(template);
    });

    it('should not create a poll from an invalid template', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.type = "wrong type";
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.version = 0;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.version');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.description;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.description');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.roster;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.roster');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.options;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = ['one option'];
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = "not a list";
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.deadline;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.deadline = "not a date";
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));

            const now = new Date();
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);

            poll.deadline = lastWeek.toISOString();
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));

            poll.roster = 'did:mock:roster';

            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.roster');
        }
    });
});

describe('testPoll', () => {
    it('should return true only for a poll DID', async () => {
        const agentDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const poll = await keymaster.createPoll(template);
        let isPoll = await keymaster.testPoll(poll);
        expect(isPoll).toBe(true);

        isPoll = await keymaster.testPoll(agentDid);
        expect(isPoll).toBe(false);

        isPoll = await keymaster.testPoll(rosterDid);
        expect(isPoll).toBe(false);

        // @ts-expect-error Testing invalid usage, missing arg
        isPoll = await keymaster.testPoll();
        expect(isPoll).toBe(false);

        // @ts-expect-error Testing invalid usage, missing arg
        isPoll = await keymaster.testPoll(100);
        expect(isPoll).toBe(false);

        isPoll = await keymaster.testPoll('did:test:mock');
        expect(isPoll).toBe(false);
    });
});

describe('listPolls', () => {
    it('should return list of polls', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const poll1 = await keymaster.createPoll(template);
        const poll2 = await keymaster.createPoll(template);
        const poll3 = await keymaster.createPoll(template);
        const schema1 = await keymaster.createSchema();
        // add a bogus DID to trigger the exception case
        await keymaster.addToOwned('did:test:mock');

        const polls = await keymaster.listPolls();

        expect(polls.includes(poll1)).toBe(true);
        expect(polls.includes(poll2)).toBe(true);
        expect(polls.includes(poll3)).toBe(true);
        expect(polls.includes(schema1)).toBe(false);
    });
});

describe('getPoll', () => {
    it('should return the specified poll', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const poll = await keymaster.getPoll(did);

        expect(poll).toStrictEqual(template);
    });

    it('should return null on invalid id', async () => {
        const did = await keymaster.createId('Bob');
        const poll = await keymaster.getPoll(did);

        expect(poll).toBeNull();
    });

    it('should return old style poll (TEMP during did:test)', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createAsset(template);
        const poll = await keymaster.getPoll(did);

        expect(poll).toStrictEqual(template);
    });

    it('should return null if non-poll DID specified', async () => {
        const agentDID = await keymaster.createId('Bob');
        const group = await keymaster.getPoll(agentDID);

        expect(group).toBe(null);
    });

    it('should raise an exception if no poll DID specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.getPoll();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });
});

describe('viewPoll', () => {
    it('should return a valid view from a new poll', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const view = await keymaster.viewPoll(did);

        expect(view.deadline).toBe(template.deadline);
        expect(view.description).toBe(template.description);
        expect(view.options).toStrictEqual(template.options);
        expect(view.hasVoted).toBe(false);
        expect(view.isEligible).toBe(true);
        expect(view.isOwner).toBe(true);
        expect(view.voteExpired).toBe(false);
        expect(view.results!.ballots).toStrictEqual([]);
        expect(view.results!.tally.length).toBe(4);
        expect(view.results!.votes!.eligible).toBe(1);
        expect(view.results!.votes!.pending).toBe(1);
        expect(view.results!.votes!.received).toBe(0);
        expect(view.results!.final).toBe(false);
    });

    it('should throw on invalid poll id', async () => {
        const did = await keymaster.createId('Bob');

        try {
            await keymaster.viewPoll(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: pollId');
        }
    });
});

describe('votePoll', () => {
    it('should return a valid ballot', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        const ballot = await keymaster.decryptJSON(ballotDid);

        const expectedBallot = {
            poll: pollDid,
            vote: 1,
        };

        expect(ballot).toStrictEqual(expectedBallot);
    });

    it('should allow a spoiled ballot', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1, { spoil: true });
        const ballot = await keymaster.decryptJSON(ballotDid);

        const expectedBallot = {
            poll: pollDid,
            vote: 0,
        };

        expect(ballot).toStrictEqual(expectedBallot);
    });

    it('should not return a ballot for an invalid vote', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: vote');
        }
    });

    it('should not return a ballot for an ineligible voter', async () => {
        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: voter not in roster');
        }
    });

    it('should throw on an invalid poll id', async () => {
        const did = await keymaster.createId('Bob');

        try {
            await keymaster.votePoll(did, 1);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: pollId');
        }
    });
});

describe('updatePoll', () => {
    it('should update poll with valid ballot', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);

        const ok = await keymaster.updatePoll(ballotDid);
        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.ballots![bobDid].ballot).toBe(ballotDid);
    });

    it('should reject non-ballots', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.updatePoll(pollDid)
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: ballot');
        }
    });

    it('should throw on invalid ballot id', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);

        try {
            await keymaster.updatePoll(did)
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: ballot');
        }
    });

    it('should throw on invalid poll id', async () => {
        const bob = await keymaster.createId('Bob');

        const ballot = {
            poll: bob,
            vote: 1,
        };

        const did = await keymaster.encryptJSON(ballot, bob);

        try {
            await keymaster.updatePoll(did)
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toContain('Cannot find poll related to ballot');
        }
    });
});

describe('publishPoll', () => {
    it('should publish results to poll', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid);

        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results!.final).toBe(true);
        expect(poll.results!.votes!.eligible).toBe(1);
        expect(poll.results!.votes!.pending).toBe(0);
        expect(poll.results!.votes!.received).toBe(1);
        expect(poll.results!.tally.length).toBe(4);
        expect(poll.results!.tally[0]).toStrictEqual({
            vote: 0,
            option: 'spoil',
            count: 0,
        });
        expect(poll.results!.tally[1]).toStrictEqual({
            vote: 1,
            option: 'yes',
            count: 1,
        });
        expect(poll.results!.tally[2]).toStrictEqual({
            vote: 2,
            option: 'no',
            count: 0,
        });
        expect(poll.results!.tally[3]).toStrictEqual({
            vote: 3,
            option: 'abstain',
            count: 0,
        });
    });

    it('should reveal results to poll', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid, { reveal: true });
        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results!.ballots!.length).toBe(1);
        expect(poll.results!.ballots![0]).toStrictEqual({
            ballot: ballotDid,
            voter: bobDid,
            vote: 1,
            option: 'yes',
            received: expect.any(String),
        });
    });
});

describe('unpublishPoll', () => {
    it('should remove results from poll', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        await keymaster.publishPoll(pollDid);
        const ok = await keymaster.unpublishPoll(pollDid);

        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results).toBe(undefined);
    });

    it('should throw when non-owner tries to update poll', async () => {
        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        await keymaster.publishPoll(pollDid);
        await keymaster.createId('Alice');

        try {
            await keymaster.unpublishPoll(pollDid);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe(`Invalid parameter: ${pollDid}`);
        }
    });
});
