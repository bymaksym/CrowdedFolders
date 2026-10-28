import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where GitHub (and GitLab) look for CODEOWNERS, in the order they prefer. */
const LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'];

/** The text of the repository's CODEOWNERS file, or `undefined` when it has none. */
export function readCodeowners(root: string): string | undefined {
    for (const location of LOCATIONS) {
        const path = join(root, location);
        if (existsSync(path)) {
            return readFileSync(path, 'utf8');
        }
    }
    return undefined;
}
