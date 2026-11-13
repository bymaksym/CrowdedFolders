import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isObject } from '../core/config/json-schema.ts';
import { parseJsonc } from '../core/config/jsonc.ts';
import type { Config } from '../core/config/types.ts';
import { configFromDetections, type Detection, detectPresets, isEvidence } from '../core/presets/detect.ts';
import { BUILT_IN_PRESETS } from '../core/presets/index.ts';

/**
 * How many package.json files are read to detect presets, the shallowest first. They are small, so a
 * monorepo with hundreds is read whole (a NestJS service in services/api must not depend on how many
 * packages come before it); the cap is only a bound for a repository with tens of thousands.
 */
export const MAX_MANIFESTS = 5000;

/** What the package.json files declare, and how many were left unread because of the cap. */
export interface Manifests {
    /** Each dependency name with the manifests that declare it. */
    readonly names: Map<string, string[]>;
    readonly skipped: number;
}

/**
 * The dependency names of the repository's package.json files, each with the manifests that declare
 * it, for detecting presets and where they apply.
 */
export function dependenciesOf(root: string, files: readonly string[], limit = MAX_MANIFESTS): Manifests {
    const names = new Map<string, string[]>();
    const all = files
        .filter(path => (path === 'package.json' || path.endsWith('/package.json')) && isEvidence(path))
        .toSorted((a, b) => a.split('/').length - b.split('/').length);
    const manifests = all.slice(0, limit);
    for (const manifest of manifests) {
        try {
            const value = parseJsonc(readFileSync(join(root, manifest), 'utf8'));
            if (!isObject(value)) {
                continue;
            }
            for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
                const dependencies = value[field];
                if (isObject(dependencies)) {
                    for (const name of Object.keys(dependencies)) {
                        const declaring = names.get(name) ?? [];
                        if (!declaring.includes(manifest)) {
                            names.set(name, [...declaring, manifest]);
                        }
                    }
                }
            }
        } catch {
            // A package.json that does not parse says nothing about presets.
        }
    }
    return { names, skipped: all.length - manifests.length };
}

/** The configuration a run without one uses: the presets found in the repository, and what they leave out. */
export interface DetectedConfig {
    readonly config: Config;
    readonly detected: Detection[];
    readonly manifests: Manifests;
}

/**
 * Detects the presets of a repository from its files and package.json files, the same way for the
 * command and for `lint()`: what `init` would write, and what a run with no configuration uses.
 */
export function detectConfig(root: string, files: readonly string[]): DetectedConfig {
    const manifests = dependenciesOf(root, files);
    const detected = detectPresets(files, manifests.names, BUILT_IN_PRESETS);
    // A preset found only in subfolders applies there, in an override: as init writes it.
    const made = configFromDetections(detected, files, BUILT_IN_PRESETS);
    return {
        config: { extends: [...made.extends], exclude: [...made.exclude], overrides: [...made.overrides] },
        detected,
        manifests,
    };
}
