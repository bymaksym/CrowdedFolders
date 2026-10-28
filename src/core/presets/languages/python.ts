import type { Preset } from '../../config/types.ts';

/** A package of that name cannot be imported: `import utils.async` is a syntax error. Soft keywords (match, type) can. */
const PYTHON_KEYWORDS = [
    'and as assert async await break class continue def del elif else except',
    'finally for from global if import in is lambda nonlocal not or pass',
    'raise return try while with yield False None True',
].flatMap(line => line.split(' '));

export const python: Preset = {
    description:
        'Recommended, read the way pytest names tests: test_parser.py and parser_test.py are the module parser, and __init__.py, which is the package itself, does not count. tests/ mirrors the package, so it is not asked to group on its own — split the package and the tests follow. A move names the package in snake_case, as PEP 8 asks, and never after a keyword: async_* goes to asyncs/, not to an async/ no import can name.',
    sources: [
        { title: 'PEP 8: package and module names', url: 'https://peps.python.org/pep-0008/' },
        { title: 'Python: keywords', url: 'https://docs.python.org/3/reference/lexical_analysis.html#keywords' },
        {
            title: 'pytest: good practices, test discovery (test_*.py or *_test.py)',
            url: 'https://docs.pytest.org/en/stable/explanation/goodpractices.html',
        },
    ],
    detect: { files: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'] },
    config: {
        extends: ['recommended'],
        exclude: [
            '__pycache__',
            '.venv',
            'venv',
            '.tox',
            '.nox',
            '.mypy_cache',
            '.pytest_cache',
            '.ruff_cache',
            '*.egg-info',
        ],
        // __init__.py makes the folder a package and holds what it exports: it is the folder, not one more module in it.
        naming: {
            companions: ['^test_', '_test$', '_tests$'],
            folderFiles: ['__init__.py', '__init__.pyi'],
            folderCase: 'snake',
            reservedWords: PYTHON_KEYWORDS,
        },
        overrides: [
            {
                folders: ['tests', 'tests/**', '**/tests', '**/tests/**'],
                reason: 'Tests mirror the package they test: when the package splits, they follow it.',
                rules: { 'prefix-groups': 'off' },
            },
        ],
    },
};

export const django: Preset = {
    description:
        "Python, plus Django: each app keeps models.py, views.py, admin.py… side by side by convention, and migrations stay flat and numbered (Django's answer to too many is squashing, not folders). management/commands and templatetags stay flat too (the file name is the command, the module the tag library), and templates/ keeps the <app>/<model>_list.html names ListView looks for.",
    sources: [
        { title: 'Django: applications', url: 'https://docs.djangoproject.com/en/5.2/ref/applications/' },
        { title: 'Django: migrations (squashing)', url: 'https://docs.djangoproject.com/en/5.2/topics/migrations/' },
        {
            title: 'Django: custom management commands (management/commands/<name>.py, run as manage.py <name>)',
            url: 'https://docs.djangoproject.com/en/5.2/howto/custom-management-commands/',
        },
        {
            title: 'Django: custom template tags (a templatetags package in the app)',
            url: 'https://docs.djangoproject.com/en/5.2/howto/custom-template-tags/',
        },
    ],
    detect: { files: ['manage.py'], dependencies: [] },
    config: {
        extends: ['python'],
        // manage.py names the commands by their files, and Django loads template tags by library name.
        exclude: ['/static', '/media', '/staticfiles', '**/management/commands', '**/templatetags'],
        overrides: [
            {
                folders: ['**/templates/**'],
                reason: 'ListView looks for orders/templates/orders/order_list.html by default (<app>/<model>_list.html): the name repeats the folder because Django asks for it.',
                rules: { 'redundant-prefix': 'off' },
            },
        ],
    },
};
