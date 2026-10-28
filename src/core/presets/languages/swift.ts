import type { Preset } from '../../config/types.ts';

export const swift: Preset = {
    description:
        'Swift and iOS: User+Codable.swift is an extension of User and belongs with it, and in test targets UserTests is User. FakeUserService and MockUserService are about user. Asset catalogs, localisation folders, Xcode bundles, vendored frameworks (.xcframework, .framework, .bundle) and DocC resources are left out.',
    sources: [
        {
            title: 'Google Swift style guide: file names (MyType+MyProtocol.swift)',
            url: 'https://google.github.io/swift/',
        },
        {
            title: 'Apple: creating a static framework (a .framework bundle: a compiled library with its headers)',
            url: 'https://developer.apple.com/documentation/xcode/creating-a-static-framework',
        },
        {
            title: 'Martin Fowler, Test Double: the kinds Gerard Meszaros lists (dummy, fake, stub, spy, mock)',
            url: 'https://martinfowler.com/bliki/TestDouble.html',
        },
    ],
    detect: { files: ['Package.swift', '**/*.xcodeproj/project.pbxproj'] },
    config: {
        extends: ['recommended'],
        exclude: [
            '*.xcassets',
            '*.lproj',
            '*.xcodeproj',
            '*.xcworkspace',
            'DerivedData',
            'Pods',
            'Carthage',
            '.build',
            // Someone else's binaries, with their Headers and resources inside.
            '*.xcframework',
            '*.framework',
            '*.bundle',
            // The images and files a documentation catalogue is written around.
            '**/*.docc/Resources',
        ],
        naming: {
            companions: [String.raw`\+.+$`],
            ignoreLeadingWords: ['fake', 'mock', 'stub', 'spy', 'dummy'],
        },
        overrides: [
            {
                folders: ['**/*Tests', '**/*Tests/**'],
                reason: 'A test case is named after the type it tests (UserTests), and only in test targets: elsewhere SpeedTest and ABTest are types of their own.',
                naming: { companions: ['(Tests|Test|Spec)$'] },
            },
        ],
    },
};
