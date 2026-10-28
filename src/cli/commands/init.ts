import { basename, join, relative } from 'node:path';

import { SCHEMA_URL } from '../../core/config/schema.ts';
import { runEngine } from '../../core/engine.ts';
import { configFromDetections, godotAddons } from '../../core/presets/detect.ts';
import { BUILT_IN_PRESETS } from '../../core/presets/index.ts';
import { CONFIG_NAMES, findConfig } from '../../node/config-file.ts';
import { loadConfig } from '../../node/load-config.ts';
import { type Args, UsageError } from '../args.ts';
import { type Io, writeFileAtomic } from '../io.ts';
import { presetsWithoutConfiguration, type Session } from '../session.ts';

/**
 * Writes `crowded-folders.config.json` at the root with the presets that fit the repository, then
 * says how many problems it has today and how to adopt it without fixing them first.
 */
export async function init(args: Args, io: Io, session: Session): Promise<number> {
    const existing = findConfig(session.root);
    if (existing && !args.force) {
        throw new UsageError(`${existing.path} already exists: edit it, or pass --force to write a new one`);
    }
    // Never over a package.json that holds the configuration under a key: that file is not ours.
    const isReuse =
        existing !== undefined && existing.path.endsWith('.json') && basename(existing.path) !== 'package.json';
    const path = isReuse ? existing.path : join(session.base, CONFIG_NAMES[0]);

    // --preset adds to what is detected, unless --no-detect.
    const detections = presetsWithoutConfiguration(args, session.base, session.files, io);
    // A preset found only in sub-folders (a pom.xml in server/) applies there, in an override; one at
    // the root, in extends, with its root-anchored excludes read from every folder it was found in.
    const made = configFromDetections(detections, session.files, BUILT_IN_PRESETS);
    const presets = made.extends;
    let exclude = [...made.exclude];
    // Godot's addons/ is left out by the preset, and a plugin of your own lives there too: one line each.
    const addons = godotAddons(detections, session.files);
    for (const { folder, names } of addons) {
        const base = folder === '.' ? '' : `${folder}/`;
        exclude = exclude.filter(pattern => pattern !== `${base}addons`);
        exclude.push(...(folder === '.' ? ['!/addons'] : []), ...names.map(name => `${base}addons/${name}`));
    }
    const config = {
        $schema: SCHEMA_URL,
        extends: presets,
        ...(exclude.length > 0 && { exclude }),
        ...(made.overrides.length > 0 && { overrides: made.overrides }),
    };
    writeFileAtomic(path, `${JSON.stringify(config, undefined, 4)}\n`);

    const loaded = await loadConfig(config, path, session.base);
    const result = runEngine({ files: session.files, config: loaded.config, rules: loaded.rules });
    const errors = result.findings.filter(finding => finding.severity === 'error').length;

    const scoped = made.overrides.flatMap(override => override.extends ?? []);
    const lines = [`Wrote ${relative(io.cwd, path) || path} with ${[...presets, ...scoped].join(', ')}:`];
    for (const detection of detections) {
        const preset = BUILT_IN_PRESETS[detection.preset];
        const under = made.overrides.find(override => override.extends?.includes(detection.preset));
        lines.push(
            `  ${detection.preset.padEnd(14)} ${detection.evidence}${under ? ` (only under ${under.folders.join(', ')})` : ''}${preset ? ` — ${firstSentence(preset.description)}` : ''}`,
        );
    }
    for (const { folder, names } of addons) {
        lines.push(
            `  addons of ${folder === '.' ? 'the project' : folder}: ${names.join(', ')} — left out one by one in "exclude"; delete the line of a plugin of your own to check it`,
        );
    }
    lines.push('');
    if (errors === 0) {
        lines.push(
            `No crowded folders today (${result.folderCount} folders checked). Add \`crowded-folders\` to CI to keep it that way.`,
        );
    } else {
        lines.push(
            `${errors} problem${errors === 1 ? '' : 's'} today. To see them: crowded-folders`,
            'To adopt it without fixing them first: crowded-folders --suppress-all',
            '  (records them in crowded-folders-suppressions.json; they may not grow, and new ones fail)',
        );
    }
    lines.push('Presets and where each comes from: crowded-folders presets');
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

function firstSentence(text: string): string {
    const end = text.indexOf('. ');
    return end === -1 ? text : text.slice(0, end + 1);
}
