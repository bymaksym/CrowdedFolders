import type { Preset } from '../../config/types.ts';

/** C#'s reserved keywords: a namespace segment called that needs an @. */
const CSHARP_KEYWORDS = [
    'abstract as base bool break byte case catch char checked class const',
    'continue decimal default delegate do double else enum event explicit extern',
    'false finally fixed float for foreach goto if implicit in int interface',
    'internal is lock long namespace new null object operator out override',
    'params private protected public readonly ref return sbyte sealed short sizeof',
    'stackalloc static string struct switch this throw true try typeof uint',
    'ulong unchecked unsafe ushort using virtual void volatile while',
].flatMap(line => line.split(' '));

export const dotnet: Preset = {
    description:
        'C# and .NET: a folder is a namespace (IDE0130 is on by default), the I of an interface is not what it is about (IUserService belongs with UserService), FakeUserService is about user, and in test projects UserServiceTests is UserService. One type per file, hence 20. A move proposes the folder in PascalCase, as the namespace is written, and keeps the file names, which are the type names.',
    sources: [
        {
            title: 'IDE0130: namespace does not match folder structure',
            url: 'https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0130',
        },
        {
            title: 'Names of namespaces: PascalCase',
            url: 'https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-namespaces',
        },
        { title: 'C# keywords', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/' },
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
    keeps: {
        'redundant-prefix':
            'a namespace is a feature and its types say what they are (Users/UserService): a type is used by its name, without its namespace',
    },
    config: {
        extends: ['recommended'],
        exclude: ['bin', 'obj', 'Migrations', 'wwwroot/lib', 'Properties', '.vs'],
        naming: {
            companions: ['^I(?=[A-Z])'],
            // The I of an interface, and the test doubles (dummy, fake, stub, spy, mock) are not what a class is about.
            ignoreLeadingWords: ['i', 'fake', 'mock', 'stub', 'spy', 'dummy'],
            folderCase: 'pascal',
            // Only a folder written otherwise than in PascalCase can be one: Abstract/ is a namespace, abstract/ is not.
            reservedWords: CSHARP_KEYWORDS,
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
            'prefix-groups': [
                'error',
                { hint: 'In C# a folder is a namespace (IDE0130).', hintFor: ['*.{cs,fs,vb}'], dropPrefix: false },
            ],
            // Kept off under strict: Users/UserService is the idiom, not a repetition.
            'redundant-prefix': 'off',
        },
    },
};
