import { caseCollision } from './case-collision.ts';
import { orphanCompanions } from './games/orphan-companions.ts';
import { typeFolders } from './games/type-folders.ts';
import { maxFiles } from './max-files.ts';
import { maxFolders } from './max-folders.ts';
import { prefixGroups } from './prefix-groups.ts';
import { redundantPrefix } from './redundant-prefix.ts';
import type { Rule } from './rule.ts';
import { scatteredFeature } from './scattered-feature.ts';
import { singleFileFolders } from './single-file-folders.ts';

/** The rules that come with the package, by the name a configuration uses. */
export const BUILT_IN_RULES: Readonly<Record<string, Rule>> = {
    'max-files': maxFiles,
    'prefix-groups': prefixGroups,
    'max-folders': maxFolders,
    'redundant-prefix': redundantPrefix,
    'single-file-folders': singleFileFolders,
    'case-collision': caseCollision,
    'scattered-feature': scatteredFeature,
    'orphan-companions': orphanCompanions,
    'type-folders': typeFolders,
};
