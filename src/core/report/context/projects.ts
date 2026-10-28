/** Files that mark a folder as a project of its own: a package, a module, a crate, a Bazel package. */
const MANIFESTS = new Set(['package.json', 'project.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'BUILD.bazel']);

/** The folders that hold a project manifest, from the list of files. The root is `.`. */
export function projectFolders(files: readonly string[]): Set<string> {
    const folders = new Set<string>();
    for (const file of files) {
        const slash = file.lastIndexOf('/');
        if (MANIFESTS.has(file.slice(slash + 1))) {
            folders.add(slash === -1 ? '.' : file.slice(0, slash));
        }
    }
    return folders;
}

/** The nearest project folder from `folder` upwards (the folder itself counts); `null` when none. */
export function projectOf(folder: string, projects: ReadonlySet<string>): string | null {
    let current = folder;
    for (;;) {
        if (projects.has(current)) {
            return current;
        }
        if (current === '.') {
            return null;
        }
        const slash = current.lastIndexOf('/');
        current = slash === -1 ? '.' : current.slice(0, slash);
    }
}
