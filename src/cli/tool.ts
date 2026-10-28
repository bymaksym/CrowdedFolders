import { OWN_VERSION } from '../node/modules.ts';

/** The name, version and home of this package, for reports and `--version`. */
export const TOOL = {
    name: 'crowded-folders',
    version: OWN_VERSION,
    url: 'https://github.com/bymaksym/CrowdedFolders',
} as const;
