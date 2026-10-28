import type { Preset } from '../../config/types.ts';

export const dotnet: Preset = {
    description:
        'C# and .NET: a folder is a namespace (IDE0130 is on by default), the I of an interface is not what it is about (IUserService belongs with UserService), FakeUserService is about user, and in test projects UserServiceTests is UserService. One type per file, hence 20.',
    sources: [
        {
            title: 'IDE0130: namespace does not match folder structure',
            url: 'https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0130',
        },
        {
            title: 'C# identifier names: interfaces start with I',
            url: 'https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/identifier-names',
        },
        {
            title: 'Martin Fowler, Test Double: the kinds Gerard Meszaros lists (dummy, fake, stub, spy, mock)',
            url: 'https://martinfowler.com/bliki/TestDouble.html',
        },
    ],
    detect: { files: ['*.csproj', '*.fsproj', '*.vbproj', '*.sln', '*.slnx'] },
    config: {
        extends: ['recommended'],
        exclude: ['bin', 'obj', 'Migrations', 'wwwroot/lib', 'Properties', '.vs'],
        naming: {
            companions: ['^I(?=[A-Z])'],
            // The I of an interface, and the test doubles (dummy, fake, stub, spy, mock) are not what a class is about.
            ignoreLeadingWords: ['i', 'fake', 'mock', 'stub', 'spy', 'dummy'],
        },
        overrides: [
            {
                folders: ['**/*Tests', '**/*Tests/**', '**/*Test', '**/*Test/**', '**/tests', '**/tests/**'],
                reason: 'A test class is named after the class it tests (UserServiceTests), and only in test projects: elsewhere SpeedTest is a class of its own.',
                naming: { companions: ['(Tests|Test)$'] },
            },
        ],
        rules: {
            'max-files': [
                'error',
                {
                    max: 20,
                    count: 'modules',
                    hint: 'In C# a folder is a namespace (IDE0130).',
                    hintFor: ['*.{cs,fs,vb}'],
                },
            ],
            'prefix-groups': ['error', { hint: 'In C# a folder is a namespace (IDE0130).', hintFor: ['*.{cs,fs,vb}'] }],
        },
    },
};
