/**
 * Where this package's documentation is read, for the links in reports, `rules`, the schema and the
 * presets' sources. The version is in the address: whoever pins 1.0.1 reads the pages of 1.0.1, not
 * of whatever `main` says today.
 */
export const REPOSITORY_URL = 'https://github.com/bymaksym/CrowdedFolders';

/**
 * The version of the package, for those links. The core reads no file, so release-please keeps this
 * line in step with package.json (an `extra-files` entry) and a test compares the two.
 */
export const PACKAGE_VERSION = '2.0.0'; // x-release-please-version

/** The address of a page under `docs/` (`rules/max-files.md`, `ci.md#recipes`) as of a version. */
export function docsUrl(page: string, version: string = PACKAGE_VERSION): string {
    return `${REPOSITORY_URL}/blob/v${version}/docs/${page}`;
}
