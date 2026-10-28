import type { Preset } from '../../config/types.ts';

export const rust: Preset = {
    description:
        'Recommended for Rust: render_json.rs and render_pr.rs become render.rs and render/json.rs, the module layout the Rust reference prefers. mod.rs, the module of the folder itself, does not count. Cargo builds one target per file in src/bin, examples, benches and tests, so those stay flat.',
    sources: [
        {
            title: 'The Rust reference: modules and module source files',
            url: 'https://doc.rust-lang.org/reference/items/modules.html',
        },
        { title: 'Cargo: package layout', url: 'https://doc.rust-lang.org/cargo/guide/project-layout.html' },
    ],
    detect: { files: ['Cargo.toml'] },
    config: {
        extends: ['recommended'],
        // Anchored: cargo writes target/ next to the Cargo.toml, and a crate can have a module called target.
        exclude: ['/target'],
        // mod.rs is the module the folder is (the older layout of foo/mod.rs for foo.rs): not one more file in it.
        naming: { folderFiles: ['mod.rs'] },
        rules: {
            // Off here, and strict turns it on keeping this: Cargo requires src/lib.rs or src/main.rs.
            'single-file-folders': ['off', { allowed: ['lib.rs', 'main.rs'] }],
        },
        overrides: [
            {
                folders: ['**/src/bin', '**/examples', '**/benches', '**/tests', '**/tests/**'],
                reason: 'Cargo makes every file there its own target (binary, example, benchmark, integration test), and UI-test suites keep one case per file.',
                rules: { 'max-files': 'off', 'prefix-groups': 'off' },
            },
        ],
    },
};
