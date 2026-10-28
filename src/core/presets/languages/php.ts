import type { Preset } from '../../config/types.ts';

export const php: Preset = {
    description:
        'PHP with Composer (Laravel, Symfony): a folder is a PSR-4 namespace and there is one class per file, hence 20. Laravel sorts app/Models and app/Http/Controllers by type, so they get more room. UserTest is User. A move proposes the folder in PascalCase, as the namespace is written, and keeps the file names, which are the class names.',
    sources: [
        { title: 'PSR-4: autoloading', url: 'https://www.php-fig.org/psr/psr-4/' },
        { title: 'Laravel: directory structure', url: 'https://laravel.com/docs/12.x/structure' },
    ],
    detect: { files: ['composer.json'] },
    config: {
        extends: ['recommended'],
        exclude: ['storage', 'bootstrap/cache', 'public/build'],
        naming: { companions: ['Test$'], folderCase: 'pascal' },
        rules: {
            'max-files': [
                'error',
                { max: 20, count: 'modules', hint: 'A folder is a PSR-4 namespace.', hintFor: ['*.php'] },
            ],
            'prefix-groups': [
                'error',
                { hint: 'A folder is a PSR-4 namespace.', hintFor: ['*.php'], dropPrefix: false },
            ],
        },
        overrides: [
            {
                folders: ['app/Models', 'app/Http/Controllers'],
                reason: 'Laravel sorts these by type by default.',
                rules: { 'max-files': ['error', { max: 40 }] },
            },
        ],
    },
};
