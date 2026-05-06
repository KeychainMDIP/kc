import { jest } from '@jest/globals';
import {
    buildChallengeReceiptsRoute,
    publishChallengeReceiptsRoute,
} from '../../services/keymaster/server/src/challenge-receipts-api.ts';

function mockResponse() {
    return {
        json: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
    };
}

describe('challenge receipt API routes', () => {
    it('should build challenge receipts', async () => {
        const receipts = [
            {
                version: 1,
                attesterDid: 'did:mock:attester',
                schemaDid: 'did:mock:schema',
                requesterDid: 'did:mock:requester',
                verifiedAt: '2026-01-01T00:00:00.000Z',
                responseCommitment: 'mock-commitment',
            },
        ];
        const keymaster = {
            buildChallengeReceipts: jest.fn().mockResolvedValue(receipts as never),
        } as any;
        const req = {
            body: {
                response: 'did:mock:response',
                options: {
                    registry: 'local',
                },
            },
        } as any;
        const res = mockResponse() as any;

        await buildChallengeReceiptsRoute(keymaster)(req, res);

        expect(keymaster.buildChallengeReceipts).toHaveBeenCalledWith(req.body.response, req.body.options);
        expect(res.json).toHaveBeenCalledWith({ receipts });
    });

    it('should return build challenge receipt errors', async () => {
        const keymaster = {
            buildChallengeReceipts: jest.fn().mockRejectedValue(new Error('mock build failure') as never),
        } as any;
        const req = {
            body: {
                response: 'did:mock:response',
            },
        } as any;
        const res = mockResponse() as any;

        await buildChallengeReceiptsRoute(keymaster)(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith({ error: 'Error: mock build failure' });
    });

    it('should publish challenge receipts', async () => {
        const dids = ['did:mock:receipt'];
        const keymaster = {
            publishChallengeReceipts: jest.fn().mockResolvedValue(dids as never),
        } as any;
        const req = {
            body: {
                response: 'did:mock:response',
                options: {
                    registry: 'local',
                },
            },
        } as any;
        const res = mockResponse() as any;

        await publishChallengeReceiptsRoute(keymaster)(req, res);

        expect(keymaster.publishChallengeReceipts).toHaveBeenCalledWith(req.body.response, req.body.options);
        expect(res.json).toHaveBeenCalledWith({ dids });
    });

    it('should return publish challenge receipt errors', async () => {
        const keymaster = {
            publishChallengeReceipts: jest.fn().mockRejectedValue(new Error('mock publish failure') as never),
        } as any;
        const req = {
            body: {
                response: 'did:mock:response',
            },
        } as any;
        const res = mockResponse() as any;

        await publishChallengeReceiptsRoute(keymaster)(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith({ error: 'Error: mock publish failure' });
    });
});
