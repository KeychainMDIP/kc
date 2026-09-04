import type { Response } from 'express';

export async function proxyCasData(cid: string, gatekeeperURL: string, res: Response): Promise<void> {
    try {
        const url = `${gatekeeperURL}/api/v1/cas/data/${encodeURIComponent(cid)}`;
        const upstream = await fetch(url);
        const contentType = upstream.headers.get('content-type');
        const data = Buffer.from(await upstream.arrayBuffer());

        if (contentType) {
            res.set('Content-Type', contentType);
        }

        res.status(upstream.status).send(data);
    }
    catch (error) {
        res.status(502).send(String(error));
    }
}
