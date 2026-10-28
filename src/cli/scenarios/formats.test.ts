import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { type JsonSchema, validate } from '../../core/config/json-schema.ts';
import { sarifViolations } from '../../core/report/test-support/sarif-rules.ts';
import { RENDER_FILES } from '../test-support/fixtures.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const schema = JSON.parse(readFileSync(new URL('../../../report.schema.json', import.meta.url), 'utf8')) as JsonSchema;

const CONFIG = `{
    "extends": ["recommended"],
    "overrides": [
        {
            "folders": ["legacy/**"],
            "reason": "nothing lives there any more",
            "rules": { "max-files": "off" }
        }
    ]
}
`;

describe('several reports in one run', () => {
    it('writes each -f to its own file, and one to standard output', async () => {
        const root = repository(RENDER_FILES);
        const ran = await cli(root, [
            '-f',
            'github',
            '-f',
            'sarif=out.sarif',
            '-f',
            'markdown=summary.md',
            '-f',
            'json=report.json',
        ]);
        assert.equal(ran.code, 1);
        assert.match(
            ran.out,
            /^::error file=cli\/render-\w+\.ts,line=1,title=crowded-folders%3A prefix-groups::cli: 4 modules/u,
        );
        assert.deepEqual(sarifViolations(JSON.parse(readFileSync(join(root, 'out.sarif'), 'utf8'))), []);
        assert.match(readFileSync(join(root, 'summary.md'), 'utf8'), /^## crowded-folders/u);
        assert.deepEqual(validate(JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')), schema), []);
    });

    it('keeps `-f x -o y` working, and refuses two reports for one standard output', async () => {
        const root = repository(RENDER_FILES);
        assert.equal((await cli(root, ['-f', 'checkstyle', '-o', 'cs.xml'])).out, '');
        assert.match(readFileSync(join(root, 'cs.xml'), 'utf8'), /^<\?xml/u);
        const clash = await cli(root, ['-f', 'json', '-f', 'sarif']);
        assert.equal(clash.code, 2);
        assert.match(clash.err, /only one report can go to standard output/u);
        const many = await cli(root, ['-f', 'json=a.json', '-f', 'sarif=b.sarif', '-o', 'c']);
        assert.equal(many.code, 2);
        assert.match(many.err, /--output goes with one --format/u);
    });

    it('appends to $GITHUB_STEP_SUMMARY instead of replacing what earlier steps wrote', async () => {
        const root = repository({ ...RENDER_FILES, 'summary.md': '# earlier step\n' });
        const summary = join(root, 'summary.md');
        await cli(root, ['-f', `markdown=${summary}`], { GITHUB_STEP_SUMMARY: summary });
        const text = readFileSync(summary, 'utf8');
        assert.match(text, /^# earlier step\n## crowded-folders/u);
    });

    it('chooses the format by the CI it runs in with --format auto', async () => {
        const root = repository(RENDER_FILES);
        assert.match((await cli(root, ['-f', 'auto'], { GITHUB_ACTIONS: 'true' })).out, /^::error /u);
        assert.match((await cli(root, ['-f', 'auto'], { TF_BUILD: 'True' })).out, /^##vso\[task\.logissue /u);
        assert.match((await cli(root, ['-f', 'auto'], { GITLAB_CI: 'true' })).out, /^cli\/\n/u);
        assert.match((await cli(root, ['-f', 'auto'])).out, /^cli\/\n/u);
    });
});

describe('what the reports say about the run', () => {
    it('json: the presets, the file source and a root that is not an absolute path', async () => {
        const root = repository(RENDER_FILES);
        const json = JSON.parse((await cli(root, ['-f', 'json'])).out) as { run: unknown; formatVersion: number };
        assert.equal(json.formatVersion, 1);
        assert.deepEqual(json.run, {
            presets: ['recommended'],
            presetsDetected: true,
            configFile: null,
            fileSource: 'disk',
            root: '.',
        });
    });

    it('sarif keeps it in the run properties', async () => {
        const root = repository(RENDER_FILES);
        const sarif = JSON.parse((await cli(root, ['-f', 'sarif'])).out) as {
            runs: { properties: Record<string, unknown> }[];
        };
        assert.equal(sarif.runs[0]?.properties['fileSource'], 'disk');
        assert.deepEqual(sarif.runs[0]?.properties['presets'], ['recommended']);
    });

    it('--stats lists every folder, --no-files leaves out the files', async () => {
        const root = repository({ ...RENDER_FILES, 'lib/a.ts': '' });
        const json = JSON.parse((await cli(root, ['-f', 'json', '--stats', '--no-files'])).out) as {
            folders: unknown[];
            findings: Record<string, unknown>[];
        };
        assert.deepEqual(json.folders, [
            { path: '.', modules: 0, files: 0, subfolders: 2, limit: 40 },
            { path: 'cli', modules: 5, files: 5, subfolders: 0, limit: 20 },
            { path: 'lib', modules: 1, files: 1, subfolders: 0, limit: 20 },
        ]);
        assert.equal('files' in (json.findings[0] ?? {}), false);
        assert.equal(json.findings[0]?.['fileCount'], 4);
        assert.deepEqual(validate(json, schema), []);
    });

    it('gives each finding its project, and groups by it', async () => {
        const root = repository({
            ...Object.fromEntries(Object.keys(RENDER_FILES).map(path => [`apps/web/${path}`, ''])),
            'apps/web/package.json': '{}',
            'package.json': '{}',
        });
        const json = JSON.parse((await cli(root, ['-f', 'json'])).out) as { findings: { project: string }[] };
        assert.equal(json.findings[0]?.project, 'apps/web');
        const text = (await cli(root, ['--group-by', 'project'])).out;
        assert.match(text, /^Top 1 projects|^apps\/web\n {2}error {2}prefix-groups {2}apps\/web\/cli: 4 modules/mu);
    });

    it('uses CODEOWNERS: owners in the report, and --owner to see only one team', async () => {
        const root = repository({
            ...Object.fromEntries(Object.keys(RENDER_FILES).map(path => [path, ''])),
            ...Object.fromEntries(Object.keys(RENDER_FILES).map(path => [path.replace('cli/', 'lib/'), ''])),
            '.github/CODEOWNERS': '/cli/ @org/frontend\n/lib/ @org/backend\n',
        });
        const all = JSON.parse((await cli(root, ['-f', 'json'])).out) as {
            findings: { folder: string; owners: string[] }[];
        };
        assert.deepEqual(
            all.findings.map(finding => [finding.folder, finding.owners]),
            [
                ['cli', ['@org/frontend']],
                ['lib', ['@org/backend']],
            ],
        );
        const mine = JSON.parse((await cli(root, ['-f', 'json', '--owner', '@org/backend'])).out) as {
            findings: { folder: string }[];
        };
        assert.deepEqual(
            mine.findings.map(finding => finding.folder),
            ['lib'],
        );
        const none = repository(RENDER_FILES);
        assert.equal((await cli(none, ['--owner', '@org/x'])).code, 2);
    });
});

describe('no path of the machine', () => {
    it('anchors an unused override on the configuration file and its line, in every format', async () => {
        const root = repository({ ...RENDER_FILES, 'crowded-folders.config.json': CONFIG });
        const run = async (format: string): Promise<string> => (await cli(root, ['-f', format])).out;
        const sarif = JSON.parse(await run('sarif')) as {
            runs: {
                results: {
                    ruleId: string;
                    message: { text: string };
                    locations: {
                        physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
                    }[];
                }[];
            }[];
        };
        const result = sarif.runs[0]?.results.find(candidate => candidate.ruleId === 'config/unused-override');
        assert.equal(result?.locations[0]?.physicalLocation.artifactLocation.uri, 'crowded-folders.config.json');
        assert.equal(result?.locations[0]?.physicalLocation.region.startLine, 5);
        for (const format of ['sarif', 'json', 'github', 'markdown', 'text', 'checkstyle', 'gitlab', 'azure']) {
            const text = await run(format);
            assert.equal(text.includes(root), false, `${format} names the machine's folder`);
            assert.equal(
                text.includes(root.replaceAll('\\', '\\\\')),
                false,
                `${format} names the machine's folder, escaped`,
            );
        }
        assert.match(await run('github'), /^::warning file=crowded-folders\.config\.json,line=5,/mu);
    });

    it('anchors stale suppressions on the suppressions file', async () => {
        const root = repository(RENDER_FILES);
        await cli(root, ['--suppress-all']);
        writeFileSync(join(root, 'cli/render-pr.ts'), '');
        for (const name of ['render-json', 'render-text', 'render-sarif', 'render-pr']) {
            writeFileSync(join(root, `cli/${name}.ts`), '');
        }
        const { rmSync } = await import('node:fs');
        rmSync(join(root, 'cli/render-pr.ts'));
        rmSync(join(root, 'cli/render-sarif.ts'));
        const ran = await cli(root, ['-f', 'github']);
        assert.equal(ran.code, 1);
        assert.match(
            ran.out,
            /^::error file=crowded-folders-suppressions\.json,line=\d+,title=crowded-folders%3A config\/stale-suppression::cli: prefix-groups#render is suppressed at 4 and is fixed/mu,
        );
    });
});

describe('a run that fails with exit code 2', () => {
    it('still writes the SARIF, saying it did not run, so upload-sarif has a file to read', async () => {
        const root = repository({
            ...RENDER_FILES,
            'crowded-folders.config.json': '{ "overrides": [{ "folders": ["cli"] }] }',
        });
        const ran = await cli(root, ['-f', 'sarif', '-o', 'out.sarif']);
        assert.equal(ran.code, 2);
        assert.equal(existsSync(join(root, 'out.sarif')), true);
        const sarif = JSON.parse(readFileSync(join(root, 'out.sarif'), 'utf8')) as {
            runs: {
                invocations: {
                    executionSuccessful: boolean;
                    toolExecutionNotifications: { message: { text: string } }[];
                }[];
            }[];
        };
        assert.deepEqual(sarifViolations(sarif), []);
        assert.equal(sarif.runs[0]?.invocations[0]?.executionSuccessful, false);
        assert.match(
            sarif.runs[0]?.invocations[0]?.toolExecutionNotifications[0]?.message.text ?? '',
            /needs "reason"/u,
        );
        assert.equal(JSON.stringify(sarif).includes(root.replaceAll('\\', '\\\\')), false);
    });

    it('writes an error on the configuration file in the github format', async () => {
        const root = repository({
            ...RENDER_FILES,
            'crowded-folders.config.json': '{ "overrides": [{ "folders": ["cli"] }] }',
        });
        const ran = await cli(root, ['-f', 'github']);
        assert.equal(ran.code, 2);
        assert.match(
            ran.out,
            /^::error file=crowded-folders\.config\.json,line=1,title=crowded-folders%3A config\/error::crowded-folders\.config\.json has a problem/u,
        );
    });
});
