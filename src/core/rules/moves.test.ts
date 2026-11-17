/**
 * What `--moves` proposes: each case is a move that broke a project, or that named a folder the
 * language cannot use, with the names that showed it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG, type ResolvedConfig } from '../config/types.ts';
import { type Finding, runEngine } from '../engine.ts';
import { BUILT_IN_PRESETS } from '../presets/index.ts';
import { BUILT_IN_RULES } from './index.ts';
import { writeCase } from './moves.ts';

function resolve(names: readonly string[], own?: Config): ResolvedConfig {
    const applied = new Set<string>();
    const apply = (name: string, base: ResolvedConfig): ResolvedConfig => {
        if (applied.has(name)) {
            return base;
        }
        applied.add(name);
        const preset = BUILT_IN_PRESETS[name];
        assert.ok(preset, name);
        let config = base;
        for (const parent of preset.config.extends ?? []) {
            config = apply(parent, config);
        }
        return mergeLayer(config, preset.config, name, false);
    };
    const presets = names.reduce((config, name) => apply(name, config), EMPTY_CONFIG);
    return own ? mergeLayer(presets, own, 'test', true) : presets;
}

function check(presets: readonly string[], files: readonly string[], own?: Config, only?: string[]): Finding[] {
    return [
        ...runEngine({ files, config: resolve(presets, own), rules: BUILT_IN_RULES, ...(only && { only }) }).findings,
    ];
}

/** Where each file of the prefix-groups findings goes. */
function moved(findings: readonly Finding[]): Record<string, string> {
    return Object.fromEntries(
        findings
            .filter(finding => finding.rule === 'prefix-groups')
            .flatMap(finding => finding.moves.map(move => [move.from, move.to])),
    );
}

describe('the destination of a move', () => {
    it('drops the prefix the new folder says (validate-i18n.mjs → validate/i18n.mjs), as redundant-prefix would ask', () => {
        const files = [
            'tools/validate-i18n.mjs',
            'tools/validate-links.mjs',
            'tools/validate-env.mjs',
            'tools/validate-schema.mjs',
            'tools/run.mjs',
        ];
        const moves = moved(check(['recommended'], files));
        assert.equal(moves['tools/validate-i18n.mjs'], 'tools/validate/i18n.mjs');
        assert.equal(moves['tools/validate-schema.mjs'], 'tools/validate/schema.mjs');
    });

    it('moves a companion with its module, renamed the same way (render-json.spec.ts, test_render_json.py)', () => {
        const ts = moved(
            check(
                ['recommended'],
                [
                    'cli/render-json.ts',
                    'cli/render-json.spec.ts',
                    'cli/render-text.ts',
                    'cli/render-sarif.ts',
                    'cli/render-pr.ts',
                    'cli/main.ts',
                ],
            ),
        );
        assert.equal(ts['cli/render-json.spec.ts'], 'cli/render/json.spec.ts');
        const py = moved(
            check(
                ['python'],
                [
                    'app/render_json.py',
                    'app/test_render_json.py',
                    'app/render_text.py',
                    'app/render_sarif.py',
                    'app/render_pr.py',
                    'app/main.py',
                ],
            ),
        );
        assert.equal(py['app/render_json.py'], 'app/render/json.py');
        assert.equal(py['app/test_render_json.py'], 'app/render/test_json.py');
    });

    it('keeps the names where a file is named after the type it holds (dropPrefix: false in java, dotnet)', () => {
        const files = [
            'core/UserService.java',
            'core/UserRepository.java',
            'core/UserController.java',
            'core/UserMapper.java',
            'core/Order.java',
        ];
        assert.equal(moved(check(['java'], files))['core/UserService.java'], 'core/user/UserService.java');
    });

    it('says when a kept name is one redundant-prefix would flag, and how to choose (Ideas Crowded Folders, 4)', () => {
        const files = [
            'core/UserService.java',
            'core/UserRepository.java',
            'core/UserController.java',
            'core/UserMapper.java',
            'core/Order.java',
        ];
        const findings = check(['java'], files, { rules: { 'redundant-prefix': 'error' } });
        const finding = findings.find(found => found.rule === 'prefix-groups');
        assert.equal(moved(findings)['core/UserService.java'], 'core/user/UserService.java');
        assert.match(
            finding?.message ?? '',
            /redundant-prefix, on here, would then ask to drop it: set dropPrefix: true/u,
        );
        // Without redundant-prefix on, there is nothing to choose between.
        assert.doesNotMatch(check(['java'], files)[0]?.message ?? '', /redundant-prefix/u);
    });

    it('moves into the folder that already exists, and says so (src/render/index.ts)', () => {
        const files = [
            'src/render-json.ts',
            'src/render-text.ts',
            'src/render-sarif.ts',
            'src/render-pr.ts',
            'src/main.ts',
            'src/render/index.ts',
        ];
        const [finding] = check(['recommended'], files);
        assert.match(finding?.message ?? '', /move them into the src\/render\/ that already exists\.$/u);
        assert.doesNotMatch(finding?.message ?? '', /never made/u);
        assert.equal(moved([finding!])['src/render-pr.ts'], 'src/render/pr.ts');
    });

    it('never lands on a file that exists, nor on one that differs only in case (json.ts, Text.ts)', () => {
        const files = [
            'src/render-json.ts',
            'src/render-text.ts',
            'src/render-sarif.ts',
            'src/render-pr.ts',
            'src/main.ts',
            'src/render/json.ts',
            'src/render/Text.ts',
        ];
        const [finding] = check(['recommended'], files);
        const moves = moved([finding!]);
        assert.equal(moves['src/render-json.ts'], 'src/render/render-json.ts');
        assert.equal(moves['src/render-text.ts'], 'src/render/render-text.ts');
        assert.match(
            finding?.message ?? '',
            /src\/render-json\.ts keeps its name: src\/render\/json\.ts is already there\./u,
        );
        assert.match(finding?.message ?? '', /src\/render\/Text\.ts is already there, and differs only in case/u);
    });

    it('leaves a module where it is when every name it could take is taken', () => {
        const files = [
            'src/render-json.ts',
            'src/render-text.ts',
            'src/render-sarif.ts',
            'src/render-pr.ts',
            'src/render/json.ts',
            'src/render/render-json.ts',
            'src/main.ts',
        ];
        const [finding] = check(['recommended'], files);
        assert.equal(moved([finding!])['src/render-json.ts'], undefined);
        assert.match(
            finding?.message ?? '',
            /src\/render-json\.ts stays where it is: src\/render\/json\.ts is already there; src\/render\/render-json\.ts is already there\./u,
        );
    });

    it('lets redundant-prefix rename only onto a free name', () => {
        const files = ['render/render-json.ts', 'render/render-text.ts', 'render/json.ts'];
        const finding = check(['strict'], files).find(found => found.rule === 'redundant-prefix');
        assert.deepEqual(finding?.moves, [{ from: 'render/render-text.ts', to: 'render/text.ts' }]);
        assert.match(
            finding?.message ?? '',
            /render\/render-json\.ts keeps its name: render\/json\.ts is already there/u,
        );
    });
});

describe('moves that would break the project', () => {
    it('moves Expo Router screens into a route group with their names: /sign-in stays /sign-in', () => {
        const files = [
            'src/app/_layout.tsx',
            'src/app/index.tsx',
            'src/app/sign-in.tsx',
            'src/app/sign-up.tsx',
            'src/app/sign-out.tsx',
            'src/app/sign-up-done.tsx',
        ];
        const findings = check(['react-native'], files);
        const moves = moved(findings);
        assert.equal(moves['src/app/sign-in.tsx'], 'src/app/(sign)/sign-in.tsx');
        assert.equal(moves['src/app/sign-up-done.tsx'], 'src/app/(sign)/sign-up-done.tsx');
        assert.match(findings[0]?.message ?? '', /src\/app\/\(sign\)\//u);
    });

    it('moves into the route group that exists, and never shortens a route under it', () => {
        const files = [
            'app/(sign)/sign-in.tsx',
            'app/(sign)/sign-up.tsx',
            'app/sign-out.tsx',
            'app/sign-up-done.tsx',
            'app/sign-again.tsx',
            'app/sign-help.tsx',
            'app/index.tsx',
        ];
        const findings = check(['react-native', 'strict'], files);
        assert.equal(moved(findings)['app/sign-out.tsx'], 'app/(sign)/sign-out.tsx');
        assert.deepEqual(
            findings.filter(finding => finding.rule === 'redundant-prefix'),
            [],
        );
    });

    it('leaves render.rs beside render/ in Rust: render_json.rs → render/json.rs', () => {
        const files = [
            'src/render.rs',
            'src/render_json.rs',
            'src/render_text.rs',
            'src/render_sarif.rs',
            'src/main.rs',
        ];
        const [finding] = check(['rust'], files);
        const moves = moved([finding!]);
        assert.equal(moves['src/render.rs'], undefined);
        assert.equal(moves['src/render_json.rs'], 'src/render/json.rs');
        assert.match(finding?.message ?? '', /render\.rs stays beside it/u);
    });

    it("never moves Spring's profiles (application-dev.yml, -prod, -test)", () => {
        const files = [
            'src/main/resources/application.yml',
            'src/main/resources/application-dev.yml',
            'src/main/resources/application-prod.yml',
            'src/main/resources/application-test.yml',
            'src/main/resources/logback.xml',
        ];
        assert.deepEqual(check(['java'], files), []);
    });

    it('never moves Django commands: manage.py import_users names the file', () => {
        const files = [
            'shop/management/commands/import_users.py',
            'shop/management/commands/import_orders.py',
            'shop/management/commands/import_products.py',
            'shop/management/commands/import_stock.py',
            'shop/management/commands/export_all.py',
        ];
        assert.deepEqual(check(['django'], files), []);
    });

    it('never moves the Flutter entry points that flutter run -t names (main_dev.dart)', () => {
        const files = [
            'lib/main.dart',
            'lib/main_dev.dart',
            'lib/main_prod.dart',
            'lib/main_staging.dart',
            'lib/app.dart',
        ];
        assert.deepEqual(check(['flutter'], files), []);
    });

    it('never moves patch-package patches: it reads patches/ flat', () => {
        const files = [
            'patches/react-native+0.72.4.patch',
            'patches/react-native-screens+3.29.0.patch',
            'patches/react-native-svg+14.1.0.patch',
            'patches/react-native-reanimated+3.6.1.patch',
            'package.json',
        ];
        assert.deepEqual(check(['recommended'], files), []);
    });
});

describe('the folder name of a move', () => {
    it('is never a reserved word: AbstractHandler → abstracts/ in Java', () => {
        const files = [
            'core/AbstractHandler.java',
            'core/AbstractValidator.java',
            'core/AbstractService.java',
            'core/AbstractRepository.java',
            'core/Order.java',
        ];
        // java skips "abstract" in front of a name; without that, the group is "abstract".
        const findings = check(['java'], files, { naming: { ignoreLeadingWords: ['!abstract'] } });
        assert.equal(moved(findings)['core/AbstractHandler.java'], 'core/abstracts/AbstractHandler.java');
        assert.match(findings[0]?.message ?? '', /core\/abstracts\/ \("abstract" is a reserved word\)/u);
    });

    it('is never a Python keyword: async_* → asyncs/, import_* → imports/', () => {
        const asyncs = [
            'utils/async_io.py',
            'utils/async_pool.py',
            'utils/async_queue.py',
            'utils/async_retry.py',
            'utils/strings.py',
        ];
        assert.equal(moved(check(['python'], asyncs))['utils/async_io.py'], 'utils/asyncs/io.py');
        const imports = [
            'jobs/import_users.py',
            'jobs/import_orders.py',
            'jobs/import_products.py',
            'jobs/import_stock.py',
            'jobs/run.py',
        ];
        assert.equal(moved(check(['python'], imports))['jobs/import_users.py'], 'jobs/imports/users.py');
    });

    it('proposes no folder when the plural is reserved too, and says to name it', () => {
        const files = ['x/dot-a.ts', 'x/dot-b.ts', 'x/dot-c.ts', 'x/dot-d.ts', 'x/other.ts'];
        const [finding] = check(['recommended'], files, { naming: { reservedWords: ['dot', 'dots'] } });
        assert.deepEqual(finding?.moves, []);
        assert.match(finding?.message ?? '', /reserved words in this language — name the folder yourself/u);
    });

    it('follows folderCase: PascalCase in dotnet and php, lowercase in java and go, snake_case in python and rust', () => {
        const dotnet = [
            'Data/UserRoleConfiguration.cs',
            'Data/UserRoleClaim.cs',
            'Data/UserRoleMap.cs',
            'Data/UserRoleSeed.cs',
            'Data/Order.cs',
        ];
        const auto = { rules: { 'prefix-groups': ['error', { words: 'auto' }] } } satisfies Config;
        assert.equal(moved(check(['dotnet'], dotnet, auto))['Data/UserRoleMap.cs'], 'Data/UserRole/UserRoleMap.cs');
        const go = [
            'server/http_server.go',
            'server/http_server_client.go',
            'server/http_server_pool.go',
            'server/http_server_tls.go',
            'server/main.go',
        ];
        assert.equal(moved(check(['go'], go, auto))['server/http_server_pool.go'], 'server/httpserver/pool.go');
        const rust = [
            'src/user_role.rs',
            'src/user_role_claim.rs',
            'src/user_role_map.rs',
            'src/user_role_seed.rs',
            'src/main.rs',
        ];
        assert.equal(moved(check(['rust'], rust, auto))['src/user_role_map.rs'], 'src/user_role/map.rs');
        assert.deepEqual(
            (['kebab', 'snake', 'camel', 'pascal', 'lower'] as const).map(folderCase =>
                writeCase(['user', 'list'], folderCase),
            ),
            ['user-list', 'user_list', 'userList', 'UserList', 'userlist'],
        );
    });
});

describe('mirrors', () => {
    const main = ['UserService', 'UserRepository', 'UserController', 'UserMapper', 'Order'].map(
        name => `src/main/java/com/a/core/${name}.java`,
    );
    const test = ['UserService', 'UserRepository', 'UserController', 'UserMapper', 'Order'].map(
        name => `src/test/java/com/a/core/${name}Test.java`,
    );

    it('reports a group of src/main/java and src/test/java once, and moves both trees', () => {
        const findings = check(['java'], [...main, ...test]).filter(finding => finding.rule === 'prefix-groups');
        assert.deepEqual(
            findings.map(finding => finding.folder),
            ['src/main/java/com/a/core'],
        );
        const moves = moved(findings);
        assert.equal(
            moves['src/main/java/com/a/core/UserService.java'],
            'src/main/java/com/a/core/user/UserService.java',
        );
        assert.equal(
            moves['src/test/java/com/a/core/UserServiceTest.java'],
            'src/test/java/com/a/core/user/UserServiceTest.java',
        );
        assert.equal(moves['src/test/java/com/a/core/OrderTest.java'], undefined);
        assert.match(findings[0]?.message ?? '', /Its mirror src\/test\/java\/com\/a\/core\/ goes with it\./u);
    });

    it('folds the same way when only one of the trees is checked', () => {
        const files = [...main, ...test];
        assert.deepEqual(check(['java'], files, undefined, ['src/test/java']), []);
        const [finding] = check(['java'], files, undefined, ['src/main/java']);
        assert.equal(
            moved([finding!])['src/test/java/com/a/core/UserMapperTest.java'],
            'src/test/java/com/a/core/user/UserMapperTest.java',
        );
    });

    it('reports a folder over max-files once when its mirror is over too', () => {
        const many = (root: string, suffix: string): string[] =>
            Array.from(
                { length: 22 },
                (_, index) => `${root}/com/a/Thing${String.fromCodePoint(65 + index)}x${suffix}.java`,
            );
        const findings = check(['java'], [...many('src/main/java', ''), ...many('src/test/java', 'Test')]);
        assert.deepEqual(
            findings.filter(finding => finding.rule === 'max-files').map(finding => finding.folder),
            ['src/main/java/com/a'],
        );
    });

    it('takes the __tests__ of a folder along: render-json.test.ts goes to render/__tests__/json.test.ts', () => {
        const files = [
            'cli/render-json.ts',
            'cli/render-text.ts',
            'cli/render-sarif.ts',
            'cli/render-pr.ts',
            'cli/main.ts',
            'cli/__tests__/render-json.test.ts',
            'cli/__tests__/main.test.ts',
        ];
        const moves = moved(check(['recommended'], files));
        assert.equal(moves['cli/__tests__/render-json.test.ts'], 'cli/render/__tests__/json.test.ts');
        assert.equal(moves['cli/__tests__/main.test.ts'], undefined);
    });

    it('reads Rails spec/ and Elixir test/ as mirrors of app/ and lib/', () => {
        const rails = [
            'app/models/user_role.rb',
            'app/models/user_token.rb',
            'app/models/user_claim.rb',
            'app/models/user_seed.rb',
            'app/models/order.rb',
            'spec/models/user_role_spec.rb',
            'spec/models/user_token_spec.rb',
            'spec/models/user_claim_spec.rb',
            'spec/models/user_seed_spec.rb',
        ];
        const found = check(['rails'], rails).filter(finding => finding.rule === 'prefix-groups');
        assert.deepEqual(
            found.map(finding => finding.folder),
            ['app/models'],
        );
        assert.equal(moved(found)['spec/models/user_role_spec.rb'], 'spec/models/user/role_spec.rb');
        const elixir = [
            'lib/shop/user_role.ex',
            'lib/shop/user_token.ex',
            'lib/shop/user_claim.ex',
            'lib/shop/user_seed.ex',
            'lib/shop/order.ex',
            'test/shop/user_role_test.exs',
            'test/shop/user_token_test.exs',
            'test/shop/user_claim_test.exs',
            'test/shop/user_seed_test.exs',
        ];
        const ex = check(['elixir'], elixir).filter(finding => finding.rule === 'prefix-groups');
        assert.deepEqual(
            ex.map(finding => finding.folder),
            ['lib/shop'],
        );
        assert.equal(moved(ex)['test/shop/user_role_test.exs'], 'test/shop/user/role_test.exs');
    });
});
