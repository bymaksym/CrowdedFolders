import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { type JsonSchema, validate } from '../../config/json-schema.ts';
import type { Finding } from '../../engine.ts';
import { formatAzure, formatCheckstyle, formatGithub, formatGitlab, formatJson, formatMarkdown } from '../machine.ts';
import { prefixGroup, report, tooManyFiles, tooManyFolders, unusedOverride } from '../test-support/fixtures.ts';
import { commandsOf, formatMovesScript, quotePwsh, quoteSh } from './moves.ts';

const schema = JSON.parse(
    readFileSync(new URL('../../../../report.schema.json', import.meta.url), 'utf8'),
) as JsonSchema;

const hide = [{ dir: 'C:\\Users\\ci\\work\\repo', as: '' }];

/** Many folders with one problem each, worst first by their measure. */
function crowd(count: number, severity: 'error' | 'warn'): Finding[] {
    return Array.from({ length: count }, (_, index) => ({
        ...tooManyFiles,
        severity,
        folder: `packages/p${index}/src`,
        measured: 21 + index,
        files: [`packages/p${index}/src/a.ts`],
    }));
}

describe('github annotations', () => {
    it('writes one per finding on a file, as `folder: message`, with the rule as the title', () => {
        const output = formatGithub(
            report([prefixGroup, unusedOverride], { configFile: 'crowded-folders.config.json', hide }),
        );
        const lines = output.trimEnd().split('\n');
        assert.equal(lines.length, 2);
        assert.match(
            lines[0] ?? '',
            /^::error file=src\/cli\/render-\w+\.ts,line=1,title=crowded-folders%3A prefix-groups::src\/cli: 4 modules start with "render"/u,
        );
        assert.match(
            lines[1] ?? '',
            /^::warning file=crowded-folders\.config\.json,line=1,title=crowded-folders%3A config\/unused-override::The override for/u,
        );
        assert.doesNotMatch(output, /file=\.|The root The|Users/u);
    });

    it('escapes what workflow commands would read, and control characters', () => {
        const hostile: Finding = {
            ...prefixGroup,
            folder: 'a',
            message: '100% sure\r\n::error::injected \u{1B}[31m',
            files: ['a/x,y:z.ts'],
        };
        const lines = formatGithub(report([hostile]))
            .trimEnd()
            .split('\n');
        assert.equal(lines.length, 1);
        const line = lines[0];
        assert.match(line ?? '', /file=a\/x%2Cy%3Az\.ts/u);
        assert.match(line ?? '', /::a: 100%25 sure\\x0d\\x0a::error::injected \\x1b\[31m$/u);
    });

    it('shows 9 of a kind, worst first, and says how many more', () => {
        const output = formatGithub(report([...crowd(25, 'error'), ...crowd(3, 'warn')]));
        const lines = output.trimEnd().split('\n');
        assert.equal(lines.filter(line => line.startsWith('::error')).length, 10);
        assert.equal(lines.filter(line => line.startsWith('::warning')).length, 3);
        assert.match(lines[0] ?? '', /packages\/p24\/src/u);
        assert.match(lines[9] ?? '', /^::error title=crowded-folders%3A more::and 16 more errors/u);
        assert.equal(
            formatGithub(report(crowd(30, 'warn'), {}), { maxPerKind: 4 })
                .trimEnd()
                .split('\n').length,
            5,
        );
    });

    it('counts stale suppressions among the errors, on the suppressions file', () => {
        const output = formatGithub(
            report([], {
                suppressionsFile: 'crowded-folders-suppressions.json',
                suppressionLines: { 'src/old\0max-files': 6 },
                staleSuppressions: [
                    {
                        folder: 'src/old',
                        id: 'max-files',
                        rule: 'max-files',
                        key: undefined,
                        count: 30,
                        measured: 28,
                        status: 'lowered',
                        file: 'crowded-folders-suppressions.json',
                    },
                ],
            }),
        );
        assert.match(
            output,
            /^::error file=crowded-folders-suppressions\.json,line=6,title=crowded-folders%3A config\/stale-suppression::src\/old: max-files is suppressed at 30 and is now 28: save it with --prune-suppressions and commit crowded-folders-suppressions\.json\.\n$/u,
        );
    });

    // "per-project": each stale suppression is anchored on the file that holds it, and says why it goes.
    it('anchors a stale suppression on its own file and says why it is stale', () => {
        const output = formatGithub(
            report([], {
                suppressionsFile: 'crowded-folders-suppressions.json',
                staleSuppressions: [
                    {
                        folder: 'packages/web/src',
                        id: 'prefix-groups#render',
                        rule: 'prefix-groups',
                        key: 'render',
                        count: 4,
                        measured: undefined,
                        status: 'moved',
                        movedTo: 'packages/web/lib',
                        file: 'packages/web/crowded-folders-suppressions.json',
                    },
                    {
                        folder: 'a',
                        id: 'b',
                        rule: 'b',
                        key: undefined,
                        count: 1,
                        measured: undefined,
                        status: 'fixed',
                        file: 'crowded-folders-suppressions.json',
                    },
                ],
            }),
        );
        assert.match(
            output,
            /^::error file=packages\/web\/crowded-folders-suppressions\.json,line=1,.*looks moved to packages\/web\/lib: rename its key/mu,
        );
        assert.match(
            output,
            /^::error file=crowded-folders-suppressions\.json,line=1,.*a: b is suppressed at 1 and is fixed/mu,
        );
    });

    it('turns a failed run into an error on the configuration file', () => {
        const output = formatGithub(
            report([], { failure: { message: 'overrides[0]: needs "reason"', file: 'crowded-folders.config.json' } }),
        );
        assert.equal(
            output,
            '::error file=crowded-folders.config.json,line=1,title=crowded-folders%3A config/error::overrides[0]: needs "reason"\n',
        );
    });

    it('says nothing when there is nothing to say', () => {
        assert.equal(formatGithub(report([])), '');
    });
});

describe('azure pipelines', () => {
    it('writes task.logissue commands with a source path, a line and the rule as code', () => {
        const output = formatAzure(report([prefixGroup, tooManyFiles], { staleSuppressions: [] }));
        const lines = output.trimEnd().split('\n');
        const error = lines[0];
        const warning = lines[1];
        assert.match(
            error ?? '',
            /^##vso\[task\.logissue type=error;sourcepath=src\/cli\/render-\w+\.ts;linenumber=1;code=prefix-groups\]src\/cli: 4 modules/u,
        );
        assert.match(
            warning ?? '',
            /^##vso\[task\.logissue type=warning;sourcepath=src\/components\/\w+\.ts;linenumber=1;code=max-files\]/u,
        );
    });

    it('escapes what the agent would read as a command', () => {
        const hostile: Finding = {
            ...prefixGroup,
            message: '100%\n##vso[task.complete result=Succeeded]',
            files: ['a;b].ts'],
        };
        const output = formatAzure(report([hostile]));
        assert.equal(output.trimEnd().split('\n').length, 1);
        assert.match(output, /sourcepath=a%3Bb%5D\.ts/u);
        assert.match(output, /100%AZP25\\x0a##vso\[task\.complete/u);
    });
});

describe('markdown', () => {
    it('puts names in code, escapes the rest, and links the rule', () => {
        const markdown = formatMarkdown(
            report([{ ...prefixGroup, message: 'report-@octocat <img src=x onerror=alert(1)> a|b `c` #12' }]),
        );
        assert.match(
            markdown,
            /\| `src\/cli` \| \[prefix-groups\]\(https:\/\/example\.com\/docs\/rules\/prefix-groups\.md\) \|/u,
        );
        assert.doesNotMatch(markdown, /<img|@octocat|#12|[^\\]\|b/u);
        assert.match(
            markdown,
            /report-@&#8203;octocat &lt;img src=x onerror=alert\(1\)&gt; a\\\|b \\`c\\` #&#8203;12/u,
        );
    });

    it('survives a folder with a backtick, a pipe or a mention in its name', () => {
        const markdown = formatMarkdown(report([{ ...prefixGroup, folder: 'we`ird|@team\u{1B}' }]));
        assert.match(markdown, /\| `` we`ird\\\|@team\\x1b `` \|/u);
    });

    it('lists the worst problems up to the cap and says how many more, with a summary per group', () => {
        const markdown = formatMarkdown(
            report(crowd(30, 'error').map((finding, index) => ({ ...finding, project: `packages/p${index % 12}` }))),
            { maxFindings: 5 },
        );
        assert.equal(
            markdown.split('\n').filter(line => line.startsWith('| `packages/p') && line.includes('modules')).length,
            5,
        );
        assert.match(markdown, /_… and 25 more problems \(the 5 worst are listed;/u);
        assert.match(markdown, /\| Where \| Errors \| Warnings \|/u);
        assert.match(markdown, /_… and 2 more_/u);
    });

    it('stays under what GitHub keeps of a job summary, whatever the cap', () => {
        const findings = Array.from({ length: 8000 }, (_, index) => ({
            ...prefixGroup,
            folder: `packages/p${index}/src/features/some-long-folder-name`,
            message: `${prefixGroup.message} ${'x'.repeat(150)}`,
        }));
        const markdown = formatMarkdown(report(findings), { maxFindings: 100_000 });
        assert.ok(markdown.length < 1_048_576, `${markdown.length} bytes`);
        assert.match(markdown, /_… and [\d,]+ more problems/u);
    });

    it('says a failed run could not run', () => {
        assert.match(formatMarkdown(report([], { failure: { message: 'a <b>' } })), /could not run:\*\* a &lt;b&gt;/u);
    });
});

describe('gitlab code quality', () => {
    it('writes the entries the merge request widget reads, with unique stable fingerprints', () => {
        const entries = JSON.parse(
            formatGitlab(
                report([prefixGroup, tooManyFiles, tooManyFolders, tooManyFolders], {
                    files: ['src/features/a/x.ts'],
                }),
            ),
        ) as {
            description: string;
            check_name: string;
            fingerprint: string;
            severity: string;
            location: { path: string; lines: { begin: number } };
        }[];
        assert.equal(entries.length, 4);
        assert.deepEqual(
            entries.map(entry => entry.severity),
            ['major', 'minor', 'minor', 'minor'],
        );
        assert.equal(new Set(entries.map(entry => entry.fingerprint)).size, 4);
        assert.equal(entries[2]?.location.path, 'src/features/a/x.ts');
        assert.equal(entries[0]?.location.lines.begin, 1);
        assert.match(entries[0]?.description ?? '', /^src\/cli: 4 modules/u);
        assert.equal(
            entries[0]?.fingerprint,
            (JSON.parse(formatGitlab(report([prefixGroup]))) as { fingerprint: string }[])[0]?.fingerprint,
        );
    });
});

describe('checkstyle', () => {
    it('writes well-formed XML with one file element per anchor', () => {
        const xml = formatCheckstyle(
            report([{ ...prefixGroup, message: 'a < b & "c"', files: ['src/cli/a&b.ts'] }, unusedOverride], { hide }),
        );
        assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<checkstyle version="4.3">\n/u);
        assert.match(
            xml,
            /<file name="src\/cli\/a&amp;b\.ts">\n {4}<error line="1" severity="error" message="src\/cli: a &lt; b &amp; &quot;c&quot;" source="crowded-folders\.prefix-groups"\/>/u,
        );
        assert.match(xml, /<file name="crowded-folders\.config\.json">\n {4}<error line="1" severity="warning"/u);
        assert.match(xml, /<\/checkstyle>\n$/u);
        assert.doesNotMatch(xml, /Users/u);
    });
});

describe('json', () => {
    const rich = () =>
        report([prefixGroup, tooManyFiles, unusedOverride], {
            hide,
            findings: [
                { ...prefixGroup, project: 'src', owners: ['@org/web'] },
                { ...tooManyFiles, project: null, owners: [] },
                { ...unusedOverride, project: '.', owners: [] },
            ],
            staleSuppressions: [
                {
                    folder: 'src/old',
                    id: 'max-files',
                    rule: 'max-files',
                    key: undefined,
                    count: 30,
                    measured: undefined,
                    status: 'fixed',
                    file: 'crowded-folders-suppressions.json',
                },
            ],
            run: {
                presets: ['recommended'],
                presetsDetected: false,
                configFile: 'crowded-folders.config.json',
                fileSource: 'git',
                root: '.',
            },
            folderStats: [
                { path: 'src', modules: 3, files: 4, subfolders: 1, limit: 20 },
                { path: '.', modules: 1, files: 1, subfolders: 1, limit: null },
            ],
        });

    it('fits report.schema.json, with and without files and stats', () => {
        for (const options of [{}, { files: false }]) {
            const json = JSON.parse(formatJson(rich(), options)) as unknown;
            assert.deepEqual(validate(json, schema), []);
        }
        assert.deepEqual(validate(JSON.parse(formatJson(report([]))) as unknown, schema), []);
    });

    it('the schema rejects what is not a report', () => {
        const json = JSON.parse(formatJson(rich())) as { formatVersion: number; findings: { severity: string }[] };
        json.formatVersion = 2;
        json.findings[0]!.severity = 'fatal';
        assert.equal(validate(json, schema).length, 2);
    });

    it('says what it checked and how, and never an absolute path', () => {
        const json = JSON.parse(formatJson(rich())) as Record<string, unknown>;
        assert.equal(json['formatVersion'], 1);
        assert.deepEqual(json['run'], {
            presets: ['recommended'],
            presetsDetected: false,
            configFile: 'crowded-folders.config.json',
            fileSource: 'git',
            root: '.',
        });
        assert.doesNotMatch(JSON.stringify(json), /Users|C:\\/u);
    });

    it('gives limit as the configuration writes it, with how it is compared', () => {
        const json = JSON.parse(formatJson(rich())) as {
            findings: { rule: string; measured: number; limit: number | null; comparison: string | null }[];
        };
        const by = (rule: string) => json.findings.find(finding => finding.rule === rule);
        assert.deepEqual([by('prefix-groups')?.limit, by('prefix-groups')?.comparison], [4, '>=']);
        assert.deepEqual([by('max-files')?.limit, by('max-files')?.comparison], [20, '>']);
        assert.deepEqual([by('config/unused-override')?.measured, by('config/unused-override')?.limit], [1, 0]);
    });

    it('leaves out files and moves on request, keeping how many files there were', () => {
        const [finding] = (JSON.parse(formatJson(rich(), { files: false })) as { findings: Record<string, unknown>[] })
            .findings;
        assert.equal('files' in (finding ?? {}), false);
        assert.equal('moves' in (finding ?? {}), false);
        assert.equal(finding?.['fileCount'], 4);
    });

    it('lists every folder with its numbers when asked', () => {
        const json = JSON.parse(formatJson(rich())) as { folders: unknown[] };
        assert.deepEqual(json.folders[0], { path: 'src', modules: 3, files: 4, subfolders: 1, limit: 20 });
        assert.equal('folders' in (JSON.parse(formatJson(report([]))) as object), false);
    });

    it('carries the project and owners of each finding', () => {
        const json = JSON.parse(formatJson(rich())) as { findings: { project: string | null; owners: string[] }[] };
        assert.deepEqual(
            json.findings.map(finding => [finding.project, finding.owners]),
            [
                ['src', ['@org/web']],
                [null, []],
                ['.', []],
            ],
        );
    });
});

describe('the moves as commands', () => {
    it('quotes each path for its shell, a quote and a leading "-" included', () => {
        assert.equal(quoteSh('src/render/json.ts'), 'src/render/json.ts');
        assert.equal(quoteSh("it's/a b.ts"), String.raw`'it'\''s/a b.ts'`);
        assert.equal(quoteSh('-x.ts'), './-x.ts');
        assert.equal(quoteSh('app/(sign)/sign-in.tsx'), "'app/(sign)/sign-in.tsx'");
        assert.equal(quotePwsh("it's ‘x’.ts"), "'it''s ‘‘x’’.ts'");
        assert.equal(quotePwsh('a/$HOME/@b.ts'), "'a/$HOME/@b.ts'");
        assert.equal(quotePwsh('-x.ts'), './-x.ts');
    });

    it('makes each new folder once, before the moves into it; a rename in place needs none', () => {
        const moves = [
            { from: 'cli/render-json.ts', to: 'cli/render/json.ts' },
            { from: 'cli/__tests__/render-json.test.ts', to: 'cli/render/__tests__/json.test.ts' },
            { from: 'cli/render-text.ts', to: 'cli/render/text.ts' },
        ];
        assert.deepEqual(commandsOf({ directories: ['cli/render', 'cli/render/__tests__'], moves }, 'sh').slice(0, 2), [
            'mkdir -p cli/render',
            'mkdir -p cli/render/__tests__',
        ]);
        const renames = { ...prefixGroup, moves: [{ from: 'render/render-json.ts', to: 'render/json.ts' }] };
        assert.equal(formatMovesScript({ findings: [renames] }, 'sh').includes('mkdir'), false);
        assert.equal(formatMovesScript({ findings: [tooManyFiles] }, 'sh'), '');
    });
});
