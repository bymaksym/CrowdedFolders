import type { Preset } from '../../config/types.ts';

/** Any new folder is a new package, whatever language is in it. */
const HINT =
    'In Bazel a folder with a BUILD.bazel is a package: a new folder needs its own BUILD file and its own visibility.';

export const bazel: Preset = {
    description:
        "Bazel: a folder with a BUILD.bazel is a package, with its own targets and its own visibility, so a new folder is a new BUILD file and a new set of visibility rules, not just a directory (the hint says so on every folder it proposes). The limits are recommended's measured 20 (no Bazel guide gives a number), the root of every package gets the 40 of the repository root, and the bazel-* symlinks to the output are left out.",
    sources: [
        {
            title: 'Bazel: BUILD files, "By definition, every package contains a BUILD file"',
            url: 'https://bazel.build/concepts/build-files',
        },
        {
            title: 'Bazel: visibility, "Visibility is specified by listing allowed packages"',
            url: 'https://bazel.build/concepts/visibility',
        },
    ],
    detect: { files: ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'] },
    config: {
        extends: ['recommended'],
        exclude: ['bazel-*'],
        rules: {
            'max-files': ['error', { hint: HINT }],
            'prefix-groups': ['error', { hint: HINT }],
        },
    },
};
