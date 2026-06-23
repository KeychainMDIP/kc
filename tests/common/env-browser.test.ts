import { loadEnv, resolveEnvFiles } from '../../packages/common/src/env-browser.ts';

describe('env-browser', () => {
    it('uses no-op env loading in browser builds', () => {
        const options = {
            cwd: '/tmp/project',
            envFileVar: 'KC_ENV_FILE',
            filenames: ['.env', '.env.local'],
        };

        expect(resolveEnvFiles(options)).toEqual([]);
        expect(loadEnv(options)).toEqual([]);
    });
});
