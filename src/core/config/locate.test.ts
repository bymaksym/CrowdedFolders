import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripJsonc } from './jsonc.ts';
import { offsetOfPath, positionOf, syntaxErrorOffset } from './locate.ts';

const TEXT = `{
    // why
    "extends": ["recommended", "react"],
    "overrides": [
        { "folders": ["a"], "reason": "x" },
        { "folders": ["src/**", /* two */ "lib"], "rules": { "max-files": ["warn", { "max": 3, }] } },
    ],
}`;

function place(at: string): string | undefined {
    const offset = offsetOfPath(TEXT, at);
    if (offset === undefined) {
        return undefined;
    }
    const { line, column } = positionOf(TEXT, offset);
    return `${line}:${column}`;
}

describe('where a setting is written', () => {
    it('finds a key, an element of an array and a nested key, through comments and trailing commas', () => {
        assert.equal(place('extends'), '3:5');
        assert.equal(place('extends[1]'), '3:32');
        assert.equal(place('overrides[0].reason'), '5:29');
        assert.equal(place('overrides[1].folders[1]'), '6:43');
        assert.equal(place('overrides[1].rules["max-files"][1].max'), '6:86');
    });

    it('has no place for what is not there, or for a problem about the whole file', () => {
        assert.equal(place('overrides[2]'), undefined);
        assert.equal(place('nothing'), undefined);
        assert.equal(place('(the configuration)'), undefined);
        assert.equal(offsetOfPath('not json', 'extends'), undefined);
    });

    it('looks under the key of a package.json', () => {
        const manifest = '{\n  "name": "x",\n  "crowded-folders": { "extends": ["recommended"] }\n}';
        const offset = offsetOfPath(manifest, 'extends', ['crowded-folders']);
        assert.deepEqual(positionOf(manifest, offset ?? 0), { line: 3, column: 24 });
    });

    it('counts a file with a byte order mark from its first character', () => {
        const offset = offsetOfPath('\u{FEFF}{ "a": 1 }', 'a');
        assert.equal(offset, 3);
    });
});

describe('where a text stops being JSON', () => {
    const at = (text: string): string => {
        const offset = syntaxErrorOffset(stripJsonc(text));
        return offset === undefined ? 'valid' : (JSON.stringify(positionOf(text, offset)) ?? '');
    };

    it('says the offset of the first thing wrong, and nothing for JSON', () => {
        assert.equal(at(TEXT), 'valid');
        assert.equal(at('{ "a": }'), '{"line":1,"column":8}');
        assert.equal(at('{\n  "a": 1\n  "b": 2\n}'), '{"line":3,"column":3}');
        assert.equal(at('{ "a": '), '{"line":1,"column":8}');
        assert.equal(at(''), '{"line":1,"column":1}');
        assert.equal(at('[1, 2'), '{"line":1,"column":6}');
        assert.equal(at('{ "a": 1 } x'), '{"line":1,"column":12}');
        assert.equal(at('{ "a": "x\ny" }'), '{"line":1,"column":10}');
    });

    it('agrees with JSON.parse on what is JSON', () => {
        for (const text of [
            '{}',
            '[]',
            '[1, -2.5e3, true, null, "a\\"b"]',
            '{"a":{"b":[{}]}}',
            '01',
            '{"a" 1}',
            '[1,,2]',
            "{'a':1}",
            '[',
            '{"a":1,}x',
        ]) {
            let valid = true;
            try {
                JSON.parse(text);
            } catch {
                valid = false;
            }
            assert.equal(syntaxErrorOffset(text) === undefined, valid, text);
        }
    });
});
