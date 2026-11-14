/**
 * How the presets read names: the companions, the files that are not counted, and the false
 * positives they caused in real repositories, each with the names that caused it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { EMPTY_CONFIG, type ResolvedConfig } from '../config/types.ts';
import { explainFolder, type Finding, runEngine } from '../engine.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import { BUILT_IN_PRESETS } from './index.ts';

function resolve(names: readonly string[]): ResolvedConfig {
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
    return names.reduce((config, name) => apply(name, config), EMPTY_CONFIG);
}

function check(presets: readonly string[], files: readonly string[]): Finding[] {
    return [...runEngine({ files, config: resolve(presets), rules: BUILT_IN_RULES }).findings];
}

function stems(presets: readonly string[], files: readonly string[], folder: string): string[] {
    const explanation = explainFolder({ files, config: resolve(presets), rules: BUILT_IN_RULES }, folder);
    return explanation?.folder.modules.map(module => module.stem) ?? [];
}

const named = (folder: string, names: readonly string[]): string[] => names.map(name => `${folder}/${name}`);

describe('presets: how names are read', () => {
    it('java: UserServiceImpl is UserService; package-info.java and module-info.java do not count (Kenji)', () => {
        const folder = 'src/main/java/com/acme/user';
        const files = named(folder, [
            'UserService.java',
            'UserServiceImpl.java',
            'package-info.java',
            'module-info.java',
        ]);
        assert.deepEqual(stems(['java'], files, folder), ['UserService']);
        const twenty = named(folder, [
            ...Array.from({ length: 20 }, (_, index) => `Class${String.fromCodePoint(65 + index)}.java`),
            'package-info.java',
        ]);
        assert.deepEqual(check(['java'], twenty), []);
    });

    it('java: Test and IT join their class only in test sources', () => {
        const main = 'src/main/java/x';
        assert.deepEqual(stems(['java'], named(main, ['Audit.java', 'AuditIT.java']), main), ['Audit', 'AuditIT']);
        const test = 'src/test/java/x';
        assert.deepEqual(stems(['java'], named(test, ['UserServiceTest.java', 'UserServiceIT.java']), test), [
            'UserService',
        ]);
    });

    it('java and android: feature/dayplan/ is not asked for a folder day/ (waypack)', () => {
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
        assert.deepEqual(check(['recommended', 'java', 'android'], files), []);
    });

    it('swift: SpeedTest.swift and ABTest.swift are types of their own outside test targets (Lucía)', () => {
        const sources = 'Sources/App';
        assert.deepEqual(
            stems(['swift'], named(sources, ['Speed.swift', 'SpeedTest.swift', 'AB.swift', 'ABTest.swift']), sources),
            ['AB', 'ABTest', 'Speed', 'SpeedTest'],
        );
        const tests = 'Tests/AppTests';
        assert.deepEqual(stems(['swift'], named(tests, ['Speed.swift', 'SpeedTests.swift']), tests), ['Speed']);
    });

    it('dotnet: SpeedTest.cs is a class outside test projects', () => {
        const folder = 'src/Net';
        assert.deepEqual(stems(['dotnet'], named(folder, ['Speed.cs', 'SpeedTest.cs']), folder), [
            'Speed',
            'SpeedTest',
        ]);
        const tests = 'tests/Net.Tests';
        assert.deepEqual(stems(['dotnet'], named(tests, ['Speed.cs', 'SpeedTests.cs']), tests), ['Speed']);
    });

    it('unity: Base64.cs, Sha256.cs and Md5.cs are not Base, Sha and Md; Model_1 and Model_2 are one (Lucía)', () => {
        const folder = 'Assets/Scripts';
        const files = named(folder, ['Base64.cs', 'Base.cs', 'Sha256.cs', 'Md5.cs', 'Model_1.fbx', 'Model_2.fbx']);
        assert.deepEqual(stems(['unity'], files, folder), ['Base', 'Base64', 'Md5', 'Model', 'Sha256']);
        // Wherever scripts live, not only in Scripts/: Assets/Code, the Runtime/ of an embedded package.
        for (const code of ['Assets/Code', 'Packages/com.acme.net/Runtime']) {
            assert.deepEqual(stems(['unity'], named(code, ['Base64.cs', 'Base.cs', 'Sha256.cs', 'Sha.cs']), code), [
                'Base',
                'Base64',
                'Sha',
                'Sha256',
            ]);
        }
        // Outside the folders of scripts a number is a copy of an asset (UnityTechnologies/open-project-1 Prefabs/Food).
        const food = 'Assets/Prefabs/Food';
        assert.deepEqual(stems(['unity'], named(food, ['Almond.prefab', 'Almond2.prefab', 'Lemon_03.prefab']), food), [
            'Almond',
            'Lemon',
        ]);
    });

    it('unity: the .meta of a folder goes with the folder — Assets/Scripts.meta (Lucía)', () => {
        const folders = Array.from({ length: 32 }, (_, index) => `Folder${index}`);
        const files = [
            ...folders.map(name => `Assets/${name}/Thing.cs`),
            ...folders.map(name => `Assets/${name}.meta`),
            'Assets/Scripts/Player.cs',
            'Assets/Scripts.meta',
        ];
        assert.deepEqual(check(['unity'], files), []);
        const explanation = explainFolder({ files, config: resolve(['unity']), rules: BUILT_IN_RULES }, 'Assets');
        assert.equal(explanation?.folder.modules.length, 0);
        assert.equal(explanation?.folder.uncounted?.length, 33);
    });

    it('react-native: Expo Router names are read, and the files of the folder itself do not count (Lucía)', () => {
        const folder = 'src/app';
        const files = named(folder, [
            '[...slug].tsx',
            '[[...rest]].tsx',
            '[id].tsx',
            '+not-found.tsx',
            '+html.tsx',
            '+native-intent.tsx',
            '_layout.tsx',
            'index.tsx',
        ]);
        assert.deepEqual(stems(['react-native'], files, folder), ['[...slug]', '[[...rest]]', '[id]', 'index']);
    });

    it('python, go and rust: __init__.py, doc.go and mod.rs do not count (Kenji)', () => {
        assert.deepEqual(stems(['python'], ['pkg/__init__.py', 'pkg/parser.py'], 'pkg'), ['parser']);
        assert.deepEqual(stems(['go'], ['pkg/doc.go', 'pkg/server.go'], 'pkg'), ['server']);
        assert.deepEqual(stems(['rust'], ['src/net/mod.rs', 'src/net/tcp.rs'], 'src/net'), ['tcp']);
    });
});
