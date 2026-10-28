import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS } from './args.ts';
import { COMMAND_HELP, HELP } from './help.ts';
import { cleanUpAfterTests, cli, repository } from './test-support/harness.ts';

cleanUpAfterTests();

describe('the help', () => {
    it('fits 80 columns, the general one and each command', () => {
        for (const [name, text] of [['crowded-folders --help', HELP], ...Object.entries(COMMAND_HELP)] as const) {
            for (const line of text.split('\n')) {
                assert.ok(line.length <= 80, `${name}: ${line.length} columns in "${line}"`);
            }
        }
    });

    it('has a short help for every command: 5 to 10 lines and an example', () => {
        for (const command of COMMANDS) {
            const lines = COMMAND_HELP[command].split('\n').filter(line => line.trim() !== '');
            assert.ok(lines.length >= 5 && lines.length <= 10, `${command} help has ${lines.length} lines`);
            assert.ok(
                lines.some(line => line.startsWith('Example: crowded-folders')),
                `${command} help has no example`,
            );
        }
    });

    it('prints the help of the command asked for, and the general one for none', async () => {
        const root = repository({});
        assert.equal((await cli(root, ['--help'])).out, HELP);
        for (const command of COMMANDS) {
            assert.equal((await cli(root, [command, '--help'])).out, `${COMMAND_HELP[command]}\n`);
        }
        const ran = await cli(root, ['explain', '-h']);
        assert.match(ran.out, /^crowded-folders explain <folder>/u);
        assert.equal(ran.code, 0);
    });
});
