/**
 * When each built-in rule fires and what to do, for the long help of a rule in SARIF (what GitHub
 * shows when an alert is opened). A rule from a plugin has only its description. A test checks that
 * every built-in rule is here.
 */
export const WHEN_IT_FIRES: Readonly<Record<string, string>> = {
    'max-files':
        'A folder holds more modules than `max` (or more files, with `count: "files"`). Split it into folders by what the files are about (`checkout/`, `catalog/`), not by what they are (`components/`, `services/`).',
    'prefix-groups':
        'At least `min` modules in a folder start with the same word (`render-json`, `render-text`, `render-sarif`, `render-pr`). They are a folder nobody made: move them into `render/`. It stays quiet when the whole folder shares the prefix, for translations and for numbered series.',
    'redundant-prefix':
        'Modules in a folder repeat the name of the folder (`render/render-json.ts`). The folder already says it: rename them (`render/json.ts`).',
    'max-folders':
        'A folder holds more subfolders than `max`. A long list of folders is a drawer too: group them by what they are about.',
    'single-file-folders':
        'A folder holds one file and no subfolders: a level of nesting with nothing to group. Move the file up, unless a convention needs the folder.',
    'config/unused-override':
        'An override in the configuration matches no folder. Fix its globs, or remove it: an override that does nothing hides a mistake.',
    'config/stale-suppression':
        'A suppression records a problem that is fixed or smaller now. Run `crowded-folders --prune-suppressions` and commit the file: it only ever shrinks.',
};
