import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import KeymasterClient from '@mdip/keymaster/client';

const name = 'Alice#1?/資料 %2F&+';
const encoded = 'Alice%231%3F%2F%E8%B3%87%E6%96%99%20%252F%26%2B';
const item = 'report/#draft?%2F.txt';
const encodedItem = 'report%2F%23draft%3F%252F.txt';
const data = Buffer.from('attachment content');
const options = { confirm: true };
const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'did:example:schema'],
    issuer: 'did:example:issuer',
    validFrom: '2026-01-01T00:00:00.000Z',
};

describe('Keymaster HTTP URL encoding', () => {
    let client: KeymasterClient;
    let request: { method?: string; url?: string; headers: IncomingHttpHeaders; body: Buffer };
    const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(Buffer.from(chunk));
        }
        request = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: Buffer.concat(chunks),
        };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ current: name, did: 'did:example:alice', ok: true }));
    });

    beforeAll(async () => {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const { port } = server.address() as AddressInfo;
        client = await KeymasterClient.create({ url: `http://127.0.0.1:${port}` });
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    });

    it.each<[string, string, (client: KeymasterClient) => Promise<unknown>]>([
        ['DELETE', `ids/${encoded}`, c => c.removeId(name)],
        ['POST', `ids/${encoded}/rename`, c => c.renameId(name, item)],
        ['POST', `ids/${encoded}/backup`, c => c.backupId(name)],
        ['POST', `ids/${encoded}/backup`, c => c.backupId()],
        ['POST', `ids/${encoded}/recover`, c => c.recoverId(name)],
        ['GET', `names/${encoded}`, c => c.getName(name)],
        ['DELETE', `names/${encoded}`, c => c.removeName(name)],
        ['GET', `did/${encoded}`, c => c.resolveDID(name)],
        ['GET', `did/${encoded}?confirm=true`, c => c.resolveDID(name, options)],
        ['DELETE', `did/${encoded}`, c => c.revokeDID(name)],
        ['POST', `assets/${encoded}/clone`, c => c.cloneAsset(name)],
        ['GET', `assets/${encoded}`, c => c.resolveAsset(name)],
        ['GET', `assets/${encoded}?confirm=true`, c => c.resolveAsset(name, options)],
        ['PUT', `assets/${encoded}`, c => c.updateAsset(name, {})],
        ['POST', `assets/${encoded}/transfer`, c => c.transferAsset(name, item)],
        ['GET', `groups/${encoded}`, c => c.getGroup(name)],
        ['POST', `groups/${encoded}/add`, c => c.addGroupMember(name, item)],
        ['POST', `groups/${encoded}/remove`, c => c.removeGroupMember(name, item)],
        ['POST', `groups/${encoded}/test`, c => c.testGroup(name, item)],
        ['GET', `groups?owner=${encoded}`, c => c.listGroups(name)],
        ['GET', `schemas/${encoded}`, c => c.getSchema(name)],
        ['PUT', `schemas/${encoded}`, c => c.setSchema(name, {})],
        ['POST', `schemas/${encoded}/test`, c => c.testSchema(name)],
        ['GET', `schemas?owner=${encoded}`, c => c.listSchemas(name)],
        ['POST', `schemas/${encoded}/template`, c => c.createTemplate(name)],
        ['POST', `agents/${encoded}/test`, c => c.testAgent(name)],
        ['POST', `credentials/issued/${encoded}/send`, c => c.sendCredential(name)],
        ['POST', `credentials/issued/${encoded}`, c => c.updateCredential(name, credential)],
        ['GET', `credentials/held/${encoded}`, c => c.getCredential(name)],
        ['DELETE', `credentials/held/${encoded}`, c => c.removeCredential(name)],
        ['POST', `credentials/held/${encoded}/publish`, c => c.publishCredential(name)],
        ['POST', `credentials/held/${encoded}/unpublish`, c => c.unpublishCredential(name)],
        ['DELETE', `credentials/issued/${encoded}`, c => c.revokeCredential(name)],
        ['GET', `polls/${encoded}`, c => c.getPoll(name)],
        ['GET', `polls/${encoded}/view`, c => c.viewPoll(name)],
        ['POST', `polls/${encoded}/vote`, c => c.votePoll(name, 1)],
        ['POST', `polls/${encoded}/publish`, c => c.publishPoll(name)],
        ['POST', `polls/${encoded}/unpublish`, c => c.unpublishPoll(name)],
        ['PUT', `images/${encoded}`, c => c.updateImage(name, data)],
        ['GET', `images/${encoded}`, c => c.getImage(name)],
        ['POST', `images/${encoded}/test`, c => c.testImage(name)],
        ['PUT', `documents/${encoded}`, c => c.updateDocument(name, data)],
        ['GET', `documents/${encoded}`, c => c.getDocument(name)],
        ['POST', `documents/${encoded}/test`, c => c.testDocument(name)],
        ['GET', `groupVaults/${encoded}`, c => c.getGroupVault(name)],
        ['GET', `groupVaults/${encoded}?confirm=true`, c => c.getGroupVault(name, options)],
        ['POST', `groupVaults/${encoded}/test`, c => c.testGroupVault(name)],
        ['POST', `groupVaults/${encoded}/members`, c => c.addGroupVaultMember(name, item)],
        ['DELETE', `groupVaults/${encoded}/members/${encodedItem}`, c => c.removeGroupVaultMember(name, item)],
        ['GET', `groupVaults/${encoded}/members`, c => c.listGroupVaultMembers(name)],
        ['POST', `groupVaults/${encoded}/items`, c => c.addGroupVaultItem(name, item, data)],
        ['DELETE', `groupVaults/${encoded}/items/${encodedItem}`, c => c.removeGroupVaultItem(name, item)],
        ['GET', `groupVaults/${encoded}/items`, c => c.listGroupVaultItems(name)],
        ['GET', `groupVaults/${encoded}/items?confirm=true`, c => c.listGroupVaultItems(name, options)],
        ['GET', `groupVaults/${encoded}/items/${encodedItem}`, c => c.getGroupVaultItem(name, item)],
        ['GET', `groupVaults/${encoded}/items/${encodedItem}?confirm=true`, c => c.getGroupVaultItem(name, item, options)],
        ['PUT', `dmail/${encoded}`, c => c.updateDmail(name, { to: [], cc: [], subject: item, body: item })],
        ['POST', `dmail/${encoded}/send`, c => c.sendDmail(name)],
        ['POST', `dmail/${encoded}/file`, c => c.fileDmail(name, [item])],
        ['DELETE', `dmail/${encoded}`, c => c.removeDmail(name)],
        ['GET', `dmail/${encoded}`, c => c.getDmailMessage(name)],
        ['GET', `dmail/${encoded}?confirm=true`, c => c.getDmailMessage(name, options)],
        ['GET', `dmail/${encoded}/attachments`, c => c.listDmailAttachments(name)],
        ['GET', `dmail/${encoded}/attachments?confirm=true`, c => c.listDmailAttachments(name, options)],
        ['POST', `dmail/${encoded}/attachments`, c => c.addDmailAttachment(name, item, data)],
        ['DELETE', `dmail/${encoded}/attachments/${encodedItem}`, c => c.removeDmailAttachment(name, item)],
        ['GET', `dmail/${encoded}/attachments/${encodedItem}`, c => c.getDmailAttachment(name, item)],
        ['PUT', `notices/${encoded}`, c => c.updateNotice(name, { to: [], dids: [] })],
    ])('encodes %s /api/v1/%s', async (method, path, invoke) => {
        await invoke(client);
        expect(request.method).toBe(method);
        expect(request.url).toBe(`/api/v1/${path}`);
    });

    it.each(['Alice#1', 'Alice?1', 'Alice/1', 'Alice%2F1', 'Alice 1', 'アリス', 'did:mdip:z123'])('round-trips %s', async value => {
        await expect(client.getName(value)).resolves.toBe('did:example:alice');
        const url = new URL(request.url!, 'http://localhost');
        expect(url.search).toBe('');
        expect(url.hash).toBe('');
        expect(url.pathname.split('/')).toHaveLength(5);
        expect(decodeURIComponent(url.pathname.split('/').pop()!)).toBe(value);
    });

    it('does not encode names in JSON bodies', async () => {
        await client.renameId(name, item);
        expect(JSON.parse(request.body.toString())).toEqual({ name: item });
        await client.addGroupVaultMember(name, item);
        expect(JSON.parse(request.body.toString())).toEqual({ memberId: item });
    });

    it('does not encode attachment names in headers or change binary uploads', async () => {
        await client.addGroupVaultItem(name, item, data);
        expect(JSON.parse(request.headers['x-options'] as string)).toEqual({ name: item });
        expect(request.body).toEqual(data);
        await client.addDmailAttachment(name, item, data);
        expect(JSON.parse(request.headers['x-options'] as string)).toEqual({ name: item });
        expect(request.body).toEqual(data);
    });
});
