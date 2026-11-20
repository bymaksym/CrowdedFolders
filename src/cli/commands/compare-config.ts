import { basename, dirname } from 'node:path';

import { compareConfigs, type ConfigChange } from '../../core/config/compare.ts';
import { isObject } from '../../core/config/json-schema.ts';
import { parseJsonc } from '../../core/config/jsonc.ts';
import { type Finding, runEngine } from '../../core/engine.ts';
import { isCode, nestedConfigs, PACKAGE_KEY } from '../../node/config/file.ts';
import { textAt } from '../../node/git-base.ts';
import { loadConfig } from '../../node/load-config.ts';
import { type Args, UsageError } from '../args.ts';
import type { Session } from '../session.ts';

/**
 * `--compare-config <ref>`: the configuration file as it was at `ref`, loaded as today's is and run
 * over today's files, compared with today's. Only JSON: `git show` gives the text of a file, and a
 * JavaScript configuration from another commit would have to be run, with its imports, as it was.
 * What the file extends (a preset, a shared JSON file, a plugin) is read as it is today.
 */
export async function compareConfigAt(
    args: Args,
    session: Session,
    files: readonly string[],
    only: readonly string[] | undefined,
    afterFindings: readonly Finding[],
): Promise<ConfigChange> {
    const ref = args.compareConfig ?? '';
    const path = session.configPath;
    if (path === undefined) {
        throw new UsageError(
            '--compare-config compares the configuration file with what it was, and this run has none (the presets were detected or given)',
        );
    }
    if (isCode(path)) {
        throw new UsageError(
            `--compare-config reads JSON configurations only, and ${basename(path)} is JavaScript: an old version of it would have to run, imports and all, as it was. Compare by hand with git diff ${ref} -- ${basename(path)}`,
        );
    }
    const found = textAt(path, ref);
    if ('problem' in found) {
        throw new UsageError(`--compare-config ${ref}: ${found.problem}`);
    }
    let raw: unknown;
    try {
        const value = parseJsonc(found.text);
        raw = basename(path) === 'package.json' && isObject(value) ? value[PACKAGE_KEY] : value;
    } catch (error) {
        throw new UsageError(
            `--compare-config ${ref}: ${basename(path)} is not JSON there: ${(error as Error).message}`,
        );
    }
    if (raw === undefined) {
        throw new UsageError(`--compare-config ${ref}: package.json had no "${PACKAGE_KEY}" key there`);
    }
    const before = await loadConfig(raw, `${ref}:${basename(path)}`, dirname(path), {
        code: args.code,
        base: session.base,
        nested: nestedConfigs(session.files, session.base, path),
    });
    const beforeFindings = runEngine({
        files,
        config: before.config,
        rules: { ...before.rules, ...session.loaded.rules },
        ...(only && { only }),
    }).findings;
    return compareConfigs({
        label: ref,
        before: before.config,
        after: session.loaded.config,
        rules: session.loaded.rules,
        beforeFindings: beforeFindings.filter(finding => !finding.rule.startsWith('config/')),
        afterFindings: afterFindings.filter(finding => !finding.rule.startsWith('config/')),
    });
}
