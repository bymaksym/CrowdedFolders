import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG, type ResolvedConfig } from '../config/types.ts';
import { validateConfig } from '../config/validate.ts';
import { explainFolder, type Finding, runEngine } from '../engine.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import { configFromDetections, detectPresets, excludesFor } from './detect.ts';
import { BUILT_IN_PRESETS } from './index.ts';

/** Applies a preset the way the loader does: what it extends first, each preset once. */
function resolvePreset(name: string, applied = new Set<string>(), base: ResolvedConfig = EMPTY_CONFIG): ResolvedConfig {
    if (applied.has(name)) {
        return base;
    }
    applied.add(name);
    const preset = BUILT_IN_PRESETS[name];
    assert.ok(preset, name);
    let config = base;
    for (const parent of preset.config.extends ?? []) {
        config = resolvePreset(parent, applied, config);
    }
    return mergeLayer(config, preset.config, name, false);
}

/** Several presets applied in the order of `extends`, each once, as the loader does. */
function checkAll(presets: readonly string[], files: readonly string[]): Finding[] {
    const applied = new Set<string>();
    let config: ResolvedConfig = EMPTY_CONFIG;
    for (const name of presets) {
        config = resolvePreset(name, applied, config);
    }
    return [...runEngine({ files, config, rules: BUILT_IN_RULES }).findings];
}

function check(preset: string, files: readonly string[]): Finding[] {
    return [...runEngine({ files, config: resolvePreset(preset), rules: BUILT_IN_RULES }).findings];
}

/** `count` files named `name(i)`, in a folder. */
const series = (folder: string, count: number, name: (index: number) => string): string[] =>
    Array.from({ length: count }, (_, index) => `${folder}/${name(index)}`);
/** The files of a folder, given their names. */
const inFolder = (folder: string, names: readonly string[]): string[] => names.map(name => `${folder}/${name}`);
/** Two letters for each index: a name that no numeric companion can strip. */
const letters = (index: number): string => String.fromCodePoint(97 + Math.floor(index / 26), 97 + (index % 26));
const pad = (index: number, width = 2): string => String(index + 1).padStart(width, '0');

describe('every built-in preset', () => {
    for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
        it(`${name} is a valid configuration with a description and sources`, () => {
            assert.deepEqual(validateConfig(preset.config, BUILT_IN_RULES, Object.keys(BUILT_IN_PRESETS)), []);
            assert.ok(preset.description.length > 40, 'describes what it changes and why');
            assert.ok(preset.sources.length > 0, 'says where its criterion comes from');
            for (const source of preset.sources) {
                assert.match(source.url, /^https:\/\//u);
            }
            for (const parent of preset.config.extends ?? []) {
                assert.ok(BUILT_IN_PRESETS[parent], `${name} extends ${parent}, which is not built in`);
            }
            for (const override of preset.config.overrides ?? []) {
                assert.ok(override.reason.length > 10, `an override of ${name} explains itself`);
            }
            if (name !== 'recommended' && name !== 'strict') {
                assert.ok(preset.detect, `${name} says when init proposes it`);
            }
        });
    }
});

describe('what the presets change', () => {
    const many = (folder: string, names: readonly string[]): string[] => names.map(name => `${folder}/${name}`);

    it('go reads test and platform files as their module, and loosens the limit', () => {
        const files = many('pkg/exec', [
            'exec.go',
            'exec_test.go',
            'exec_linux.go',
            'exec_windows.go',
            'exec_linux_amd64_test.go',
        ]);
        assert.deepEqual(check('go', files), []);
        const big = many(
            'pkg/http',
            Array.from({ length: 25 }, (_, index) => `f${index}.go`),
        );
        assert.deepEqual(
            check('recommended', big).map(finding => finding.rule),
            ['max-files'],
        );
        assert.deepEqual(check('go', big), []);
    });

    it('python joins test_x.py with x.py, and does not ask tests/ to group', () => {
        const files = many('tests', [
            'test_render_json.py',
            'test_render_text.py',
            'test_render_pr.py',
            'test_render_sarif.py',
            'conftest.py',
        ]);
        assert.deepEqual(check('python', files), []);
        const package_ = [...files.map(path => path.replace('tests/test_', 'pkg/')), 'pkg/cli.py'];
        assert.deepEqual(
            check('recommended', package_).map(finding => finding.key),
            ['render'],
        );
    });

    it('vue keeps coupled components flat in components/, as its guide asks', () => {
        const files = many('src/components', [
            'TodoList.vue',
            'TodoListItem.vue',
            'TodoListItemButton.vue',
            'TodoListFooter.vue',
            'AppHeader.vue',
        ]);
        assert.deepEqual(check('vue', files), []);
        assert.equal(check('recommended', files).length, 1);
    });

    it('react reads useAuthLogin as being about auth', () => {
        const files = many('src', ['useAuthLogin.ts', 'useAuthLogout.ts', 'AuthForm.tsx', 'AuthGuard.tsx', 'App.tsx']);
        assert.deepEqual(
            check('react', files).map(finding => finding.key),
            ['auth'],
        );
    });

    it('dotnet reads IUserService as part of UserService, and groups the user modules', () => {
        const files = many('Services', [
            'IUserService.cs',
            'UserService.cs',
            'UserStore.cs',
            'IUserStore.cs',
            'UserView.cs',
            'UserMapper.cs',
            'Program.cs',
        ]);
        const [finding] = check('dotnet', files);
        assert.equal(finding?.key, 'user');
        assert.equal(finding?.measured, 4);
    });

    it('android leaves res/ alone, where prefixes are the only grouping', () => {
        const files = many(
            'app/src/main/res/layout',
            Array.from({ length: 30 }, (_, index) => `activity_screen${index}.xml`),
        );
        assert.deepEqual(check('android', files), []);
    });

    it('unreal skips asset-type prefixes and groups by base asset name only from 15', () => {
        const rock = ['SM_Rock.uasset', 'T_Rock_D.uasset', 'T_Rock_N.uasset', 'M_Rock.uasset', 'MI_Rock_Wet.uasset'];
        const files = many('Content/Environment', [
            ...rock,
            'BP_Door.uasset',
            'BP_Lamp.uasset',
            'BP_Gate.uasset',
            'BP_Chest.uasset',
        ]);
        assert.deepEqual(check('unreal', files), []);
        assert.deepEqual(
            check('recommended', files).map(finding => finding.key),
            ['bp'],
        );
    });

    it('rails gives app/models more room, and makes groups there a warning', () => {
        const files = many(
            'app/models',
            Array.from({ length: 30 }, (_, index) => `model${index}.rb`),
        );
        assert.deepEqual(check('rails', files), []);
    });

    it('every preset leaves migrations, vendored code and fixtures out', () => {
        const files = [
            ...many(
                'db/migrations',
                Array.from({ length: 40 }, (_, index) => `${index}_step.py`),
            ),
            ...many(
                'vendor/lib',
                Array.from({ length: 40 }, (_, index) => `f${index}.c`),
            ),
            ...many(
                'test/fixtures',
                Array.from({ length: 40 }, (_, index) => `f${index}.json`),
            ),
        ];
        for (const name of Object.keys(BUILT_IN_PRESETS)) {
            assert.deepEqual(check(name, files), [], name);
        }
    });

    it('leaves out test data in either case, and changelog fragments', () => {
        const forty = (folder: string, extension: string): string[] =>
            many(
                folder,
                Array.from({ length: 40 }, (_, index) => `case${index}.${extension}`),
            );
        const files = [
            ...forty('tests/Composer/Test/Fixtures/installer', 'test'), // composer/composer
            ...forty('Snapshots/Issues', 'swift'), // nicklockwood/SwiftFormat
            ...forty('tooling/rounds/expected', 'json'), // expected outputs of an end-to-end run
            ...forty('changelog', 'md'), // rubocop/rubocop
        ];
        assert.deepEqual(check('recommended', files), []);
    });

    it("docs makes groups of pages warnings, and leaves the code next to them alone (square/okhttp's root mkdocs.yml)", () => {
        const pages = [
            'response-cookies.md',
            'response-headers.md',
            'response-status.md',
            'response-directly.md',
            'events.md',
        ];
        const code = [
            'RealCall.kt',
            'RealConnection.kt',
            'RealConnectionPool.kt',
            'RealRoutePlanner.kt',
            'Exchange.kt',
        ];
        const findings = check('docs', [
            ...many('docs/advanced', pages),
            ...many('okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/connection', code),
        ]);
        assert.deepEqual(
            findings.map(finding => `${finding.folder} ${finding.severity}`),
            ['docs/advanced warn', 'okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/connection error'],
        );
    });

    it("angular has recommended's 20 in src/ and the 10 of the former guide under features/", () => {
        const ts = (folder: string, count: number): string[] =>
            series(folder, count, index => `part${letters(index)}.ts`);
        const files = [...ts('src/app/state', 12), ...ts('src/app/features/orders', 12), ...ts('src/app/core', 25)];
        assert.deepEqual(
            check('angular', files).map(finding => finding.folder),
            ['src/app/core', 'src/app/features/orders'],
        );
    });

    it('angular gives its hint only to a folder named after a type, and only on TypeScript (Ideas Crowded Folders 8)', () => {
        const hinted = /by type|Angular/u;
        const messages = (files: string[]): string[] => check('angular', files).map(finding => finding.message);
        assert.match(messages(series('src/app/components', 25, index => `part${letters(index)}.ts`))[0] ?? '', hinted);
        // A folder that is not by type is told nothing about types: shared/state, assets/ui.
        for (const files of [
            series('src/app/state', 25, index => `part${letters(index)}.ts`),
            series('src/assets/ui', 25, index => `icon-${letters(index)}.ts`),
            series('src/styles/components', 25, index => `_part-${letters(index)}.scss`),
            series('tooling/rounds', 25, index => `part${letters(index)}.mjs`),
        ]) {
            const [message = ''] = messages(files);
            assert.match(message, /over the limit/u, files[0]);
            assert.doesNotMatch(message, hinted, files[0]);
        }
    });

    it('angular tells a folder that is already by type to group by topic inside (core/services, shared/utils)', () => {
        for (const folder of ['src/app/core/services', 'src/app/shared/utils']) {
            const [finding] = check(
                'angular',
                series(folder, 25, index => `part${letters(index)}.ts`),
            );
            assert.match(finding?.message ?? '', /group by topic inside, e\.g\. utils\/filters\//u);
            assert.doesNotMatch(finding?.message ?? '', /Angular asks/u);
        }
    });

    it('nuxt warns before grouping composables, which are auto-imported from the top level only', () => {
        const composables = ['useAuthLogin.ts', 'useAuthLogout.ts', 'useAuthToken.ts', 'useAuthUser.ts', 'useTheme.ts'];
        const findings = check('nuxt', many('app/composables', composables));
        assert.deepEqual(
            findings.map(finding => `${finding.rule} ${finding.severity}`),
            ['prefix-groups warn'],
        );
        assert.match(findings[0]?.message ?? '', /re-exports it, or imports\.dirs/u);
    });

    it("docs leaves a blog's dated posts alone, and treats content/ as pages (jekyll/jekyll, astro-paper)", () => {
        const posts = many(
            'docs/_posts',
            Array.from(
                { length: 102 },
                (_, index) => `2016-01-${String(index).padStart(3, '0')}-jekyll-release.markdown`,
            ),
        );
        const howTo = many('src/content/posts', [
            'how-to-add-latex-equations-in-blog-posts.md',
            'how-to-configure-astropaper-theme.md',
            'how-to-integrate-giscus-comments.md',
            'how-to-update-dependencies.md',
            'adding-new-post.md',
        ]);
        const pages = many('content/en/methods/pages', [
            'ByDate.md',
            'ByLanguage.md',
            'ByLength.md',
            'ByTitle.md',
            'Next.md',
        ]);
        assert.deepEqual(
            check('docs', [...posts, ...howTo, ...pages]).map(finding => `${finding.folder} ${finding.severity}`),
            ['content/en/methods/pages warn'],
        );
    });

    it('strict asks for more than recommended', () => {
        const files = many('src', ['user-a.ts', 'user-b.ts', 'user-c.ts', 'other.ts']);
        assert.deepEqual(check('recommended', files), []);
        assert.deepEqual(
            check('strict', files).map(finding => finding.rule),
            ['prefix-groups'],
        );
    });

    it('a preset applied twice changes nothing', () => {
        const once: Config = { extends: ['recommended', 'react'] };
        assert.deepEqual(
            resolvePreset('nextjs').rules,
            resolvePreset('nextjs', new Set(['recommended']), resolvePreset('recommended')).rules,
        );
        assert.ok(once);
    });
});

describe('recommended, after the review of 21-10-2026', () => {
    it('reads validate-i18n as being about i18n in scripts/ and tooling/, and not in src/', () => {
        const verbs = ['validate-i18n', 'validate-links', 'validate-schema', 'validate-env', 'check-docs'];
        const names = verbs.map(name => `${name}.mjs`);
        assert.deepEqual(check('recommended', [...inFolder('tooling', names), ...inFolder('scripts', names)]), []);
        const code = ['validate-a.ts', 'validate-b.ts', 'validate-c.ts', 'validate-d.ts', 'main.ts'];
        assert.equal(check('recommended', inFolder('src/forms', code)).length, 1);
    });

    it('leaves the folders generators write out: __generated__, *.generated.*, a root generated/ (Relay, GraphQL)', () => {
        const files = [
            ...series('src/__generated__', 30, index => `Query${index}.graphql.ts`),
            ...series('src/api', 30, index => `schema${index}.generated.ts`),
            ...series('generated', 30, index => `file${index}.ts`),
            ...series('gen', 30, index => `file${index}.ts`),
        ];
        assert.deepEqual(check('recommended', files), []);
    });

    it('does not take a Java package called generated, gen, vendor or build for generated code', () => {
        const classes = (folder: string): string[] => series(folder, 25, index => `Class${index}.java`);
        const files = [
            ...classes('src/main/java/com/acme/generated'),
            ...classes('src/main/java/com/acme/vendor'),
            ...classes('com/acme/build'),
        ];
        assert.deepEqual(
            check('java', files).map(finding => finding.folder),
            ['com/acme/build', 'src/main/java/com/acme/generated', 'src/main/java/com/acme/vendor'],
        );
    });

    it('checks a Go command called migrate (cmd/migrate), and still leaves out db/migrate', () => {
        const files = [
            ...series('cmd/migrate', 25, index => `step${index}.go`),
            ...series('db/migrate', 40, index => `${pad(index, 14)}_add_column.rb`),
        ];
        assert.deepEqual(
            check('recommended', files).map(finding => finding.folder),
            ['cmd/migrate'],
        );
    });

    it('leaves out fastlane/metadata, which fastlane wants flat (60 changelogs)', () => {
        const files = series('fastlane/metadata/android/en-US/changelogs', 60, index => `${index + 100}.txt`);
        assert.deepEqual(check('recommended', files), []);
    });

    it('recognises a series of migrations by the shape of its name, wherever it is kept', () => {
        const flyway = [
            ...series('src/main/sql', 30, index => `V${index + 1}_2__init.sql`),
            ...series('src/main/sql', 6, index => `R__views${index}.sql`),
            ...series('src/main/sql', 3, index => `U${index + 1}__undo.sql`),
        ];
        const files = [
            ...flyway,
            ...series('db/changes', 30, index => `${pad(index, 6)}_create_users.up.sql`),
            ...series('db/changes', 30, index => `${pad(index, 6)}_create_users.down.sql`),
            ...series('src/migration', 30, index => `${1_612_345_678_000 + index}-CreateUsers.ts`),
        ];
        assert.deepEqual(check('recommended', files), []);
        // Not a series: a validator is not a migration.
        const classes = series('src/main/java', 25, index => `V${index}Controller.java`);
        assert.equal(check('recommended', classes).length, 1);
    });

    it('leaves out the formats of animation, 3D and mobile assets', () => {
        const extensions = ['riv', 'lottie', 'caf', 'aiff', 'heic', 'glb', 'gltf', 'fbx', 'obj', 'tga', 'ktx2'];
        const files = extensions.flatMap(extension =>
            series(`assets/${extension}`, 25, index => `a${index}.${extension}`),
        );
        assert.deepEqual(check('recommended', files), []);
    });

    it('does not count translations in lib/src/localization, in lower case (flutter skeleton)', () => {
        const files = series('lib/src/localization', 25, index => `app_${pad(index)}.arb`);
        assert.deepEqual(check('recommended', files), []);
    });

    it('gives the root of a package the 40 of the root of the repository (apps/shop)', () => {
        const configs = (folder: string): string[] => [
            ...series(folder, 24, index => `config${index}.json`),
            `${folder}/package.json`,
        ];
        const finding = check('recommended', [...configs('apps/shop'), ...configs('apps/shop/src/legacy')]);
        assert.deepEqual(
            finding.map(item => item.folder),
            [],
        );
        const noManifest = series('apps/shop/docs-site', 25, index => `config${index}.json`);
        assert.deepEqual(
            check('recommended', noManifest).map(item => item.folder),
            ['apps/shop/docs-site'],
        );
    });

    it('does not ask __tests__ or stories to group on their own (packages/ui)', () => {
        const components = ['button', 'badge', 'banner', 'bar', 'x'];
        const files = [
            ...components.map(name => `packages/ui/src/__tests__/${name}.test.tsx`),
            ...components.map(name => `packages/ui/src/stories/${name}.stories.tsx`),
        ];
        assert.deepEqual(check('recommended', files), []);
        assert.equal(
            check('recommended', components.map(name => `packages/ui/src/${name}-a.tsx`).slice(0, 4)).length,
            0,
        );
        const code = ['button-a', 'button-b', 'button-c', 'button-d', 'x'].map(name => `packages/ui/src/${name}.tsx`);
        assert.equal(check('recommended', code).length, 1);
    });
});

describe('languages, after the review of 21-10-2026', () => {
    it('java and dotnet read the test doubles and base classes as being about their subject', () => {
        const repositories = ['Repository', 'Service', 'Store', 'Cache'].map(name => `FakeUser${name}.java`);
        const found = check('java', inFolder('src/test/java/com/acme', [...repositories, 'App.java']));
        assert.deepEqual(
            found.map(finding => finding.key),
            ['user'],
        );
        assert.deepEqual(
            check('recommended', inFolder('src/test/java/com/acme', [...repositories, 'App.java'])).map(
                finding => finding.key,
            ),
            ['fake'],
        );
        const bases = ['AbstractHandler', 'DefaultHandler', 'SimpleHandler', 'BaseHandler', 'Main'].map(
            name => `${name}.java`,
        );
        assert.deepEqual(
            check('java', inFolder('src/main/java/com/acme/core', bases)).map(finding => finding.key),
            ['handler'],
        );
        const doubles = ['Mock', 'Stub', 'Spy', 'Dummy'].map(prefix => `${prefix}Clock.cs`);
        assert.deepEqual(
            check('dotnet', inFolder('Tests', [...doubles, 'Program.cs'])).map(finding => finding.key),
            ['clock'],
        );
    });

    it('swift reads FakeAuthService as being about auth', () => {
        const names = ['Fake', 'Mock', 'Stub', 'Spy'].map(prefix => `${prefix}AuthService.swift`);
        assert.deepEqual(
            check('swift', inFolder('Tests/Doubles', [...names, 'Main.swift'])).map(finding => finding.key),
            ['auth'],
        );
    });

    it('java checks a package called build (com/acme/build), and leaves out what the build writes', () => {
        const classes = (folder: string): string[] => series(folder, 25, index => `Task${pad(index)}.kt`);
        const files = [
            ...classes('src/main/kotlin/com/acme/build'),
            ...classes('build/classes'),
            ...classes('target/classes'),
        ];
        assert.deepEqual(
            check('java', files).map(finding => finding.folder),
            ['src/main/kotlin/com/acme/build'],
        );
    });

    it('java leaves out META-INF, where strict would ask to flatten META-INF/spring', () => {
        const files = [
            'src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports',
            'src/main/resources/META-INF/services/org.acme.Plugin',
        ];
        assert.deepEqual(checkAll(['strict', 'java'], files), []);
    });

    it('java puts its hint on code, not on SQL (laboral-time-server)', () => {
        const sql = inFolder(
            'src/main/resources/queries',
            Array.from({ length: 25 }, (_, index) => `query${pad(index)}.sql`),
        );
        const code = series('src/main/java/com/acme', 25, index => `Thing${pad(index)}.java`);
        const [onSql] = check('java', sql);
        const [onCode] = check('java', code);
        assert.doesNotMatch(onSql?.message ?? '', /package/u);
        assert.match(onCode?.message ?? '', /A folder is a package/u);
    });

    it('android ignores the platform in build-logic (nowinandroid) and leaves out composeResources', () => {
        const plugins = [
            'AndroidApplicationConventionPlugin',
            'AndroidLibraryConventionPlugin',
            'AndroidFeatureConventionPlugin',
            'AndroidRoomConventionPlugin',
            'AndroidHiltConventionPlugin',
        ].map(name => `${name}.kt`);
        const files = inFolder('build-logic/convention/src/main/kotlin', [...plugins, 'Utils.kt']);
        assert.deepEqual(check('android', files), []);
        assert.equal(check('recommended', files).length, 1);
        const drawables = series(
            'composeApp/src/commonMain/composeResources/drawable',
            40,
            index => `ic_${pad(index)}.xml`,
        );
        assert.deepEqual(check('android', drawables), []);
    });

    it('java leaves out composeResources too: Kotlin Multiplatform without an AndroidManifest.xml is detected as java', () => {
        const drawables = series(
            'composeApp/src/commonMain/composeResources/drawable',
            40,
            index => `ic_${pad(index)}.xml`,
        );
        assert.deepEqual(check('java', drawables), []);
    });

    it('android reads Platform.kt, Platform.android.kt and Platform.ios.kt as one module', () => {
        const files = inFolder('shared/src', [
            'Platform.kt',
            'Platform.android.kt',
            'Platform.ios.kt',
            'Platform.jvm.kt',
        ]);
        const view = explainFolder({ files, config: resolvePreset('android'), rules: BUILT_IN_RULES }, 'shared/src');
        assert.equal(view?.folder.modules.length, 1);
    });

    it('swift leaves out vendored frameworks and DocC resources (GoogleMobileAds.xcframework)', () => {
        const headers = series(
            'Frameworks/GoogleMobileAds.xcframework/ios-arm64/Headers',
            40,
            index => `GAD${pad(index)}.h`,
        );
        const docc = series('Sources/Kit/Kit.docc/Resources', 40, index => `step${pad(index)}.json`);
        const bundle = series('Resources/Fonts.bundle', 40, index => `font${pad(index)}.json`);
        assert.deepEqual(check('swift', [...headers, ...docc, ...bundle]), []);
    });

    it('flutter leaves out the .arb files in any folder and the generated suffixes', () => {
        const arb = series('lib/src/localization', 25, index => `app_${pad(index)}.arb`);
        const generated = [
            'app_router.gr.dart',
            'user_test.mocks.dart',
            'injection.config.dart',
            'assets.gen.dart',
            'user.pb.dart',
            'user.pbenum.dart',
            'user.pbgrpc.dart',
            'api.chopper.dart',
        ].flatMap(name => series('lib/gen', 4, index => `${pad(index)}${name}`));
        assert.deepEqual(check('flutter', [...arb, ...generated]), []);
    });

    it('go checks cmd/migrate, leaves out the generators output, and lets strict keep cmd/api/main.go', () => {
        const generated = [
            ...series('internal/store', 40, index => `mock_store${pad(index)}.go`),
            ...series('internal/store', 40, index => `query${pad(index)}.sql.go`),
            ...series('internal/web', 40, index => `view${pad(index)}_templ.go`),
            'cmd/api/wire_gen.go',
            ...series('api', 40, index => `svc${pad(index)}.pb.gw.go`),
        ];
        assert.deepEqual(check('go', generated), []);
        const migrate = series('cmd/migrate', 35, index => `step${pad(index)}.go`);
        assert.deepEqual(
            check('go', migrate).map(finding => finding.folder),
            ['cmd/migrate'],
        );
        const commands = ['cmd/api/main.go', 'cmd/worker/job.go'];
        assert.deepEqual(
            checkAll(['go', 'strict'], commands).map(finding => finding.folder),
            ['cmd/worker'],
        );
    });

    it('rust lets strict keep crates/core/src/lib.rs, which Cargo requires', () => {
        const files = ['crates/core/src/lib.rs', 'crates/cli/src/main.rs', 'crates/cli/src/util/mod.rs'];
        assert.deepEqual(
            checkAll(['rust', 'strict'], files).map(finding => finding.folder),
            ['crates/cli/src/util'],
        );
    });

    it('django lets strict keep shop/management/__init__.py alone, which makes management a package', () => {
        const files = [
            'manage.py',
            'shop/__init__.py',
            'shop/models.py',
            'shop/management/__init__.py',
            'shop/management/commands/__init__.py',
            'shop/management/commands/import_products.py',
            'shop/utils/__init__.py',
        ];
        assert.deepEqual(
            checkAll(['django', 'strict'], files).map(finding => `${finding.rule} ${finding.folder}`),
            ['single-file-folders shop/utils'],
        );
    });

    it('django keeps management/commands and templatetags flat, and templates named after the app', () => {
        const files = [
            ...series('zerver/management/commands', 40, index => `import_${pad(index)}.py`),
            ...series('orders/templatetags', 40, index => `tags_${pad(index)}.py`),
            'orders/templates/orders/order_list.html',
            'orders/templates/orders/order_detail.html',
            'orders/templates/orders/order_form.html',
        ];
        assert.deepEqual(checkAll(['strict', 'django'], files), []);
        assert.equal(
            checkAll(
                ['strict', 'python'],
                ['orders/templates/orders/order_list.html', 'orders/templates/orders/order_detail.html'],
            ).length,
            1,
        );
    });

    it('c-cpp, php and terraform put their hint only on their own files', () => {
        const message = (preset: string, extension: string): string => {
            // Three others: a group of 85 % of the folder is what the folder is about, not a group in it.
            const names = ['net_a', 'net_b', 'net_c', 'net_d', 'net_e', 'net_f', 'other', 'misc', 'util'];
            return (
                check(
                    preset,
                    inFolder(
                        'x',
                        names.map(name => `${name}.${extension}`),
                    ),
                )[0]?.message ?? ''
            );
        };
        assert.match(message('c-cpp', 'c'), /subsystem/u);
        assert.doesNotMatch(message('c-cpp', 'txt'), /subsystem/u);
        assert.match(message('php', 'php'), /PSR-4/u);
        assert.doesNotMatch(message('php', 'txt'), /PSR-4/u);
        assert.match(message('terraform', 'tf'), /child module/u);
        assert.doesNotMatch(message('terraform', 'txt'), /child module/u);
    });
});

describe('game engines, after the review of 21-10-2026', () => {
    it('unity leaves out ProjectSettings and the third party in Assets, and checks embedded packages', () => {
        const files = [
            ...series('ProjectSettings', 40, index => `Setting${pad(index)}.asset`),
            ...series('Assets/TextMesh Pro/Shaders', 40, index => `TMP_Shader${pad(index)}.shader`),
            ...series('Assets/Samples/Cinemachine', 40, index => `Sample${pad(index)}.cs`),
            ...series('Assets/ThirdParty/Lib', 40, index => `Lib${pad(index)}.cs`),
            'Packages/manifest.json',
            'Packages/packages-lock.json',
        ];
        assert.deepEqual(check('unity', files), []);
        const embedded = series('Packages/com.acme.inventory/Runtime', 35, index => `Item${letters(index)}.cs`);
        assert.deepEqual(
            check('unity', embedded).map(finding => finding.folder),
            ['Packages/com.acme.inventory/Runtime'],
        );
    });

    it('unity and godot cite their own guide, not the one of Unreal', () => {
        // Besides the 16 rocks, enough other assets that the rocks are a group in the folder (under 85 %).
        const others = ['Other', 'Tree', 'Bush', 'Grass'].map(name => `Assets/Art/${name}.fbx`);
        const art = series('Assets/Art', 16, index => `Rock_${letters(index)}.fbx`);
        const unity = check('unity', [...art, ...others]).find(finding => finding.rule === 'prefix-groups');
        assert.match(unity?.message ?? '', /Unity's guide splits a project by asset type/u);
        assert.doesNotMatch(unity?.message ?? '', /If you find yourself/u);
        const godot = check('godot', [...art, ...others]).find(finding => finding.rule === 'prefix-groups');
        assert.match(godot?.message ?? '', /as close to scenes as possible/u);
        assert.doesNotMatch(godot?.message ?? '', /If you find yourself/u);
    });

    it('godot reads run_01.png … run_24.png as one animation', () => {
        const frames = series('assets/player', 24, index => `run_${pad(index)}.png`);
        const imports = frames.map(name => `${name}.import`);
        const others = series('assets/player', 4, index => `attack_${pad(index)}.png`);
        assert.deepEqual(check('godot', [...frames, ...imports, ...others, 'assets/player/idle.png']), []);
        assert.equal(check('recommended', [...frames, ...imports]).length, 1);
        const bare = [...frames, 'assets/player/idle.png', ...series('assets/player', 2, index => `jump${index}.png`)];
        assert.deepEqual(check('godot', bare), []);
    });

    it('unreal reads asset prefixes only in Content/: AIController and AITask… group in Source/ (Lucía)', () => {
        const ai = ['AIController', 'AITaskAttack', 'AITaskPatrol', 'AIPerception', 'AISenseSight'].flatMap(name => [
            `Source/Game/${name}.h`,
            `Source/Game/${name}.cpp`,
        ]);
        assert.deepEqual(
            check('unreal', [...ai, 'Source/Game/Player.cpp', 'Source/Game/Weapon.cpp']).map(
                finding => `${finding.rule} ${finding.key ?? ''}`,
            ),
            ['prefix-groups ai'],
        );
        // In Content/ the same prefix is still the asset's type: AI_Guard is about the guard.
        const content = ['AI_Guard', 'AI_Patrol', 'AI_Boss', 'AI_Drone', 'AI_Turret'].map(
            name => `Content/AI/${name}.uasset`,
        );
        assert.deepEqual(check('unreal', [...content, 'Content/AI/Notes.uasset']), []);
    });

    it('unity and godot fail on a companion without its asset; Plugins.meta with Plugins/ left out is not one', () => {
        const unity = check('unity', [
            'Assets/Scripts/Player.cs.meta',
            'Assets/Scripts/Enemy.cs',
            'Assets/Scripts/Enemy.cs.meta',
            // Assets/Plugins is excluded by the preset; its .meta is still next to it in the repository.
            'Assets/Plugins.meta',
            'Assets/Plugins/Vendor.dll',
            // open-project-1: the .meta of an empty folder, which git cannot store.
            'Assets/AddressableAssetsData/OSX.meta',
            'Assets/AddressableAssetsData/Default.asset',
            'Assets/AddressableAssetsData/Default.asset.meta',
        ]);
        assert.deepEqual(
            unity.map(finding => `${finding.rule} ${finding.severity} ${finding.folder}`),
            ['orphan-companions error Assets/Scripts'],
        );
        const godot = check('godot', ['art/icon.png.import', 'art/hero.png', 'art/hero.png.import', 'project.godot']);
        assert.deepEqual(
            godot.map(finding => `${finding.rule} ${finding.severity} ${finding.folder}`),
            ['orphan-companions error art'],
        );
    });

    it('unreal warns on type folders only in Content/, godot on textures/ but not assets/', () => {
        const unreal = check('unreal', [
            'Content/ActionRoguelike/Materials/MI_RageBar.uasset',
            'Content/Characters/Common/Animations/A_Run.uasset',
            'Source/Materials/MaterialHelpers.cpp',
        ]);
        assert.deepEqual(
            unreal.map(finding => `${finding.rule} ${finding.severity} ${finding.folder}`),
            ['type-folders warn Content/ActionRoguelike/Materials'],
        );
        assert.match(unreal[0]?.message ?? '', /Allar 2\.6\.2/u);
        const godot = check('godot', ['3d/csg/textures/grid.png', 'assets/player/idle.png', 'project.godot']);
        assert.deepEqual(
            godot.map(finding => `${finding.rule} ${finding.severity} ${finding.folder}`),
            ['type-folders warn 3d/csg/textures'],
        );
    });

    it('unreal leaves out World Partition, takes C++ at the limits of c-cpp, and warns on both limits', () => {
        const partition = series('Content/__ExternalActors__/Maps/L1/3/AB', 60, index => `C${pad(index, 8)}.uasset`);
        assert.deepEqual(check('unreal', partition), []);
        const code = series('Source/Game/Gameplay', 25, index => `Thing${pad(index)}.cpp`);
        assert.deepEqual(
            check('unreal', code).map(finding => `${finding.rule} ${finding.severity}`),
            ['max-files error'],
        );
        const assets = series('Content/Props', 25, index => `SM_Thing${pad(index)}.uasset`);
        assert.deepEqual(check('unreal', assets), []);
        const sameName = series('Content/Props', 16, index => `SM_Rock_X${letters(index)}.uasset`);
        assert.deepEqual(
            check('unreal', [
                ...sameName,
                ...['T_Other', 'T_Tree', 'T_Bush', 'T_Grass'].map(name => `Content/Props/${name}.uasset`),
            ]).map(finding => `${finding.rule} ${finding.severity}`),
            ['prefix-groups warn'],
        );
    });
});

describe('expo router', () => {
    it('does not ask strict to flatten experiences/[id].tsx or about/index.tsx, whose address would change (Zaporeak)', () => {
        const files = [
            'src/app/(app)/experiences/[id].tsx',
            'src/app/(app)/blog/[...slug].tsx',
            'src/app/about/index.tsx',
            'src/components/card/index.tsx',
            'src/app/settings/profile.tsx',
        ];
        assert.deepEqual(
            checkAll(['react-native', 'strict'], files).map(finding => finding.folder),
            ['src/app/settings', 'src/components/card'],
        );
    });
});

describe('protobuf, elixir, scala and bazel', () => {
    const resources = ['user', 'order', 'cart', 'item', 'coupon', 'invoice', 'refund', 'ticket'];

    it('protobuf reads user_pb.ts, user_pb.d.ts, user_grpc_pb.js, user_pb2.py and user_grpc.pb.go as user', () => {
        const names = [
            'user_pb.ts',
            'user_pb.d.ts',
            'user_grpc_pb.js',
            'user_pb2.py',
            'user_pb2_grpc.py',
            'user_grpc.pb.go',
            'user_connect.ts',
            'user.pb.go',
        ];
        const view = explainFolder(
            { files: inFolder('src/api', names), config: resolvePreset('protobuf'), rules: BUILT_IN_RULES },
            'src/api',
        );
        assert.equal(view?.folder.modules.length, 1);
        const generated = resources.flatMap(name => [
            `${name}_pb.ts`,
            `${name}_pb.d.ts`,
            `${name}_grpc_pb.js`,
            `${name}_connect.ts`,
        ]);
        assert.deepEqual(check('protobuf', inFolder('src/api', generated)), []);
        assert.equal(check('recommended', inFolder('src/api', generated)).length, 1);
    });

    it('elixir reads user_controller.ex, user_html.ex and user_json.ex as one module (phx.gen.html)', () => {
        const files = resources.flatMap(name => [`${name}_controller.ex`, `${name}_html.ex`, `${name}_json.ex`]);
        assert.deepEqual(check('elixir', inFolder('lib/my_app_web/controllers', files)), []);
        assert.equal(check('recommended', inFolder('lib/my_app_web/controllers', files)).length, 1);
        assert.deepEqual(
            check(
                'elixir',
                inFolder(
                    'test/my_app_web/controllers',
                    resources.map(name => `${name}_controller_test.exs`),
                ),
            ),
            [],
        );
    });

    it('scala reads FooSpec, FooSuite and FooTest as Foo, and leaves out target and project/target', () => {
        const files = resources.flatMap(name => [
            `${name[0]?.toUpperCase()}${name.slice(1)}.scala`,
            `${name[0]?.toUpperCase()}${name.slice(1)}Spec.scala`,
            `${name[0]?.toUpperCase()}${name.slice(1)}Suite.scala`,
        ]);
        assert.deepEqual(check('scala', inFolder('src/test/scala', files)), []);
        assert.equal(check('recommended', inFolder('src/test/scala', files)).length, 1);
        const built = series('target/scala-3.3', 40, index => `Class${letters(index)}.class`);
        assert.deepEqual(
            check('scala', [...built, ...series('project/target', 40, index => `f${letters(index)}.class`)]),
            [],
        );
    });

    it('bazel warns that a new folder is a new package, and leaves out the bazel-* links', () => {
        const files = ['a_x', 'a_y', 'a_z', 'a_w', 'b'].map(name => `pkg/${name}.cc`);
        const [finding] = check('bazel', files);
        assert.match(finding?.message ?? '', /needs its own BUILD file and its own visibility/u);
        assert.deepEqual(
            check(
                'bazel',
                series('bazel-out/k8-fastbuild/bin', 40, index => `f${letters(index)}.o`),
            ),
            [],
        );
    });

    it('detects them by mix.exs, build.sbt, MODULE.bazel and .proto files', () => {
        const found = detectPresets(
            ['mix.exs', 'build.sbt', 'MODULE.bazel', 'proto/user.proto'],
            new Map(),
            BUILT_IN_PRESETS,
        );
        assert.deepEqual(
            found.map(detection => detection.preset),
            ['recommended', 'elixir', 'scala', 'bazel', 'protobuf'],
        );
    });
});

describe('protobuf applies to the whole repository', () => {
    it('proto/user.proto puts protobuf in the root extends: user_pb.ts and user_grpc_pb.ts live in src/', () => {
        const files = ['package.json', 'proto/user.proto', 'src/user_pb.ts', 'src/user_grpc_pb.ts'];
        const found = detectPresets(files, new Map(), BUILT_IN_PRESETS);
        const config = configFromDetections(found, files, BUILT_IN_PRESETS);
        assert.deepEqual(config.extends, ['recommended', 'protobuf']);
        assert.deepEqual(config.overrides, []);
    });
});

describe('detectPresets', () => {
    // A run with no configuration on 200 000 paths spent 40 % of its time here: every path was tried
    // against the globs of every preset, and asked whether recommended leaves its folder out.
    it('tries the globs of each preset on the files they can name: 200 000 paths in well under a second', () => {
        const kinds = ['ts', 'go', 'py', 'java', 'md', 'json', 'css', 'yaml'];
        const files = Array.from(
            { length: 200_000 },
            (_, index) =>
                `packages/p${index % 300}/src/m${index % 97}/file_${index}.${kinds[index % kinds.length] ?? ''}`,
        );
        files.push('packages/p3/go.mod', 'web/nuxt.config.ts', 'api/v1/api.proto', 'app/App.csproj', 'Cargo.toml');
        const started = performance.now();
        const found = detectPresets(files, new Map(), BUILT_IN_PRESETS);
        // 6.5 to 16 s before; 0.5 s after. The bound leaves room for a slow or busy CI machine.
        assert.ok(performance.now() - started < 4000, `${Math.round(performance.now() - started)} ms`);
        assert.deepEqual(
            found.map(detection => `${detection.preset} ← ${detection.evidence}`),
            [
                'recommended ← every repository',
                'nuxt ← web/nuxt.config.ts',
                'go ← packages/p3/go.mod',
                'rust ← Cargo.toml',
                'dotnet ← app/App.csproj',
                'protobuf ← api/v1/api.proto',
            ],
        );
    });

    it('proposes recommended always, and each preset from a file or a dependency', () => {
        const found = detectPresets(
            ['go.mod', 'web/angular.json', 'app/src/main/AndroidManifest.xml'],
            new Map([['react', ['package.json']]]),
            BUILT_IN_PRESETS,
        );
        assert.deepEqual(
            found.map(detection => `${detection.preset} ← ${detection.evidence}`),
            [
                'recommended ← every repository',
                'angular ← web/angular.json',
                'react ← the dependency react',
                'go ← go.mod',
                'android ← app/src/main/AndroidManifest.xml',
            ],
        );
    });

    it('does not take test data for the repository (sharkdp/bat, jgm/pandoc)', () => {
        const found = detectPresets(
            [
                'Cargo.toml',
                'tests/syntax-tests/highlighted/Go/go.mod',
                'tests/syntax-tests/highlighted/Terraform/main.tf',
                'tests/syntax-tests/highlighted/XML/console.csproj',
                'pandoc-lua-engine/test/lua/module/include.tex',
            ],
            new Map(),
            BUILT_IN_PRESETS,
        );
        assert.deepEqual(
            found.map(detection => detection.preset),
            ['recommended', 'rust'],
        );
    });

    it("does not take Flutter's generated platform folders for other languages (localsend/localsend)", () => {
        const found = detectPresets(
            [
                'app/android/app/build.gradle',
                'app/android/app/src/debug/AndroidManifest.xml',
                'app/ios/Runner.xcodeproj/project.pbxproj',
                'app/linux/CMakeLists.txt',
                'app/pubspec.yaml',
                'core/Cargo.toml',
            ],
            new Map(),
            BUILT_IN_PRESETS,
        );
        assert.deepEqual(
            found.map(detection => `${detection.preset} ← ${detection.evidence}`),
            ['recommended ← every repository', 'rust ← core/Cargo.toml', 'flutter ← app/pubspec.yaml'],
        );
    });

    it("leaves out Flutter's platform folders where the app is, not only at the root (localsend/localsend)", () => {
        const files = [
            'app/pubspec.yaml',
            'app/lib/main.dart',
            'app/android/app/src/main/kotlin/MainActivity.kt',
            'app/ios/Runner/AppDelegate.swift',
            'app/linux/CMakeLists.txt',
            'core/Cargo.toml',
        ];
        const found = detectPresets(files, new Map(), BUILT_IN_PRESETS);
        assert.deepEqual(
            excludesFor(found, files, BUILT_IN_PRESETS).toSorted((a, b) => a.localeCompare(b)),
            ['app/android', 'app/ios', 'app/linux'],
        );
    });

    it('does not propose a preset that another detected preset already extends (react with react-native)', () => {
        const found = detectPresets(
            [
                'apps/mobile/package.json',
                'apps/web/package.json',
                'apps/web/ios/notes.txt',
                'build.gradle',
                'app/src/main/AndroidManifest.xml',
            ],
            new Map([
                ['react', ['apps/web/package.json', 'apps/mobile/package.json']],
                ['react-native', ['apps/mobile/package.json']],
            ]),
            BUILT_IN_PRESETS,
        );
        // React stays for apps/web, where no react-native extends it; android takes java's root.
        assert.deepEqual(
            found.map(detection => [detection.preset, ...detection.folders]),
            [
                ['recommended', '.'],
                ['react', 'apps/web'],
                ['react-native', 'apps/mobile'],
                ['android', 'app/src/main', '.'],
            ],
        );
        assert.deepEqual(found[2]?.extended, [{ preset: 'react', folders: ['apps/mobile'] }]);
        assert.deepEqual(found[3]?.extended, [{ preset: 'java', folders: ['.'] }]);
    });

    it('writes one glob for sixty apps instead of sixty lines (apps/*/src/environments)', () => {
        const apps = Array.from({ length: 60 }, (_, index) => `apps/app-${String(index).padStart(2, '0')}`);
        const files = apps.flatMap(app => [`${app}/angular.json`, `${app}/src/environments/environment.ts`]);
        const found = detectPresets(files, new Map(), BUILT_IN_PRESETS);
        assert.deepEqual(excludesFor(found, files, BUILT_IN_PRESETS), ['apps/*/src/environments']);
        const two = files.filter(file => file.startsWith('apps/app-00/') || file.startsWith('apps/app-01/'));
        assert.deepEqual(excludesFor(detectPresets(two, new Map(), BUILT_IN_PRESETS), two, BUILT_IN_PRESETS), [
            'apps/app-00/src/environments',
            'apps/app-01/src/environments',
        ]);
    });

    it('reads where a dependency was declared: React Native in a package of a monorepo', () => {
        const files = [
            'package.json',
            'apps/mobile/package.json',
            'apps/mobile/ios/App/AppDelegate.mm',
            'apps/mobile/src/App.tsx',
        ];
        const found = detectPresets(
            files,
            new Map([
                ['react', ['package.json', 'apps/mobile/package.json']],
                ['react-native', ['apps/mobile/package.json']],
            ]),
            BUILT_IN_PRESETS,
        );
        // The root's react is react-native's too: it applies from the root, and its /ios is the app's.
        assert.deepEqual(found.find(detection => detection.preset === 'react-native')?.folders, ['apps/mobile', '.']);
        assert.deepEqual(excludesFor(found, files, BUILT_IN_PRESETS), ['apps/mobile/ios']);
    });

    // spring-boot's 11 958 files piped to --stdin with no configuration took 53 s: each of its Gradle
    // modules tried its /build and /target against every file of the repository.
    it('reads only the files of each folder it was found in: 400 Gradle modules in well under a second', () => {
        const files: string[] = [];
        for (let module = 0; module < 400; module++) {
            files.push(`modules/m${module}/build.gradle`);
            for (let file = 0; file < 30; file++) {
                files.push(`modules/m${module}/src/main/java/com/acme/Thing${file}.java`);
            }
        }
        // One module has what Gradle writes, next to its build.gradle; another a package called build.
        files.push('modules/m7/build/classes/Thing.class', 'modules/m8/src/main/java/com/acme/build/Steps.java');
        const found = detectPresets(files, new Map(), BUILT_IN_PRESETS);
        const started = performance.now();
        const excludes = excludesFor(found, files, BUILT_IN_PRESETS);
        // 13 s before; 0.1 s after. The bound leaves room for a slow CI machine.
        assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} ms`);
        assert.deepEqual(excludes, ['modules/m7/build']);
    });
});

describe('Lottie animations exported as JSON', () => {
    const animations = Array.from({ length: 25 }, (_, index) => `assets/animations/onboarding-step-${index}.json`);

    for (const preset of ['react-native', 'flutter']) {
        it(`${preset}: assets/animations/ of 25 .json Lottie files is not a crowded folder`, () => {
            const files = [...animations, ...animations.map(path => path.replace('animations', 'lottie'))];
            const crowded = check(preset, files).filter(finding => finding.rule === 'max-files');
            assert.deepEqual(
                crowded.map(finding => finding.folder),
                [],
            );
            const nested = check(
                preset,
                files.map(path => `app/${path}`),
            ).filter(finding => finding.rule === 'max-files');
            assert.deepEqual(
                nested.map(finding => finding.folder),
                [],
            );
        });
    }
});
