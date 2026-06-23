import fs from 'fs';
import path from 'path';

function listSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...listSourceFiles(fullPath));
            continue;
        }

        if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

describe('Explorer import boundaries', () => {
    it('does not import the gatekeeper client', () => {
        const explorerSrc = path.join(process.cwd(), 'services/explorer/src');
        const offenders = listSourceFiles(explorerSrc)
            .filter(file => fs.readFileSync(file, 'utf8').includes('@mdip/gatekeeper/client'))
            .map(file => path.relative(process.cwd(), file));

        expect(offenders).toStrictEqual([]);
    });
});
