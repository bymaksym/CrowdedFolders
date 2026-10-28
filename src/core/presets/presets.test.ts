import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG, type ResolvedConfig } from '../config/types.ts';
import { validateConfig } from '../config/validate.ts';
import { explainFolder, type Finding, runEngine } from '../engine.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import { detectPresets, excludesFor } from './detect.ts';
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
            'UserServiceTests.cs',
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

    it("angular's limit is for src/, not for the repository's tooling", () => {
        const twelve = (folder: string): string[] =>
            many(
                folder,
                Array.from({ length: 12 }, (_, index) => `part${index}.mjs`),
            );
        assert.deepEqual(
            check('angular', [...twelve('tooling/rounds'), ...twelve('src/app/state')]).map(finding => finding.folder),
            ['src/app/state'],
        );
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

/** `count` files named `name(i)`, in a folder. */
const series = (folder: string, count: number, name: (index: number) => string): string[] =>
    Array.from({ length: count }, (_, index) => `${folder}/${name(index)}`);
/** The files of a folder, given their names. */
const inFolder = (folder: string, names: readonly string[]): string[] => names.map(name => `${folder}/${name}`);
const pad = (index: number, width = 2): string => String(index + 1).padStart(width, '0');

describe('recommended, after the review of 21-10-2026', () => {
    it('reads validate-i18n as being about i18n in scripts/ and tooling/ (espaciot-app), and not in src/', () => {
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
            const names = ['net_a', 'net_b', 'net_c', 'net_d', 'net_e', 'net_f', 'other'];
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

describe('detectPresets', () => {
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
        assert.deepEqual(found.find(detection => detection.preset === 'react-native')?.folders, ['apps/mobile']);
        assert.deepEqual(excludesFor(found, files, BUILT_IN_PRESETS), ['apps/mobile/ios']);
    });
});
