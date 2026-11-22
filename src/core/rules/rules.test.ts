import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG } from '../config/types.ts';
import { validateConfig } from '../config/validate.ts';
import { explainFolder, type Finding, runEngine } from '../engine.ts';
import { BUILT_IN_PRESETS } from '../presets/index.ts';
import { BUILT_IN_RULES } from './index.ts';

/** Runs the built-in rules over a list of paths with one configuration layer. */
function findings(files: readonly string[], config: Config): Finding[] {
    const resolved = mergeLayer(EMPTY_CONFIG, config, 'test', true);
    return [...runEngine({ files, config: resolved, rules: BUILT_IN_RULES }).findings];
}

const many = (folder: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => `${folder}/file${index}.ts`);

describe('max-files', () => {
    it('reports a folder over the limit, and not one at it', () => {
        const result = findings([...many('a', 5), ...many('b', 4)], { rules: { 'max-files': ['error', { max: 4 }] } });
        assert.equal(result.length, 1);
        assert.equal(result[0]?.folder, 'a');
        assert.equal(result[0]?.measured, 5);
        assert.equal(result[0]?.limit, 4);
        assert.match(result[0]?.message ?? '', /5 files, over the limit of 4/u);
    });

    it('warns past warnAbove and fails only past max: CI can run it without suppressing (Ideas Crowded Folders)', () => {
        const options = { max: 20, warnAbove: 10 };
        const result = findings([...many('a', 10), ...many('b', 15), ...many('c', 21)], {
            rules: { 'max-files': ['error', options] },
        });
        assert.deepEqual(
            result.map(finding => `${finding.folder} ${finding.severity} ${finding.limit}`),
            ['b warn 10', 'c error 20'],
        );
        assert.match(result[0]?.message ?? '', /15 files, over the warning limit of 10 \(the limit is 20\)/u);
        assert.match(result[1]?.message ?? '', /21 files, over the limit of 20:/u);
        // A rule that is a warning stays one; a second limit at or over max adds nothing.
        const warned = findings(many('c', 21), { rules: { 'max-files': ['warn', options] } });
        assert.deepEqual(
            warned.map(finding => finding.severity),
            ['warn'],
        );
        assert.deepEqual(
            findings(many('b', 15), { rules: { 'max-files': ['error', { max: 20, warnAbove: 20 }] } }),
            [],
        );
    });

    it('counts a module and its companions once with count: "modules"', () => {
        const files = ['c/a.ts', 'c/a.spec.ts', 'c/a.html', 'c/b.ts', 'c/b.spec.ts'];
        assert.equal(findings(files, { rules: { 'max-files': ['error', { max: 2, count: 'files' }] } }).length, 1);
        assert.equal(findings(files, { rules: { 'max-files': ['error', { max: 2, count: 'modules' }] } }).length, 0);
    });

    it('leaves dotfiles out unless asked', () => {
        const files = ['.a', '.b', '.c', 'x.ts'];
        assert.equal(findings(files, { rules: { 'max-files': ['error', { max: 2 }] } }).length, 0);
        assert.equal(findings(files, { rules: { 'max-files': ['error', { max: 2, dotfiles: true }] } }).length, 1);
    });

    it('adds the hint only when the files are of the kind it is about (hintFor)', () => {
        const hint = { max: 2, hint: 'A folder is a package.', hintFor: ['*.{java,kt}'] };
        const code = findings(['a/A.java', 'a/B.java', 'a/C.kt'], { rules: { 'max-files': ['error', hint] } });
        assert.match(code[0]?.message ?? '', /A folder is a package.$/u);
        const sql = findings(['db/V1__a.sql', 'db/V2__b.sql', 'db/V3__c.sql'], {
            rules: { 'max-files': ['error', hint] },
        });
        assert.doesNotMatch(sql[0]?.message ?? '', /package/u);
    });

    it('adds the hint of the preset to the message', () => {
        const [finding] = findings(many('a', 3), {
            rules: { 'max-files': ['error', { max: 2, hint: 'In Go a folder is a package.' }] },
        });
        assert.match(finding?.message ?? '', /folder is a package\.$/u);
    });
});

describe('prefix-groups', () => {
    const render = [
        'cli/render-json.ts',
        'cli/render-text.ts',
        'cli/render-sarif.ts',
        'cli/render-pr.ts',
        'cli/main.ts',
    ];

    it('reports the modules that share a first word, with the folder they belong in', () => {
        const [finding, ...rest] = findings(render, { rules: { 'prefix-groups': 'error' } });
        assert.equal(rest.length, 0);
        assert.equal(finding?.key, 'render');
        assert.equal(finding?.measured, 4);
        assert.match(finding?.message ?? '', /cli\/render\/\.$/u);
        assert.deepEqual(finding?.moves[0], { from: 'cli/render-json.ts', to: 'cli/render/json.ts' });
    });

    it('counts modules, not files, and needs `min` of them', () => {
        const files = [
            'x/user-a.ts',
            'x/user-a.spec.ts',
            'x/user-b.ts',
            'x/user-b.spec.ts',
            'x/user-c.ts',
            'x/other.ts',
        ];
        assert.equal(findings(files, { rules: { 'prefix-groups': ['error', { min: 4 }] } }).length, 0);
        assert.equal(findings(files, { rules: { 'prefix-groups': ['error', { min: 3 }] } }).length, 1);
    });

    it('counts the module named exactly like the prefix: it is the main file of the group', () => {
        const files = ['s/report.ts', 's/report-nav.ts', 's/report-tab.ts', 's/report-messages.ts', 's/other.ts'];
        assert.equal(findings(files, { rules: { 'prefix-groups': 'error' } })[0]?.measured, 4);
    });

    it('stays quiet when the folder already has the name, or when the group is the whole folder', () => {
        const inside = render.map(path => path.replace('cli/', 'cli/render/'));
        assert.equal(
            findings(
                inside.filter(path => !path.endsWith('main.ts')),
                { rules: { 'prefix-groups': 'error' } },
            ).length,
            0,
        );
        const whole = render.filter(path => !path.endsWith('main.ts'));
        assert.equal(findings(whole, { rules: { 'prefix-groups': 'error' } }).length, 0);
        const plural = ['hooks/hook-a.ts', 'hooks/hook-b.ts', 'hooks/hook-c.ts', 'hooks/hook-d.ts', 'hooks/index.ts'];
        assert.equal(findings(plural, { rules: { 'prefix-groups': 'error' } }).length, 0);
    });

    it('skips ignored prefixes and ignored leading words', () => {
        const hooks = ['h/useA.ts', 'h/useB.ts', 'h/useC.ts', 'h/useD.ts', 'h/index.ts'];
        assert.equal(findings(hooks, { rules: { 'prefix-groups': 'error' } }).length, 1);
        assert.equal(findings(hooks, { rules: { 'prefix-groups': ['error', { ignore: ['use'] }] } }).length, 0);
        const interfaces = [
            's/IUserService.cs',
            's/IUserStore.cs',
            's/IOrderService.cs',
            's/IOrderStore.cs',
            's/IOrderView.cs',
            's/Program.cs',
        ];
        // A single capital glued to a capitalised word is a type letter, without configuring it.
        assert.deepEqual(
            findings(interfaces, { rules: { 'prefix-groups': ['error', { min: 3 }] } }).map(finding => finding.key),
            ['order'],
        );
        const read = findings(interfaces, {
            naming: { ignoreLeadingWords: ['i'] },
            rules: { 'prefix-groups': ['error', { min: 3 }] },
        });
        assert.deepEqual(
            read.map(finding => finding.key),
            ['order'],
        );
    });

    it('does not group numbered or dated files', () => {
        const migrations = [
            'm/0001_initial.py',
            'm/0002_user.py',
            'm/0003_user_email.py',
            'm/0004_order.py',
            'm/0005_x.py',
        ];
        assert.equal(findings(migrations, { rules: { 'prefix-groups': ['error', { min: 2 }] } }).length, 0);
    });

    it('does not group the entries of a numbered series (jasontaylordev/CleanArchitecture docs/decisions)', () => {
        const decisions = [
            'docs/decisions/ADR-000-template.md',
            'docs/decisions/ADR-001-Use-EFCore-In-Application-Layer.md',
            'docs/decisions/ADR-002-Aspire-For-Orchestration-And-Testing.md',
            'docs/decisions/ADR-003-MediatR-Contracts-In-Domain.md',
            'docs/decisions/README.md',
        ];
        assert.deepEqual(findings(decisions, { rules: { 'prefix-groups': 'error' } }), []);
        // One title that starts with a digit does not make the rest a series (tomlooman/ActionRoguelike).
        const meshes = [
            'm/MSH_1MeterSphere.uasset',
            'm/MSH_Black_Hole.uasset',
            'm/MSH_Coin.uasset',
            'm/MSH_Sphere.uasset',
            'm/T_x.uasset',
        ];
        assert.equal(findings(meshes, { rules: { 'prefix-groups': 'error' } }).length, 1);
    });

    it('does not group one file in several languages (sharkdp/bat doc/, localsend app/lib/gen/)', () => {
        const readmes = [
            'doc/README-ja.md',
            'doc/README-ko.md',
            'doc/README-ru.md',
            'doc/README-zh.md',
            'doc/logo.png',
        ];
        const strings = [
            ...['strings.g.dart', 'strings_ar.g.dart', 'strings_pt_BR.g.dart', 'strings_zh_Hant_TW.g.dart'].map(
                name => `gen/${name}`,
            ),
            'gen/assets.gen.dart',
        ];
        assert.deepEqual(findings([...readmes, ...strings], { rules: { 'prefix-groups': 'error' } }), []);
        const notLanguages = ['src/user-list.ts', 'src/user-card.ts', 'src/user-de.ts', 'src/user-es.ts', 'src/app.ts'];
        assert.equal(findings(notLanguages, { rules: { 'prefix-groups': 'error' } }).length, 1);
    });

    it('groups by more words when asked', () => {
        const files = ['x/user-list-a.ts', 'x/user-list-b.ts', 'x/user-card-a.ts', 'x/user-card-b.ts', 'x/z.ts'];
        assert.equal(findings(files, { rules: { 'prefix-groups': 'error' } })[0]?.key, 'user');
        assert.deepEqual(
            findings(files, { rules: { 'prefix-groups': ['error', { min: 2, words: 2 }] } }).map(
                finding => finding.key,
            ),
            ['user-card', 'user-list'],
        );
    });
});

describe('redundant-prefix', () => {
    it("reports modules that repeat the folder's name, and suggests the shorter name in the file's own convention", () => {
        const files = [
            'render/render-json.ts',
            'render/render-json.spec.ts',
            'render/RenderText.cs',
            'render/render.ts',
            'render/other.ts',
        ];
        const [finding] = findings(files, { rules: { 'redundant-prefix': 'error' } });
        assert.equal(finding?.measured, 2);
        assert.deepEqual(finding?.moves, [
            { from: 'render/RenderText.cs', to: 'render/Text.cs' },
            { from: 'render/render-json.spec.ts', to: 'render/json.spec.ts' },
            { from: 'render/render-json.ts', to: 'render/json.ts' },
        ]);
    });

    it('accepts the singular of a plural folder, and leaves the root alone', () => {
        const files = ['users/user-list.ts', 'users/user-card.ts', 'root-a.ts', 'root-b.ts'];
        const result = findings(files, { rules: { 'redundant-prefix': 'error' } });
        assert.deepEqual(
            result.map(finding => finding.folder),
            ['users'],
        );
    });
});

describe('max-folders and single-file-folders', () => {
    it('counts subfolders', () => {
        const files = Array.from({ length: 4 }, (_, index) => `features/f${index}/index.ts`);
        assert.equal(findings(files, { rules: { 'max-folders': ['error', { max: 3 }] } })[0]?.folder, 'features');
    });

    it('reports a folder holding a single file and nothing else', () => {
        const result = findings(['a/only.ts', 'b/x.ts', 'b/y.ts', 'c/d/e.ts'], {
            rules: { 'single-file-folders': 'warn' },
        });
        assert.deepEqual(
            result.map(finding => [finding.folder, finding.severity]),
            [
                ['a', 'warn'],
                ['c/d', 'warn'],
            ],
        );
    });
});

/** What `explain` would list as not reported in one folder. */
function notesOf(files: readonly string[], config: Config, folder: string): string[] {
    const resolved = mergeLayer(EMPTY_CONFIG, config, 'test', true);
    return (explainFolder({ files, config: resolved, rules: BUILT_IN_RULES }, folder)?.notes ?? []).map(
        note => `${note.rule} ${note.message}`,
    );
}

const named = (folder: string, names: readonly string[]): string[] => names.map(name => `${folder}/${name}`);

describe('prefix-groups: false positives of the field', () => {
    const prefixGroups: Config = {
        rules: { 'max-files': ['error', { max: 20, count: 'modules' }], 'prefix-groups': 'error' },
    };

    it('does not propose a folder for a group that is nearly the whole folder (domain/catalog/interfaces, 92 of 93)', () => {
        const files = named('domain/catalog/interfaces', [
            ...Array.from({ length: 92 }, (_, index) => `IExtAssetType${index}.ts`),
            'index.ts',
        ]);
        const result = findings(files, prefixGroups);
        assert.deepEqual(
            result.map(finding => finding.rule),
            ['max-files'],
        );
        assert.match(notesOf(files, prefixGroups, 'domain/catalog/interfaces')[0] ?? '', /92 of the folder's 93/u);
    });

    it('does not propose a folder that would be over max-files on its own', () => {
        const files = named('a', [
            ...Array.from({ length: 25 }, (_, index) => `user-x${index}.ts`),
            ...Array.from({ length: 10 }, (_, index) => `other${index}.ts`),
        ]);
        assert.deepEqual(
            findings(files, prefixGroups).map(finding => finding.rule),
            ['max-files'],
        );
        assert.match(notesOf(files, prefixGroups, 'a').join('\n'), /over max-files' limit of 20 on its own/u);
    });

    it('stays linear with one prefix shared by many files (Tomás: 30 000 took 3.9 s)', () => {
        // Judged by how the time grows, not by a clock: a loaded machine slows both sizes alike (the
        // full check, with coverage, once took 4.1 s for what takes 0.5 s alone). Eight times the
        // files take about eight times as long when linear, and sixty-four when quadratic; the best
        // of three runs leaves out a pause of the garbage collector.
        const time = (count: number): number => {
            const files = named(
                'big',
                Array.from({ length: count }, (_, index) => `user-${index}.ts`),
            );
            let best = Infinity;
            for (let run = 0; run < 3; run++) {
                const started = performance.now();
                findings([...files, 'big/other.ts'], { rules: { 'prefix-groups': 'error' } });
                best = Math.min(best, performance.now() - started);
            }
            return best;
        };
        time(3750); // the first runs pay for compiling
        const ratio = time(30_000) / time(3750);
        assert.ok(ratio < 24, `30 000 files took ${ratio.toFixed(1)} times as long as 3 750`);
    });

    it('groups the plural with the singular: UsersController, UserGroups, UserRoles, UserSettings (Kenji)', () => {
        const files = named('src', [
            'UsersController.kt',
            'UserGroups.kt',
            'UserRoles.kt',
            'UserSettings.kt',
            'Main.kt',
        ]);
        const [finding] = findings(files, prefixGroups);
        assert.equal(finding?.key, 'user');
        assert.equal(finding?.measured, 4);
    });

    it('does not read plural acronyms as two words: four IDs* are not a folder i/ (Tomás)', () => {
        const files = named('src', ['IDsCache.ts', 'IDsFilter.ts', 'IDsMap.ts', 'IDsSet.ts', 'getURLs.ts', 'APIs.ts']);
        assert.deepEqual(
            findings(files, prefixGroups).map(finding => finding.key),
            ['ids'],
        );
    });

    it('reads II18nKey and MI18nKey as one group of 12, not three of 4 (Sofía)', () => {
        const names = ['Key', 'Value', 'Text', 'Label', 'Title', 'Hint'].flatMap(rest => [
            `II18n${rest}.ts`,
            `MI18n${rest}.ts`,
        ]);
        const files = named('src', [...names, 'a.ts', 'b.ts', 'c.ts']);
        const result = findings(files, prefixGroups);
        assert.deepEqual(
            result.map(finding => [finding.key, finding.measured]),
            [['i18n', 12]],
        );
    });

    it('reads four OAuth* as oauth, not o (Tomás)', () => {
        const files = named('src', ['OAuthClient.ts', 'OAuthToken.ts', 'OAuthScope.ts', 'OAuthFlow.ts', 'main.ts']);
        assert.deepEqual(
            findings(files, prefixGroups).map(finding => finding.key),
            ['oauth'],
        );
    });

    it('counts each release of a folder of versions (docs/releases: v1.0.0.md … v1.25.1.md)', () => {
        const files = named(
            'docs/releases',
            Array.from({ length: 26 }, (_, index) => `v1.${index}.1.md`),
        );
        const [finding] = findings(files, prefixGroups);
        assert.equal(finding?.rule, 'max-files');
        assert.equal(finding?.measured, 26);
    });

    it('takes app_fil.arb and app_ckb.arb for translations (Tomás)', () => {
        const files = named('lib/l10n2', ['app_fil.arb', 'app_ckb.arb', 'app_en.arb', 'app_es.arb', 'other.dart']);
        assert.deepEqual(findings(files, prefixGroups), []);
        const latin = named('res', [
            'strings_es-419.json',
            'strings_en.json',
            'strings_fr.json',
            'strings.json',
            'x.json',
        ]);
        assert.deepEqual(findings(latin, prefixGroups), []);
    });

    it('takes the prefix of a folder that glues its words: feature/dayplan/ with DayPlanList (waypack)', () => {
        const folder = 'app/src/main/java/dev/bymaksym/waypack/feature/dayplan';
        const files = named(folder, [
            'DayPlanList.kt',
            'DayPlanOverlay.kt',
            'DayPlanRow.kt',
            'DayPlanScreen.kt',
            'DayPlanSheets.kt',
            'DayPlanViewModel.kt',
            'DayQuantity.kt',
            'DayTimelineGutter.kt',
            'TimelineEntry.kt',
        ]);
        // Three more files, so that the group is not most of the folder: the path alone is the reason.
        const more = [...files, ...named(folder, ['Alpha.kt', 'Beta.kt', 'Gamma.kt'])];
        assert.deepEqual(findings(more, prefixGroups), []);
        assert.match(notesOf(more, prefixGroups, folder).join('\n'), /"day" .*restates the folder's path/u);
    });

    it('lists in explain why a group is not reported', () => {
        const files = named('cli/render', [
            'render-json.ts',
            'render-text.ts',
            'render-sarif.ts',
            'render-pr.ts',
            'main.ts',
        ]);
        assert.match(notesOf(files, prefixGroups, 'cli/render').join('\n'), /restates the folder's path/u);
        const few = named('x', ['user-a.ts', 'user-b.ts', 'user-c.ts', 'other.ts', 'more.ts']);
        assert.match(notesOf(few, prefixGroups, 'x').join('\n'), /3 modules, and 4 make a group/u);
        const ignored = named('y', ['get-a.ts', 'get-b.ts', 'get-c.ts', 'get-d.ts', 'other.ts']);
        assert.match(
            notesOf(ignored, { rules: { 'prefix-groups': ['error', { ignore: ['get'] }] } }, 'y').join('\n'),
            /in prefix-groups' ignore/u,
        );
    });

    it('with words "auto", proposes the longer prefix (laboral-time-server)', () => {
        const files = named('src/main/java/x', [
            ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(letter => `RegistroHorario${letter}.java`),
            'RegistroUsuarioConRol.java',
            'Main.java',
            'Other.java',
        ]);
        const [finding] = findings(files, { rules: { 'prefix-groups': ['error', { words: 'auto' }] } });
        assert.equal(finding?.key, 'registro-horario');
        assert.equal(finding?.measured, 8);
    });

    it('names the real file in the message: IUserRepository.cs (Kenji)', () => {
        const files = named('Repos', [
            'IUserRepository.cs',
            'IUserStore.cs',
            'IUserView.cs',
            'UserMapper.cs',
            'A.cs',
            'B.cs',
        ]);
        const [finding] = findings(files, {
            naming: { companions: ['^I(?=[A-Z])'] },
            rules: { 'prefix-groups': 'error' },
        });
        assert.match(finding?.message ?? '', /IUserRepository\.cs/u);
    });
});

describe('options that can never match', () => {
    const problems = (config: Config): string[] =>
        validateConfig(config, BUILT_IN_RULES, []).map(problem => `${problem.at}: ${problem.message}`);

    it('suggests the written form of an ignore entry: render_json is render-json (Tomás)', () => {
        const [problem = ''] = problems({ rules: { 'prefix-groups': ['error', { ignore: ['render_json'] }] } });
        assert.match(problem, /did you mean "render-json"/u);
        assert.deepEqual(problems({ rules: { 'prefix-groups': ['error', { ignore: ['render-json', 'Test'] }] } }), []);
    });

    it('silences with an ignore entry written in capitals: "Test" is the prefix "test"', () => {
        const tests = ['t/TestA.cs', 't/TestB.cs', 't/TestC.cs', 't/TestD.cs', 't/Other.cs'];
        assert.equal(findings(tests, { rules: { 'prefix-groups': 'error' } }).length, 1);
        assert.equal(findings(tests, { rules: { 'prefix-groups': ['error', { ignore: ['Test'] }] } }).length, 0);
        const render = ['r/render-json.ts', 'r/render-text.ts', 'r/render-sarif.ts', 'r/render-pr.ts', 'r/main.ts'];
        assert.equal(findings(render, { rules: { 'prefix-groups': ['error', { ignore: ['Render'] }] } }).length, 0);
    });

    it('says that useState is two leading words (Tomás)', () => {
        const [problem = ''] = problems({ naming: { ignoreLeadingWords: ['useState'] } });
        assert.match(problem, /reads as "use", "state" — did you mean "use"/u);
        assert.deepEqual(problems({ naming: { ignoreLeadingWords: ['I', 'i18n', '!bp'] } }), []);
    });
});

describe('redundant-prefix: the plural of the folder (Tomás)', () => {
    const strict: Config = { rules: { 'redundant-prefix': 'error' } };

    it('reads categories/category-list.ts, classes/class-*, children/child-*, statuses/status-* as repeating', () => {
        const files = [
            ...named('categories', ['category-list.ts', 'category-card.ts']),
            ...named('classes', ['class-a.ts', 'class-b.ts']),
            ...named('children', ['child-row.ts', 'child-card.ts']),
            ...named('statuses', ['status-a.ts', 'status-b.ts']),
        ];
        const result = findings(files, strict);
        assert.deepEqual(
            result.map(finding => finding.folder),
            ['categories', 'children', 'classes', 'statuses'],
        );
        assert.deepEqual(result[0]?.moves[0], { from: 'categories/category-card.ts', to: 'categories/card.ts' });
    });

    it('does not read news/new-a.ts as repeating', () => {
        assert.deepEqual(findings(named('news', ['new-a.ts', 'new-b.ts']), strict), []);
    });

    it('reads a folder that glues its words: dayplan/DayPlanList.kt', () => {
        const [finding] = findings(named('dayplan', ['DayPlanList.kt', 'DayPlanRow.kt', 'Other.kt']), strict);
        assert.equal(finding?.measured, 2);
        assert.deepEqual(finding?.moves[0], { from: 'dayplan/DayPlanList.kt', to: 'dayplan/List.kt' });
    });
});

describe('case-collision', () => {
    const on: Config = { rules: { 'case-collision': 'error' } };

    it('reports names that are one on Windows and macOS: src/Components and src/components (Irina)', () => {
        const result = findings(
            ['src/Components/a.ts', 'src/components/b.ts', 'src/Foo.ts', 'src/foo.ts', 'src/bar.ts'],
            on,
        );
        assert.deepEqual(
            result.map(finding => [finding.folder, finding.key]),
            [
                ['src', 'components'],
                ['src', 'foo.ts'],
            ],
        );
    });

    it('reports café written in NFC and in NFD', () => {
        const [finding] = findings(['docs/café/a.md', 'docs/café/b.md'], on);
        assert.match(finding?.message ?? '', /written two ways in Unicode/u);
    });

    it('is off in recommended', () => {
        assert.equal(BUILT_IN_PRESETS['recommended']?.config.rules?.['case-collision'], 'off');
    });
});

describe('max-files: what is not counted', () => {
    it('leaves out the files that describe the folder: 20 classes and package-info.java are 20 (Kenji)', () => {
        const files = [...Array.from({ length: 20 }, (_, index) => `pkg/Class${index}.java`), 'pkg/package-info.java'];
        const config = (folderFiles: string[]): Config => ({
            naming: { folderFiles },
            rules: { 'max-files': ['error', { max: 20, count: 'modules' }] },
        });
        assert.equal(findings(files, config([])).length, 1);
        assert.equal(findings(files, config(['package-info.java'])).length, 0);
    });

    it('counts a module of many files once for every filesPerModule: 25 View+X.swift (Lucía)', () => {
        const files = Array.from({ length: 25 }, (_, index) => `App/Extensions/View+X${index}.swift`);
        const config = (filesPerModule: number): Config => ({
            naming: { companions: [String.raw`\+.+$`] },
            rules: { 'max-files': ['error', { max: 4, count: 'modules', filesPerModule }] },
        });
        assert.equal(findings(files, config(0)).length, 0);
        assert.equal(findings(files, config(5))[0]?.measured, 5);
        assert.match(notesOf(files, config(0), 'App/Extensions').join('\n'), /25 files counted as one module/u);
    });
});

describe('single-file-folders', () => {
    const rule = { 'single-file-folders': 'warn' } as const;

    it('reports a folder with one file, unless the file is allowed there', () => {
        const files = ['cmd/api/main.go', 'cmd/worker/job.go', 'crates/core/src/lib.rs'];
        assert.deepEqual(
            findings(files, { rules: rule }).map(finding => finding.folder),
            ['cmd/api', 'cmd/worker', 'crates/core/src'],
        );
        const allowed = findings(files, {
            rules: { 'single-file-folders': ['warn', { allowed: ['main.go', 'lib.rs'] }] },
        });
        assert.deepEqual(
            allowed.map(finding => finding.folder),
            ['cmd/worker'],
        );
    });

    it('matches allowed globs against the path, so a convention can be tied to a folder (Expo Router)', () => {
        const options = { allowed: ['**/app/**/index.*', '**/app/**/[[]*].*'] };
        const files = [
            'src/app/(app)/experiences/[id].tsx',
            'src/app/about/index.tsx',
            'src/components/card/index.tsx',
        ];
        assert.deepEqual(
            findings(files, { rules: { 'single-file-folders': ['warn', options] } }).map(finding => finding.folder),
            ['src/components/card'],
        );
    });
});

describe('prefix-groups with a prefix of fewer than three letters', () => {
    const options = { rules: { 'prefix-groups': ['error', { min: 4 }] } } satisfies Config;
    const inModels = (names: readonly string[]): string[] => names.map(name => `models/${name}.ts`);
    const other = ['main', 'args', 'util'];

    // No real name was found in the repository, its history or the notes: this is the pattern `x-…`.
    it('is not a folder that was never made: "x-order", "x-invoice" mark the name', () => {
        const files = inModels(['x-order', 'x-invoice', 'x-user', 'x-item', ...other]);
        assert.deepEqual(findings(files, options), []);
    });

    it('is not one for a single letter `a-` or `b-` either', () => {
        for (const letter of ['a', 'b']) {
            const files = inModels([`${letter}-one`, `${letter}-two`, `${letter}-three`, `${letter}-four`, ...other]);
            assert.deepEqual(findings(files, options), [], letter);
        }
    });

    it('is not one for two letters', () => {
        assert.deepEqual(findings(inModels(['ab-one', 'ab-two', 'ab-three', 'ab-four', ...other]), options), []);
    });

    it('is one from three letters, as before', () => {
        const [problem] = findings(inModels(['abc-one', 'abc-two', 'abc-three', 'abc-four', ...other]), options);
        assert.match(problem?.message ?? '', /4 modules start with "abc"/u);
    });
});
