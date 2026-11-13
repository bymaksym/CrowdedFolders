/**
 * When each built-in rule fires and what to do, for the long help of a rule in SARIF (what GitHub
 * shows when an alert is opened). A rule from a plugin has only its description. A test checks that
 * every built-in rule is here.
 */
export const WHEN_IT_FIRES: Readonly<Record<string, string>> = {
    'max-files':
        'A folder holds more modules than `max` (or more files, with `count: "files"`). Split it into folders by what the files are about (`checkout/`, `catalog/`), not by what they are (`components/`, `services/`).',
    'prefix-groups':
        'At least `min` modules in a folder start with the same word (`render-json`, `render-text`, `render-sarif`, `render-pr`). They are a folder nobody made: move them into `render/`. It stays quiet when the whole folder (or 85 % of it) shares the prefix, as for translations and numbered series, and for a group that would be over the `max-files` limit on its own.',
    'redundant-prefix':
        'Modules in a folder repeat the name of the folder (`render/render-json.ts`). The folder already says it: rename them (`render/json.ts`).',
    'max-folders':
        'A folder holds more subfolders than `max`. A long list of folders is a junk drawer too: group them by what they are about.',
    'single-file-folders':
        'A folder holds one file and no subfolders: a level of nesting with nothing to group. Move the file up, unless a convention needs the folder.',
    'case-collision':
        'Two files or folders of one folder have names that differ only in case or in Unicode normalisation (`Components/` and `components/`). Windows and macOS keep one of them: git cannot check both out there. Rename one, or join them.',
    'scattered-feature':
        'One word starts module names in at least `min` layer folders of one folder (`controller/RegistroController`, `service/RegistroService`, `repository/RegistroRepository`): a feature split by layer. Package by feature: move them into `registro/`; the moves are in the result, tests included where a mirror is configured.',
    'orphan-companions':
        "A file an engine keeps next to an asset (Unity's `Player.cs.meta`, Godot's `icon.png.import`) has no asset beside it: the asset was moved, renamed or deleted outside the editor, or never committed, and every reference to it is broken. Move the companion with its asset, or delete it if the asset is gone.",
    'type-folders':
        'A folder of a game project is named after a type of asset (`Textures/`, `Materials/`, `Meshes/`). Put each asset next to what uses it (`Rocks/` with its mesh, textures and materials); the editor filters by type.',
    'config/unused-override':
        'An override in the configuration matches no folder. Fix its globs, or remove it: an override that does nothing hides a mistake.',
    'config/expired-override':
        'An override is past the date in its "expires" (YYYY-MM-DD). It still applies, so nothing breaks on that day; the warning asks its owner to look again: renew "expires" if the reason still holds, or remove the override and fix the folders.',
    'config/stale-suppression':
        'A suppression records a problem that is fixed or smaller now. Run `crowded-folders --prune-suppressions` and commit the file: it only ever shrinks.',
};
