import nock from 'nock';
import GatekeeperClient from '@mdip/gatekeeper/client';

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock('http://gatekeeper.org/')
            .get('/api/v1/ready')
            .reply(200, true );

        const gatekeeper = await GatekeeperClient.create({ url: 'http://gatekeeper.org' });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(true);
    });
});

describe('getVersion', () => {
    it('should return version', async () => {
        nock('http://gatekeeper.org/')
            .get('/api/v1/version')
            .reply(200, 1 );

        const gatekeeper = await GatekeeperClient.create({ url: 'http://gatekeeper.org' });
        const version = await gatekeeper.getVersion();

        expect(version).toBe(1);
    });
});

describe('listRegistries', () => {
    it('should return list of default valid registries', async () => {
        nock('http://gatekeeper.org/')
            .get('/api/v1/registries')
            .reply(200, [ 'local', 'hyperswarm' ] );

        const gatekeeper = await GatekeeperClient.create({ url: 'http://gatekeeper.org' });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
    });
});
