import type { Preset } from '../../config/types.ts';

export const react: Preset = {
    description:
        'React has no official layout, so this is recommended plus what React names mean: `use` starts every hook and `with` many higher-order components, so they are skipped before reading what a file is about (useAuthLogin and AuthForm are both about auth). Counts a component with its test, story and styles once.',
    sources: [
        {
            title: 'React docs (legacy): file structure — "don\'t overthink it", at most three or four levels',
            url: 'https://legacy.reactjs.org/docs/faq-structure.html',
        },
        {
            title: 'React: hook names must start with use',
            url: 'https://react.dev/learn/reusing-logic-with-custom-hooks',
        },
        {
            title: 'bulletproof-react: project structure by feature',
            url: 'https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md',
        },
    ],
    detect: { dependencies: ['react', 'react-dom', 'react-native'] },
    config: {
        extends: ['recommended'],
        exclude: ['public'],
        naming: { ignoreLeadingWords: ['use', 'with'] },
    },
};

export const nextjs: Preset = {
    description:
        'React, plus the App Router: under app/ a folder is a URL segment, so the advice is a private folder (_name) or a route group ((name)), which group files without changing URLs.',
    sources: [
        {
            title: 'Next.js: project structure, private folders and route groups',
            url: 'https://nextjs.org/docs/app/getting-started/project-structure',
        },
    ],
    detect: { dependencies: ['next'] },
    config: {
        extends: ['react'],
        exclude: ['.next', 'next-env.d.ts'],
        overrides: [
            {
                folders: ['app', 'app/**', 'src/app', 'src/app/**'],
                reason: 'Under the App Router a plain folder becomes part of the URL.',
                // A group moves into a route group, (name)/, which does not change the URL.
                naming: { routes: true },
                rules: {
                    'prefix-groups': [
                        'error',
                        {
                            hint: 'Under app/ a folder is a URL segment: use a private folder (_name) or a route group ((name)).',
                        },
                    ],
                },
            },
        ],
    },
};

export const reactNative: Preset = {
    description:
        'React, plus the native projects: ios/ and android/ next to the app are the Xcode and Gradle projects that the template or Expo prebuild generates, not code arranged by hand, so they are left out wherever the app lives in the repository. So are assets/animations and assets/lottie: a Lottie animation is a .json file exported from After Effects, a picture rather than code. The _layout, +html, +not-found and +native-intent files of Expo Router describe their folder and do not count. Under the app/ of Expo Router a file is a route, so strict does not ask to flatten a folder whose only file is index or a [param] (experiences/[id].tsx): moving it changes the address. For the same reason a group of screens there (sign-in, sign-up, sign-out) moves into a route group, (sign)/, with its names, which keeps every address.',
    sources: [
        {
            title: 'Expo Router: "an index.tsx file indicates the default route for a directory"; square brackets in a file or directory name are a dynamic route',
            url: 'https://docs.expo.dev/router/basics/notation/',
        },
        {
            title: 'Expo: continuous native generation — prebuild "creates the android and ios directories"',
            url: 'https://docs.expo.dev/workflow/continuous-native-generation/',
        },
        {
            title: 'Expo Router: notation (_layout, +html, +not-found, [param], (group))',
            url: 'https://docs.expo.dev/router/basics/notation/',
        },
        {
            title: 'lottie-react-native: "animations exported as JSON with bodymovin", loaded with require("../path/to/animation.json")',
            url: 'https://github.com/lottie-react-native/lottie-react-native',
        },
    ],
    detect: { dependencies: ['react-native', 'expo'] },
    config: {
        extends: ['react'],
        // A Lottie animation is a .json exported from After Effects, one per animation: a folder of
        // them is a folder of pictures, not of code.
        exclude: ['/ios', '/android', '.expo', '**/assets/animations', '**/assets/lottie'],
        // Expo Router's files for the folder itself: its layout, its HTML shell, its not-found screen
        // and its deep-link handler. A folder of screens is not crowded by them.
        naming: { folderFiles: ['_layout.*', '+html.*', '+not-found.*', '+native-intent.*'] },
        overrides: [
            {
                folders: ['app', 'app/**', 'src/app', 'src/app/**'],
                reason: 'Expo Router: under app/ the path of a file is its address, so /sign-in must not become /sign/in; a route group, (sign)/, groups screens without changing it.',
                naming: { routes: true },
            },
        ],
        rules: {
            // Off here, and strict turns it on keeping this: in app/ the path of a file is its address.
            'single-file-folders': ['off', { allowed: ['**/app/**/index.*', '**/app/**/[[]*].*'] }],
        },
    },
};
