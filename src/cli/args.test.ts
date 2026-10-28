import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCommandLine, UsageError } from './args.ts';

function usageOf(...argv: string[]): string {
    try {
        parseCommandLine(argv);
    } catch (error) {
        assert.ok(error instanceof UsageError, `${argv.join(' ')} threw ${String(error)}`);
        return error.message;
    }
    return assert.fail(`${argv.join(' ')} was accepted`);
}

describe('an unknown option', () => {
    it('says what was typed and the closest option, not the text of Node', () => {
        assert.equal(usageOf('--fromat', 'json'), 'unknown option --fromat; did you mean --format?');
        assert.equal(usageOf('--suppres-all'), 'unknown option --suppres-all; did you mean --suppress-all?');
        assert.equal(usageOf('--zzzzzzzz'), 'unknown option --zzzzzzzz');
        assert.equal(usageOf('-z'), 'unknown option -z');
    });

    it('says an option needs its value, or takes none, in a line', () => {
        assert.match(usageOf('--config'), /^--config needs a value/u);
        assert.match(usageOf('--stdin=yes'), /^--stdin takes no value/u);
    });
});

describe('options given twice', () => {
    it('are a usage error, unless the option is a list', () => {
        assert.match(usageOf('-c', 'a.json', '--config', 'b.json'), /--config is given more than once/u);
        assert.match(usageOf('-q', '-q'), /--quiet is given more than once/u);
        assert.match(usageOf('--output', 'a', '-o', 'b'), /--output is given more than once/u);
        const lists = parseCommandLine(['-f', 'github', '-f', 'sarif=a.sarif', '-p', 'react', '-p', 'strict']);
        assert.equal(lists.outputs.length, 2);
        assert.deepEqual(lists.presets, ['react', 'strict']);
    });
});

describe('the options of each command', () => {
    it('refuses an option the command would ignore, and says which commands take it', () => {
        assert.equal(
            usageOf('explain', 'src', '-f', 'json'),
            '--format does not apply to explain; it applies to check, overrides, tree',
        );
        assert.match(usageOf('explain', 'src', '-o', 'x.txt'), /^--output does not apply to explain/u);
        assert.match(usageOf('rules', '--suppress-all'), /^--suppress-all does not apply to rules/u);
        assert.match(usageOf('presets', '--quiet'), /^--quiet does not apply to presets/u);
        assert.match(usageOf('init', '--format', 'json'), /^--format does not apply to init/u);
        assert.match(usageOf('print-config', '--moves'), /^--moves does not apply to print-config/u);
        assert.match(usageOf('init', '--force', '--stdin', '--tracked-only'), /--tracked-only and --stdin/u);
    });

    it('lets each command take its own, and --help and --version anywhere', () => {
        parseCommandLine(['explain', 'src', '--config', 'c.json', '--no-git', '--root', '.']);
        parseCommandLine(['init', '--force', '--preset', 'react']);
        parseCommandLine(['rules', '--help']);
        parseCommandLine(['presets', '-v']);
        parseCommandLine(['explain', '--format', 'json', '--help']);
    });
});

describe('--max-warnings', () => {
    it('takes digits and -1 for no limit, nothing else', () => {
        assert.equal(parseCommandLine(['--max-warnings', '5']).maxWarnings, 5);
        assert.equal(parseCommandLine(['--max-warnings=0']).maxWarnings, 0);
        assert.equal(parseCommandLine(['--max-warnings', '-1']).maxWarnings, undefined);
        assert.equal(parseCommandLine(['--max-warnings=-1']).maxWarnings, undefined);
        for (const value of ['', '0x10', '1e3', ' 5', '5 ', '-2', '1.5', 'many', '+3']) {
            assert.match(usageOf(`--max-warnings=${value}`), /--max-warnings must be a whole number/u, value);
        }
    });
});

describe('where a report goes', () => {
    it('remembers which form asked for it, so that an error names the one that was typed', () => {
        assert.deepEqual(
            parseCommandLine(['-f', 'json=x.json']).outputs.map(spec => spec.option),
            ['--format json=x.json'],
        );
        assert.deepEqual(
            parseCommandLine(['-f', 'json', '-o', 'x.json']).outputs.map(spec => spec.option),
            ['--output x.json'],
        );
    });
});
