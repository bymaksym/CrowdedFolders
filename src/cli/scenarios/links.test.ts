import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { lint } from '../../node/linter.ts';
import { RENDER_FILES } from '../test-support/fixtures.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const links: string[] = [];
after(() => {
    for (const link of links) {
        rmSync(link, { recursive: true, force: true });
    }
});

/**
 * The same repository reached through a link: a junction on Windows, a symlink elsewhere. It is what a
 * Windows short name (`C:\Users\RUNNER~1`) or macOS's `/var` → `/private/var` does to every path, and
 * a temporary folder on a CI runner is one of them.
 */
function throughLink(root: string): string {
    const folder = mkdtempSync(join(tmpdir(), 'crowded-folders-link-'));
    links.push(folder);
    const link = join(folder, 'repo');
    symlinkSync(root, link, 'junction');
    return link;
}

interface JsonReport {
    readonly run: { readonly root: string };
    readonly findings: readonly { readonly folder: string }[];
}

describe('a repository reached through a link (a junction, a short name, macOS /var)', () => {
    it('is the root itself: the report says ".", not a path that climbs out with ".."', async () => {
        const link = throughLink(repository(RENDER_FILES));
        const ran = await cli(link, ['-f', 'json']);
        const json = JSON.parse(ran.out) as JsonReport;
        assert.equal(json.run.root, '.');
        assert.deepEqual(
            json.findings.map(finding => finding.folder),
            ['cli'],
        );
    });

    it('init says the file it wrote from where the command was typed', async () => {
        const link = throughLink(repository({ ...RENDER_FILES, '.config/other.json': '{}' }));
        const ran = await cli(link, ['init']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^Wrote \.config[\\/]crowded-folders\.json with recommended/u);
    });

    it('a broken configuration is named from where the command was typed, and annotated on its file', async () => {
        const root = repository({ ...RENDER_FILES, 'crowded-folders.config.json': '{\n  "exclude": [\n}\n' });
        const link = throughLink(root);
        const ran = await cli(link, []);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /^crowded-folders: crowded-folders\.config\.json has a problem:/u);
        const github = await cli(link, ['-f', 'github']);
        assert.match(github.out, /^::error file=crowded-folders\.config\.json,line=\d+,col=\d+,title=/u);
    });

    it('reads absolute paths through the link as files of the root, on --stdin and in lint({ files })', async () => {
        const link = throughLink(repository(RENDER_FILES));
        const absolute = Object.keys(RENDER_FILES).map(path => join(link, path));
        const ran = await cli(link, ['--stdin', '-f', 'json'], {}, absolute.join('\n'));
        assert.equal(ran.code, 1, ran.err);
        assert.deepEqual(
            (JSON.parse(ran.out) as JsonReport).findings.map(finding => finding.folder),
            ['cli'],
        );
        const result = await lint({ cwd: link, files: absolute });
        assert.deepEqual(
            result.kept.map(finding => finding.folder),
            ['cli'],
        );
    });

    it('still refuses an absolute path outside the root', async () => {
        const link = throughLink(repository(RENDER_FILES));
        const elsewhere = join(tmpdir(), 'crowded-folders-elsewhere', 'a.ts');
        const ran = await cli(link, ['--stdin'], {}, `${elsewhere}\ncli/main.ts`);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /is absolute and not under the root/u);
    });
});
