import { jest } from '@jest/globals';
import type { Response as ExpressResponse } from 'express';
import { proxyCasData } from '../../services/keymaster/server/src/cas-proxy.ts';

function mockResponse() {
    const set = jest.fn();
    const status = jest.fn();
    const send = jest.fn();
    const response = { set, status, send } as unknown as ExpressResponse;

    set.mockReturnValue(response);
    status.mockReturnValue(response);
    send.mockReturnValue(response);

    return { response, set, status, send };
}

describe('Keymaster CAS proxy', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([200, 404, 500, 503])('preserves an upstream %i response', async upstreamStatus => {
        const body = upstreamStatus === 200 ? 'data' : 'error';
        const contentType = upstreamStatus === 200 ? 'application/octet-stream' : 'text/html; charset=utf-8';
        const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
            status: upstreamStatus,
            headers: { 'content-type': contentType },
        }));
        const { response, set, status, send } = mockResponse();

        await proxyCasData('bafy/test', 'https://example.test/gatekeeper', response);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://example.test/gatekeeper/api/v1/cas/data/bafy%2Ftest'
        );
        expect(set).toHaveBeenCalledWith('Content-Type', contentType);
        expect(status).toHaveBeenCalledWith(upstreamStatus);
        expect(send).toHaveBeenCalledWith(Buffer.from(body));
    });

    it('returns 502 when Gatekeeper cannot be reached', async () => {
        jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));
        const { response, status, send } = mockResponse();

        await proxyCasData('bafy', 'http://gatekeeper:4224', response);

        expect(status).toHaveBeenCalledWith(502);
        expect(send).toHaveBeenCalledWith('Error: connection refused');
    });

    it('leaves a missing upstream content type for Express to determine', async () => {
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.from([1, 2, 3])));
        const { response, set, send } = mockResponse();

        await proxyCasData('bafy', 'http://gatekeeper:4224', response);

        expect(set).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    });
});
