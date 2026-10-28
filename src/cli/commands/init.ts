import { existsSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

import { pinnedSchemaUrl } from '../../core/config/schema.ts';
import { runEngine } from '../../core/engine.ts';
import { plural } from '../../core/plural.ts';
import { type Detection, detectPresets, excludesFor, godotAddons } from '../../core/presets/detect.ts';
import { BUILT_IN_PRESETS } from '../../core/presets/index.ts';
import { asciiProse, wrapWords } from '../../core/report/ascii.ts';
import { CONFIG_NAMES, findConfig, PACKAGE_KEY, projectDirOf } from '../../node/config-file.ts';
import { loadConfig } from '../../node/load-config.ts';
import { dependenciesOf } from '../../node/manifests.ts';
import { type Args, UsageError } from '../args.ts';
import { commandName, type Io, terminalWidth, wantsSymbols, writeFileAtomic } from '../io.ts';
import { type Session, warnIfTruncated } from '../session.ts';
import { TOOL } from '../tool.ts';

/**
 * Writes the configuration with the presets that fit the repository, then says how many problems it has
 * today and the one thing to type next.
 *
 * Where: `--config <file>`; else the file the repository already has (only with `--force`); else
 * `.config/crowded-folders.json` when the repository keeps its tool configurations in `.config/`; else
 * `crowded-folders.config.json` at the root. A configuration written in JavaScript, or kept in package.json,
 * is never replaced: that is code, and a second file next to it would leave two configurations.
 */
export async function init(args: Args, io: Io, session: Session): Promise<number> {
    const path = targetOf(args, session);

    let detections: Detection[];
    if (args.presets.length > 0) {
        detections = args.presets.map(preset => ({ preset, evidence: 'given with --preset', folders: ['.'] }));
    } else {
        const manifests = dependenciesOf(session.base, session.files);
        warnIfTruncated(manifests, io);
        detections = detectPresets(session.files, manifests.names, BUILT_IN_PRESETS);
    }
    const presets = [...new Set(detections.map(detection => detection.preset))];
    // A preset found in a sub-folder (a Flutter app in app/) gets its root-anchored excludes from there,
    // written down so that they can be read and changed.
    let exclude = excludesFor(detections, session.files, BUILT_IN_PRESETS);
    // Godot's addons/ is left out by the preset, and a plugin of your own lives there too: one line each.
    const addons = godotAddons(detections, session.files);
    for (const { folder, names } of addons) {
        const base = folder === '.' ? '' : `${folder}/`;
        exclude = exclude.filter(pattern => pattern !== `${base}addons`);
        exclude.push(...(folder === '.' ? ['!/addons'] : []), ...names.map(name => `${base}addons/${name}`));
    }
    const replaced = existsSync(path);
    const config = {
        $schema: pinnedSchemaUrl(TOOL.version),
        extends: presets,
        ...(exclude.length > 0 && { exclude }),
    };
    writeFileAtomic(path, `${JSON.stringify(config, undefined, 4)}\n`);

    const loaded = await loadConfig(config, path, session.base);
    const result = runEngine({ files: session.files, config: loaded.config, rules: loaded.rules });
    const errors = result.findings.filter(finding => finding.severity === 'error').length;
    const warnings = result.findings.length - errors;

    const shownPath = relative(io.cwd, path) || path;
    const lines = [`${replaced ? 'Replaced' : 'Wrote'} ${shownPath} with ${presets.join(', ')}:`];
    for (const detection of detections) {
        const preset = BUILT_IN_PRESETS[detection.preset];
        const said = `${detection.evidence}${preset ? ` — ${firstSentence(preset.description)}` : ''}`;
        const [first = '', ...more] = wrapWords(said, terminalWidth(io), 17, 17);
        lines.push(`  ${detection.preset.padEnd(14)} ${first}`, ...more.map(line => `${' '.repeat(17)}${line}`));
    }
    for (const { folder, names } of addons) {
        lines.push(
            `  addons of ${folder === '.' ? 'the project' : folder}: ${names.join(', ')} — left out one by one in "exclude"; delete the line of a plugin of your own to check it`,
        );
    }
    if (!isFoundByName(path)) {
        lines.push(
            `  ${basename(path)} is not a name crowded-folders looks for: pass --config ${shownPath} each time, or call it crowded-folders.config.json`,
        );
    }
    lines.push('');
    pushNextSteps(lines, { errors, warnings, folders: result.folderCount, io, session });
    const text = `${lines.join('\n')}\n`;
    io.write(wantsSymbols(io) ? text : asciiProse(text));
    return 0;
}

/** Where the configuration goes, and a refusal for every way of ending with two or none that can be read. */
function targetOf(args: Args, session: Session): string {
    const given = args.config === undefined ? undefined : resolve(session.cwd, args.config);
    const existing = given === undefined ? findConfig(session.root) : undefined;
    const present = given === undefined ? existing?.path : existsSync(given) ? given : undefined;
    if (given !== undefined && existsSync(given) && statSync(given).isDirectory()) {
        throw new UsageError(`--config ${args.config ?? ''}: ${given} is a folder; name the file to write`);
    }
    if (present !== undefined && !args.force) {
        throw new UsageError(`${present} already exists: edit it, or pass --force to write a new one`);
    }
    if (present !== undefined && !isJson(present)) {
        throw new UsageError(
            basename(present) === 'package.json'
                ? `the configuration is in ${present} under "${PACKAGE_KEY}": init writes a JSON file, and a second configuration next to it would be an error. Edit it there, or move it out and run init again.`
                : `${present} is JavaScript: init writes JSON and will not replace code, and a second configuration next to it would be an error. Edit it, or delete it and run init again.`,
        );
    }
    if (given !== undefined) {
        if (!isJson(given)) {
            throw new UsageError(
                `--config ${args.config ?? ''}: init writes JSON; name the file *.json or *.jsonc (crowded-folders.config.json)`,
            );
        }
        const beside = CONFIG_NAMES.map(name => join(projectDirOf(given), name)).find(
            other => existsSync(other) && resolve(other) !== given,
        );
        if (beside !== undefined) {
            throw new UsageError(
                `${beside} is already the configuration there: writing ${given} would leave two. Edit that one, or remove it first.`,
            );
        }
        return given;
    }
    if (present !== undefined) {
        return present;
    }
    // A repository that keeps its tool configurations in `.config/` keeps this one there too.
    return existsSync(join(session.base, '.config')) && statSync(join(session.base, '.config')).isDirectory()
        ? join(session.base, '.config', 'crowded-folders.json')
        : join(session.base, CONFIG_NAMES[0]);
}

function isJson(path: string): boolean {
    return basename(path) !== 'package.json' && ['.json', '.jsonc'].includes(extname(path));
}

/** Whether a later run finds the file without being told: its name is one of the names looked for. */
function isFoundByName(path: string): boolean {
    const normal = path.replaceAll('\\', '/');
    return CONFIG_NAMES.some(name => normal.endsWith(`/${name}`));
}

/**
 * What to do now, as one `Next:` line that can be copied, and then why and what else. Through `npx` the
 * command is not on the PATH, so that is what is written; a package.json gets the script it would hold.
 */
function pushNextSteps(
    lines: string[],
    context: {
        readonly errors: number;
        readonly warnings: number;
        readonly folders: number;
        readonly io: Io;
        readonly session: Session;
    },
): void {
    const { errors, warnings, folders, io, session } = context;
    const command = commandName(io);
    const installed = command === 'crowded-folders';
    const inCi = `${installed ? 'crowded-folders' : 'npx --yes crowded-folders'} --format auto`;
    const script = installed ? 'crowded-folders' : 'npx --yes crowded-folders';
    const ci = `${TOOL.url}/blob/main/docs/ci.md`;
    if (errors + warnings === 0) {
        lines.push(
            `No crowded folders today (${plural(folders, 'folder')} checked).`,
            `Next: add \`${inCi}\` to your CI, to keep it that way (${ci}).`,
        );
    } else {
        const found = [plural(errors, 'error'), plural(warnings, 'warning')].filter(text => !text.startsWith('0 '));
        lines.push(
            `${found.join(' and ')} today.`,
            `Next: ${command}`,
            `To adopt it without fixing them first: ${command} --suppress-all`,
            '  (records the errors in crowded-folders-suppressions.json; they may not grow, and new ones fail)',
        );
    }
    if (existsSync(join(session.base, 'package.json'))) {
        lines.push(`To run it with your scripts: "scripts": { "folders": "${script}" } in package.json.`);
    }
    if (errors + warnings > 0) {
        lines.push(`To keep it from coming back, run \`${inCi}\` in CI (${ci}).`);
    }
    lines.push(`Presets and where each comes from: ${command} presets`);
}

function firstSentence(text: string): string {
    const end = text.indexOf('. ');
    return end === -1 ? text : text.slice(0, end + 1);
}
