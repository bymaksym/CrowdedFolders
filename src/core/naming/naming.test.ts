import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileGlob } from '../paths/glob.ts';
import { groupModules, keyIn } from './groups.ts';
import { sameWord, singularsOf } from './inflect.ts';
import { isLanguageTag } from './languages.ts';
import {
    folderKeyOf,
    groupKeyOf,
    keyRestatesPath,
    modulesOf,
    type Naming,
    readFolder,
    sameTopics,
    shownName,
    stemOf,
    subjectOf,
} from './modules.ts';
import { isNumericWord, readName, splitWords } from './words.ts';

const plain: Naming = { companions: [], ignoreLeadingWords: new Set(), groupNumericPrefixes: false };

describe('splitWords', () => {
    it('reads every naming convention the same way', () => {
        for (const name of [
            'user-service',
            'user_service',
            'userService',
            'UserService',
            'USER_SERVICE',
            'user.service',
            'user service',
        ]) {
            assert.deepEqual(splitWords(name), ['user', 'service'], name);
        }
    });

    it('ends an acronym at the capital that starts the next word', () => {
        assert.deepEqual(splitWords('HTTPServer'), ['http', 'server']);
        assert.deepEqual(splitWords('parseXMLDocument'), ['parse', 'xml', 'document']);
        assert.deepEqual(splitWords('IUserService'), ['i', 'user', 'service']);
    });

    it('keeps digits with their letters, and a run of digits as its own word', () => {
        assert.deepEqual(splitWords('i18n-utils'), ['i18n', 'utils']);
        assert.deepEqual(splitWords('e1000_main'), ['e1000', 'main']);
        assert.deepEqual(splitWords('2024-01-01-post'), ['2024', '01', '01', 'post']);
        assert.deepEqual(splitWords('Vector3Int'), ['vector3', 'int']);
    });

    it('reads letters of any script, cased or not', () => {
        assert.deepEqual(splitWords('ПользовательСервис'), ['пользователь', 'сервис']);
        assert.deepEqual(splitWords('用户-服务'), ['用户', '服务']);
    });

    it('drops separators and symbols, and returns nothing for a name made of them', () => {
        assert.deepEqual(splitWords('+page'), ['page']);
        assert.deepEqual(splitWords('__init__'), ['init']);
        assert.deepEqual(splitWords('---'), []);
    });

    it('stays linear on a long name', () => {
        const name = `${'a'.repeat(50_000)}B${'c'.repeat(50_000)}`;
        const started = performance.now();
        assert.equal(splitWords(name).length, 2);
        assert.ok(performance.now() - started < 1000);
    });
});

describe('isNumericWord', () => {
    it('is true only for digits', () => {
        assert.equal(isNumericWord('0001'), true);
        assert.equal(isNumericWord('v1'), false);
        assert.equal(isNumericWord(''), false);
    });
});

describe('stemOf', () => {
    it('cuts at the first dot, so every companion extension joins the module', () => {
        for (const name of ['foo.ts', 'foo.spec.ts', 'foo.component.html', 'foo.d.ts', 'foo.stories.tsx']) {
            assert.equal(stemOf(name, plain), 'foo', name);
        }
        assert.equal(stemOf('Player.cs.meta', plain), 'Player');
    });

    it('keeps a dotfile its name, and trims the underscores of partials and dunders', () => {
        assert.equal(stemOf('.gitignore', plain), 'gitignore');
        assert.equal(stemOf('.eslintrc.json', plain), 'eslintrc');
        assert.equal(stemOf('_tokens.scss', plain), 'tokens');
        assert.equal(stemOf('__init__.py', plain), 'init');
    });

    it('removes companions until nothing changes, but never the whole name', () => {
        const go = { companions: [/_test$/u, /_(linux|windows)$/u, /_(amd64|arm64)$/u] };
        assert.equal(stemOf('x_linux_amd64_test.go', go), 'x');
        const python = { companions: [/^test_/u] };
        assert.equal(stemOf('test_parser.py', python), 'parser');
        assert.equal(stemOf('test_.py', python), 'test');
    });
});

describe('subjectOf and groupKeyOf', () => {
    it('skips ignored leading words, but always keeps one', () => {
        const naming = { ignoreLeadingWords: new Set(['i', 'bp']) };
        assert.deepEqual(subjectOf(['i', 'user', 'service'], naming), ['user', 'service']);
        assert.deepEqual(subjectOf(['bp'], naming), ['bp']);
    });

    it('groups by the first words of the subject, and not by a number unless asked', () => {
        const [module] = modulesOf(['0001_initial.py'], plain);
        assert.ok(module);
        assert.equal(groupKeyOf(module, 1, plain), undefined);
        assert.equal(groupKeyOf(module, 1, { ...plain, groupNumericPrefixes: true }), '0001');
        const [other] = modulesOf(['user-list-item.ts'], plain);
        assert.ok(other);
        assert.equal(groupKeyOf(other, 2, plain), 'user-list');
        assert.equal(groupKeyOf(other, 4, plain), undefined);
    });
});

describe('modulesOf', () => {
    it('joins companions into one module, case-insensitively, sorted by stem', () => {
        const modules = modulesOf(['b.ts', 'a.spec.ts', 'a.ts', 'README.md', 'Readme.txt'], plain);
        assert.deepEqual(
            modules.map(module => [module.stem, module.files]),
            [
                ['README', ['README.md', 'Readme.txt']],
                ['a', ['a.spec.ts', 'a.ts']],
                ['b', ['b.ts']],
            ],
        );
    });
});

describe('folder names', () => {
    it('reads a folder name the way keys are written', () => {
        assert.equal(folderKeyOf('RenderTargets'), 'render-targets');
    });

    it('tells a key that restates the folder, or a folder above it, allowing the plural', () => {
        assert.equal(keyRestatesPath('render', 'cli/render'), true);
        assert.equal(keyRestatesPath('hook', 'src/hooks'), true);
        assert.equal(keyRestatesPath('match', 'src/matches'), true);
        assert.equal(keyRestatesPath('users', 'src/user'), true);
        assert.equal(keyRestatesPath('drag', 'src/cdk/drag-drop'), true);
        assert.equal(keyRestatesPath('color', 'components/ColorPicker'), true);
        assert.equal(keyRestatesPath('toolbar', 'src/aria/toolbar/testing'), true);
        assert.equal(keyRestatesPath('list-item', 'ui/list-item-group'), true);
        assert.equal(keyRestatesPath('render', 'cli'), false);
        assert.equal(keyRestatesPath('render', '.'), false);
        assert.equal(keyRestatesPath('rend', 'src/render'), false);
    });
});

describe('splitWords: names the field reported misread', () => {
    it('keeps the plural s of an acronym with it: getURLs, userIDs, APIs (Tomás)', () => {
        assert.deepEqual(splitWords('getURLs'), ['get', 'urls']);
        assert.deepEqual(splitWords('userIDs'), ['user', 'ids']);
        assert.deepEqual(splitWords('APIs'), ['apis']);
        assert.deepEqual(splitWords('URLsForUser'), ['urls', 'for', 'user']);
        assert.deepEqual(splitWords('HTTPServer'), ['http', 'server']);
    });

    it('separates a capital before a word with digits: II18nKey is I, I18n, Key (Sofía)', () => {
        assert.deepEqual(splitWords('II18nKey'), ['i', 'i18n', 'key']);
        assert.deepEqual(splitWords('MI18nKey'), ['m', 'i18n', 'key']);
        assert.deepEqual(splitWords('MP3Player'), ['mp3', 'player']);
        assert.deepEqual(splitWords('SHA256Hash'), ['sha256', 'hash']);
    });

    it('reads OAuth, iOS, macOS and eBay as one word each (Tomás)', () => {
        assert.deepEqual(splitWords('OAuthClient'), ['oauth', 'client']);
        assert.deepEqual(splitWords('GoogleOAuthAPI'), ['google', 'oauth', 'api']);
        assert.deepEqual(splitWords('iOSApp'), ['ios', 'app']);
        assert.deepEqual(splitWords('getMacOSVersion'), ['get', 'macos', 'version']);
        assert.deepEqual(splitWords('eBayClient'), ['ebay', 'client']);
        assert.deepEqual(splitWords('OAUTH_TOKEN'), ['oauth', 'token']);
    });

    it('keeps a version whole', () => {
        assert.deepEqual(splitWords('v1.25.1'), ['v1.25.1']);
        assert.deepEqual(splitWords('db.changelog-1.3'), ['db', 'changelog', '1.3']);
        assert.equal(isNumericWord('1.3'), true);
    });

    it('reads Unicode the same way whatever its normalisation (Irina)', () => {
        assert.deepEqual(splitWords('diseño-d'), ['diseño', 'd']);
        assert.deepEqual(splitWords('diseño-a'), ['diseño', 'a']);
        assert.deepEqual(splitWords('İstanbul'), ['istanbul']);
        assert.deepEqual(splitWords('हिन्दी-पाठ'), ['हिन्दी', 'पाठ']);
        assert.deepEqual(splitWords('١٢٣-post'), ['١٢٣', 'post']);
        assert.equal(isNumericWord('١٢٣'), true);
    });

    it('tells a type letter glued to a capitalised word: IProfile, MProfile, TProps (conversations of 13-10)', () => {
        for (const name of ['IProfile', 'MProfile', 'TProps', 'II18nKey', 'UObject']) {
            assert.equal(readName(name).typePrefix, true, name);
        }
        for (const name of ['ABTest', 'X', 'I_Profile', 'Item', 'OAuthClient', 'APIs']) {
            assert.equal(readName(name).typePrefix, false, name);
        }
    });

    it('says where each word is', () => {
        assert.deepEqual(readName('RenderJson.cs').spans, [
            [0, 6],
            [6, 10],
            [11, 13],
        ]);
    });
});

describe('stemOf: dots that are part of the name', () => {
    it('keeps versions, so each release is a module (docs/releases, Liquibase)', () => {
        assert.equal(stemOf('v1.25.1.md', plain), 'v1.25.1');
        assert.equal(stemOf('v1.0.0.md', plain), 'v1.0.0');
        assert.equal(stemOf('db.changelog-1.3.xml', plain), 'db.changelog-1.3');
        assert.equal(stemOf('app.2024.log', plain), 'app.2024');
        assert.equal(stemOf('ls.1', plain), 'ls.1');
        assert.equal(stemOf('archive.7z', plain), 'archive');
        assert.equal(stemOf('foo.spec.ts', plain), 'foo');
    });

    it('takes a reverse package name whole (META-INF/services, Elixir .beam files)', () => {
        assert.equal(stemOf('org.example.Service', plain), 'org.example.Service');
        assert.equal(stemOf('Elixir.X.M1.beam', plain), 'Elixir.X.M1');
        const modules = modulesOf(['org.example.Service', 'org.example.Codec', 'com.acme.Plugin'], plain);
        assert.equal(modules.length, 3);
        assert.deepEqual(
            modules.map(module => module.subject),
            [[], [], []],
        );
    });

    it('reads Expo Router names (Lucía)', () => {
        assert.equal(stemOf('[...slug].tsx', plain), '[...slug]');
        assert.equal(stemOf('[[...slug]].tsx', plain), '[[...slug]]');
        assert.deepEqual(splitWords(stemOf('[...slug].tsx', plain)), ['slug']);
        assert.deepEqual(splitWords(stemOf('[id].tsx', plain)), ['id']);
        assert.equal(stemOf('broken[.tsx', plain), 'broken[');
    });
});

describe('the inflector', () => {
    it('reads singular and plural as one word (Tomás)', () => {
        for (const [plural, singular] of [
            ['categories', 'category'],
            ['classes', 'class'],
            ['statuses', 'status'],
            ['children', 'child'],
            ['matches', 'match'],
            ['caches', 'cache'],
            ['users', 'user'],
            ['people', 'person'],
        ] as const) {
            assert.equal(sameWord(plural, singular), true, plural);
            assert.ok(singularsOf(plural).includes(singular), plural);
        }
    });

    it('does not join words that only look like a plural', () => {
        for (const [a, b] of [
            ['news', 'new'],
            ['is', 'i'],
            ['ios', 'io'],
            ['notes', 'not'],
            ['https', 'http'],
        ] as const) {
            assert.equal(sameWord(a, b), false, a);
        }
    });

    it('lets a key restate a plural folder: categories/category-list.ts', () => {
        assert.equal(keyRestatesPath('category', 'src/categories'), true);
        assert.equal(keyRestatesPath('child', 'ui/children'), true);
        assert.equal(keyRestatesPath('new', 'src/news'), false);
    });
});

describe('language tags', () => {
    it('accepts the three-letter codes of CLDR and UN M.49 regions: app_fil.arb, app_ckb.arb, strings_es-419', () => {
        assert.equal(isLanguageTag(['fil']), true);
        assert.equal(isLanguageTag(['ckb']), true);
        assert.equal(isLanguageTag(['es', '419']), true);
        assert.equal(isLanguageTag(['map']), false);
        assert.equal(isLanguageTag(['es', 'abc']), false);
    });
});

describe('modules: case, Unicode and what is not counted', () => {
    it('joins spellings of one stem, but not two files whose names differ only in case (Irina)', () => {
        const modules = modulesOf(['Foo.ts', 'foo.ts', 'FOO.md'], plain);
        assert.deepEqual(
            modules.map(module => [module.stem, module.files]),
            [
                ['FOO', ['FOO.md', 'Foo.ts']],
                ['foo', ['foo.ts']],
            ],
        );
        const nfd = modulesOf(['diseño-a.ts', 'diseño-a.md'], plain);
        assert.equal(nfd.length, 1);
    });

    it('takes the stem most files use', () => {
        const [module] = modulesOf(['user.ts', 'User.html', 'User.scss'], plain);
        assert.equal(module?.stem, 'User');
    });

    it('leaves out the files that describe the folder, and the companions of sibling folders (Kenji, Lucía)', () => {
        const naming: Naming = {
            ...plain,
            folderFiles: [compileGlob('package-info.java')],
            folderCompanions: ['.meta'],
        };
        const read = readFolder(['package-info.java', 'User.java', 'Scripts.meta', 'Other.meta'], naming, ['Scripts']);
        assert.deepEqual(
            read.modules.map(module => module.stem),
            ['Other', 'User'],
        );
        assert.deepEqual(
            read.uncounted.map(entry => entry.file),
            ['package-info.java', 'Scripts.meta'],
        );
        assert.match(read.uncounted[1]?.reason ?? '', /goes with the folder Scripts\//u);
    });

    it('skips the type letter when reading the subject', () => {
        const [module] = modulesOf(['II18nKey.ts'], plain);
        assert.deepEqual(module?.subject, ['i18n', 'key']);
    });

    it('shows the real first file when no file is called like the stem: IUserRepository.cs (Kenji)', () => {
        const dotnet: Naming = { ...plain, companions: [/^I(?=[A-Z])/u] };
        const [alone] = modulesOf(['IUserRepository.cs'], dotnet);
        assert.ok(alone);
        assert.equal(shownName(alone), 'IUserRepository.cs');
        const [both] = modulesOf(['IUserRepository.cs', 'UserRepository.cs'], dotnet);
        assert.ok(both);
        assert.equal(shownName(both), 'UserRepository');
    });

    it('finds two modules about the same subject, and the companion that would join them: IProfile, MProfile', () => {
        const [topic, ...rest] = sameTopics(modulesOf(['IProfile.ts', 'MProfile.ts', 'Other.ts'], plain));
        assert.equal(rest.length, 0);
        assert.equal(topic?.subject, 'profile');
        const companion = new RegExp(topic?.companion ?? '', 'u');
        assert.equal(modulesOf(['IProfile.ts', 'MProfile.ts'], { ...plain, companions: [companion] }).length, 1);
    });
});

describe('groupModules', () => {
    it('puts singular and plural in one group: UsersController with UserGroups, UserRoles, UserSettings (Kenji)', () => {
        const modules = modulesOf(['UsersController.cs', 'UserGroups.cs', 'UserRoles.cs', 'UserSettings.cs'], plain);
        const groups = groupModules(modules, 1, 4, plain);
        assert.deepEqual([...groups.keys()], ['user']);
        assert.equal(groups.get('user')?.length, 4);
    });

    it('with words "auto", takes the longest prefix that keeps the group (laboral-time-server)', () => {
        const names = [
            ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(letter => `RegistroHorario${letter}.java`),
            'RegistroUsuarioConRol.java',
            'Main.java',
        ];
        const groups = groupModules(modulesOf(names, plain), 'auto', 4, plain);
        assert.equal(groups.get('registro-horario')?.length, 8);
        // Split evenly, the shorter key is the folder.
        const even = ['user-list-a', 'user-list-b', 'user-card-a', 'user-card-b'].map(name => `${name}.ts`);
        assert.deepEqual([...groupModules(modulesOf(even, plain), 'auto', 2, plain).keys()], ['user']);
    });

    it('tells a key from a list of keys with the plural', () => {
        assert.equal(keyIn('tests', ['test']), true);
        assert.equal(keyIn('render-json', ['render']), false);
    });
});
