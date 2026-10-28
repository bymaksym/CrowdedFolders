import type { Preset } from '../../config/types.ts';

/** Strict and reserved keywords: a module of that name needs `r#`, and `crate`, `self`, `super` cannot be one at all. */
const RUST_KEYWORDS = [
    'as async await break const continue crate dyn else enum extern false fn',
    'for gen if impl in let loop match mod move mut pub ref return self',
    'static struct super trait true type unsafe use where while abstract become',
    'box do final macro override priv try typeof unsized virtual yield',
].flatMap(line => line.split(' '));

export const rust: Preset = {
    description:
        'Recommended for Rust: render_json.rs and render_pr.rs become render.rs and render/json.rs, the module layout the Rust reference prefers, so a move leaves render.rs where it is, names the folder in snake_case and never after a keyword (type/, mod/ and match/ would need r#). mod.rs, the module of the folder itself, does not count. Cargo builds one target per file in src/bin, examples, benches and tests, so those stay flat.',
    sources: [
        {
            title: 'The Rust reference: modules and module source files',
            url: 'https://doc.rust-lang.org/reference/items/modules.html',
        },
        { title: 'Cargo: package layout', url: 'https://doc.rust-lang.org/cargo/guide/project-layout.html' },
        { title: 'The Rust reference: keywords', url: 'https://doc.rust-lang.org/reference/keywords.html' },
        {
            title: 'Rust API guidelines: modules are snake_case',
            url: 'https://rust-lang.github.io/api-guidelines/naming.html',
        },
    ],
    detect: { files: ['Cargo.toml'] },
    config: {
        extends: ['recommended'],
        // Anchored: cargo writes target/ next to the Cargo.toml, and a crate can have a module called target.
        exclude: ['/target'],
        // mod.rs is the module the folder is (the older layout of foo/mod.rs for foo.rs): not one more file in it.
        naming: {
            folderFiles: ['mod.rs'],
            // render.rs declares `mod json;` for render/json.rs: it stays beside the folder.
            groupFileStays: true,
            folderCase: 'snake',
            reservedWords: RUST_KEYWORDS,
        },
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
