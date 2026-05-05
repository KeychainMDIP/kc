import type express from 'express';
import type { KeymasterInterface } from '@mdip/keymaster/types';

type ReceiptKeymaster = Pick<KeymasterInterface, 'buildChallengeReceipts' | 'publishChallengeReceipts'>;

function errorResponse(res: express.Response, error: unknown): void {
    res.status(400).send({ error: String(error) });
}

export function buildChallengeReceiptsRoute(keymaster: ReceiptKeymaster) {
    return async (req: express.Request, res: express.Response) => {
        try {
            const { response, options } = req.body;
            const receipts = await keymaster.buildChallengeReceipts(response, options);
            res.json({ receipts });
        } catch (error: unknown) {
            errorResponse(res, error);
        }
    };
}

export function publishChallengeReceiptsRoute(keymaster: ReceiptKeymaster) {
    return async (req: express.Request, res: express.Response) => {
        try {
            const { response, options } = req.body;
            const dids = await keymaster.publishChallengeReceipts(response, options);
            res.json({ dids });
        } catch (error: unknown) {
            errorResponse(res, error);
        }
    };
}
