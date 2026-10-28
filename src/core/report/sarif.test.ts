import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUILT_IN_RULES } from '../rules/index.ts';
import { formatSarif } from './machine.ts';
import { WHEN_IT_FIRES } from './rule-help.ts';
import { prefixGroup, report, rules, tooManyFiles, tooManyFolders, unusedOverride } from './test-support/fixtures.ts';
import { sarifViolations } from './test-support/sarif-rules.ts';

interface Result {
    ruleId: string;
    ruleIndex: number;
    level: string;
    message: { text: string };
    locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[];
    partialFingerprints: Record<string, string>;
}

interface Sarif {
    runs: {
        tool: { driver: { rules: { id: string; shortDescription: { text: string }; help: { markdown: string } }[] } };
        invocations: { executionSuccessful: boolean; toolExecutionNotifications?: { message: { text: string } }[] }[];
        results: Result[];
        properties?: Record<string, unknown>;
    }[];
}

const parse = (text: string): Sarif => JSON.parse(text) as Sarif;
const uriOf = (result: Result | undefined): string | undefined =>
    result?.locations[0]?.physicalLocation.artifactLocation.uri;

const full = () =>
    report([prefixGroup, tooManyFiles, tooManyFolders, unusedOverride], {
        files: [
            'src/features/account/a.ts',
            'src/features/admin/a.ts',
            'src/cli/render-json.ts',
            'crowded-folders.config.json',
        ],
        configFile: 'crowded-folders.config.json',
        overrideLines: { 'legacy/**': 7 },
        suppressionsFile: 'crowded-folders-suppressions.json',
        suppressionLines: { 'src/old\0max-files': 4 },
        staleSuppressions: [{ folder: 'src/old', id: 'max-files', count: 30, measured: undefined }],
        hide: [{ dir: 'C:\\Users\\ci\\work\\repo', as: '' }],
        run: {
            presets: ['recommended', 'angular'],
            presetsDetected: true,
            configFile: null,
            fileSource: 'git',
            root: '.',
        },
    });

describe('SARIF for GitHub code scanning', () => {
    it('satisfies the rules GitHub enforces', () => {
        assert.deepEqual(sarifViolations(parse(formatSarif(full()))), []);
        assert.deepEqual(sarifViolations(parse(formatSarif(report([])))), []);
    });

    it('the validator catches what it exists to catch', () => {
        const sarif = parse(formatSarif(full()));
        const [run] = sarif.runs;
        const [first] = run?.results ?? [];
        assert.ok(run && first);
        first.locations = [{ physicalLocation: { artifactLocation: { uri: '.' }, region: { startLine: 0 } } }];
        first.ruleId = 'no-such-rule';
        assert.ok(sarifViolations(sarif).length >= 3);
    });

    it('gives every location a line, and every result a descriptor, an index and a fingerprint', () => {
        const [run] = parse(formatSarif(full())).runs;
        assert.ok(run);
        const ids = run.tool.driver.rules.map(rule => rule.id);
        assert.deepEqual(ids, [
            'max-files',
            'max-folders',
            'prefix-groups',
            'config/unused-override',
            'config/stale-suppression',
        ]);
        for (const result of run.results) {
            assert.ok((result.locations[0]?.physicalLocation.region.startLine ?? 0) >= 1);
            assert.equal(ids[result.ruleIndex], result.ruleId);
            assert.match(result.partialFingerprints['crowdedFolders/v1'] ?? '', /^[\da-f]{28}$/u);
        }
    });

    it('describes rules in plain text, and in Markdown with when each fires', () => {
        const [run] = parse(formatSarif(full())).runs;
        const prefix = run?.tool.driver.rules.find(rule => rule.id === 'prefix-groups');
        assert.equal(prefix?.shortDescription.text, 'Modules that share a prefix are a folder.');
        const maxFiles = run?.tool.driver.rules.find(rule => rule.id === 'max-files');
        assert.equal(maxFiles?.shortDescription.text, 'A folder holds at most max modules.');
        assert.match(maxFiles?.help.markdown ?? '', /\*\*When it fires\.\*\* A folder holds more modules/u);
        assert.match(maxFiles?.help.markdown ?? '', /\[Documentation\]\(https:\/\/example\.com/u);
    });

    it('knows when every built-in rule fires', () => {
        for (const id of Object.keys(BUILT_IN_RULES)) {
            assert.ok(WHEN_IT_FIRES[id], `${id} has no entry in rule-help.ts`);
        }
    });

    it('keeps the fingerprint when a file joins the folder, and the anchor moves only to the new file', () => {
        const before = parse(formatSarif(report([prefixGroup])));
        const fingerprint = before.runs[0]?.results[0]?.partialFingerprints['crowdedFolders/v1'];
        const anchor = uriOf(before.runs[0]?.results[0]);
        const moved = new Set<string>();
        for (const name of ['a', 'aa', 'b-new', 'c', 'd', 'e', 'f', 'g', 'h']) {
            const joined = `src/cli/${name}.ts`;
            const after = parse(formatSarif(report([{ ...prefixGroup, files: [joined, ...prefixGroup.files] }])));
            const result = after.runs[0]?.results[0];
            assert.equal(result?.partialFingerprints['crowdedFolders/v1'], fingerprint);
            assert.ok([anchor, joined].includes(uriOf(result)), `${name}: anchored on ${uriOf(result) ?? ''}`);
            moved.add(uriOf(result) === anchor ? 'stayed' : 'moved');
        }
        assert.ok(moved.has('stayed'), 'a new file should not take over the anchor most of the time');
    });

    it('anchors a folder problem with no files on a file of the folder, not on a folder', () => {
        const [run] = parse(formatSarif(full())).runs;
        const result = run?.results.find(candidate => candidate.ruleId === 'max-folders');
        assert.match(uriOf(result) ?? '', /^src\/features\/(account|admin)\/a\.ts$/u);
    });

    it('prefers the files this change adds, so the pull request shows the annotation', () => {
        const added = new Set(['src/cli/render-text.ts']);
        const [run] = parse(formatSarif(report([prefixGroup], { addedFiles: added }))).runs;
        assert.equal(uriOf(run?.results[0]), 'src/cli/render-text.ts');
    });

    it('anchors config findings on the configuration file at the override line, with no machine path', () => {
        const [run] = parse(formatSarif(full())).runs;
        const result = run?.results.find(candidate => candidate.ruleId === 'config/unused-override');
        assert.equal(uriOf(result), 'crowded-folders.config.json');
        assert.equal(result?.locations[0]?.physicalLocation.region.startLine, 7);
        assert.doesNotMatch(result?.message.text ?? '', /Users|C:/u);
        assert.match(result?.message.text ?? '', /^The override for "legacy\/\*\*" in crowded-folders\.config\.json/u);
        assert.doesNotMatch(result?.message.text ?? '', /^the root/u);
    });

    it('reports a stale suppression on its own line of the suppressions file', () => {
        const [run] = parse(formatSarif(full())).runs;
        const result = run?.results.find(candidate => candidate.ruleId === 'config/stale-suppression');
        assert.equal(result?.level, 'error');
        assert.equal(uriOf(result), 'crowded-folders-suppressions.json');
        assert.equal(result?.locations[0]?.physicalLocation.region.startLine, 4);
        assert.match(result?.message.text ?? '', /^src\/old: max-files is suppressed at 30 and is fixed/u);
    });

    it('records how the run read its input', () => {
        const [run] = parse(formatSarif(full())).runs;
        assert.deepEqual(run?.properties, {
            presets: ['recommended', 'angular'],
            presetsDetected: true,
            configFile: null,
            fileSource: 'git',
            root: '.',
            filesChecked: 100,
            foldersChecked: 10,
        });
        assert.deepEqual(run?.invocations, [{ executionSuccessful: true }]);
    });

    it('still writes a file when the run failed, saying why and where', () => {
        const failed = report([], {
            rules: [],
            failure: {
                message: 'crowded-folders.config.json has a problem:\n  overrides[0]: needs "reason"',
                file: 'crowded-folders.config.json',
            },
        });
        const sarif = parse(formatSarif(failed));
        assert.deepEqual(sarifViolations(sarif), []);
        const [invocation] = sarif.runs[0]?.invocations ?? [];
        assert.equal(invocation?.executionSuccessful, false);
        assert.match(invocation?.toolExecutionNotifications?.[0]?.message.text ?? '', /needs "reason"/u);
        assert.equal(sarif.runs[0]?.results.length, 0);
    });

    it('encodes a hostile file name in the uri and escapes control characters in the message', () => {
        const hostile = { ...prefixGroup, folder: 'a b', files: ['a b/x\u{1B}[31m#1.ts'], message: 'x\ny' };
        const [run] = parse(formatSarif(report([hostile]))).runs;
        assert.equal(uriOf(run?.results[0]), 'a%20b/x%1B%5B31m%231.ts');
        assert.equal(run?.results[0]?.message.text, 'a b: x\\x0ay');
        assert.equal(rules.length, 3);
    });
});
