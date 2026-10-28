import type { Detection } from '../core/presets/detect.ts';
import { detectConfig, type Manifests, MAX_MANIFESTS } from '../node/manifests.ts';
import type { Args } from './args.ts';
import type { Io } from './io.ts';

/**
 * Without a configuration file: the presets detected, plus the ones given with `--preset` (later,
 * so they win); with `--no-detect`, the given ones only, or recommended when none is given.
 */
export function presetsWithoutConfiguration(args: Args, base: string, files: readonly string[], io: Io): Detection[] {
    const found: Detection[] = [];
    if (args.detect) {
        const detection = detectConfig(base, files);
        warnIfTruncated(detection.manifests, io);
        found.push(...detection.detected);
    }
    for (const preset of args.presets) {
        if (found.every(detection => detection.preset !== preset)) {
            found.push({ preset, evidence: 'given with --preset', folders: ['.'] });
        }
    }
    return found.length > 0 ? found : [{ preset: 'recommended', evidence: 'every repository', folders: ['.'] }];
}

/** Says on standard error when detection did not read every package.json, so that a missing preset is not a mystery. */
export function warnIfTruncated(manifests: Manifests, io: Io): void {
    if (manifests.skipped > 0) {
        io.error(
            `crowded-folders: read the ${MAX_MANIFESTS} shallowest package.json files to detect presets and left ${manifests.skipped} unread: a preset only declared in those may be missing (pass --preset to add it).\n`,
        );
    }
}
