import type { Preset } from '../../config/types.ts';

export const flutter: Preset = {
    description:
        "Flutter and Dart: feature-first under lib/ui, foo_test.dart is foo, and the generated platform folders and localisation files are left out. Flutter's own architecture guide organises lib/data by type on purpose, so it is given more room.",
    sources: [
        { title: 'Effective Dart: style (file names)', url: 'https://dart.dev/effective-dart/style' },
        {
            title: 'Flutter: app architecture case study (ui by feature, data by type)',
            url: 'https://docs.flutter.dev/app-architecture/case-study',
        },
        {
            title: 'mockito: "we import the generated library as cat_test.mocks.dart"',
            url: 'https://pub.dev/packages/mockito',
        },
        {
            title: 'injectable: the generated file is file_name.config.dart',
            url: 'https://pub.dev/packages/injectable',
        },
        {
            title: 'Flutter: internationalization, one .arb file per language',
            url: 'https://docs.flutter.dev/ui/accessibility-and-localization/internationalization',
        },
        {
            title: "json_serializable: generated code goes in a part file, part 'example.g.dart'",
            url: 'https://pub.dev/packages/json_serializable',
        },
    ],
    detect: { files: ['pubspec.yaml'] },
    config: {
        extends: ['recommended'],
        exclude: [
            '.dart_tool',
            '/build',
            '/android',
            '/ios',
            '/web',
            '/windows',
            '/linux',
            '/macos',
            // Also when the app is not at the root (localsend's app/lib/gen/strings_*.g.dart).
            '**/lib/l10n',
            '**/lib/generated',
            '*.g.dart',
            '*.freezed.dart',
            // build_runner generators write next to the source: auto_route, mockito, injectable, the
            // asset generator, protobuf and chopper. (A hand-written app.config.dart is left out too.)
            '*.gr.dart',
            '*.mocks.dart',
            '*.config.dart',
            '*.gen.dart',
            '*.pb*.dart',
            '*.chopper.dart',
            // gen-l10n reads one .arb per language, in any folder.
            '*.arb',
        ],
        naming: { companions: ['_test$'] },
        overrides: [
            {
                folders: ['lib/data/**'],
                reason: 'The Flutter architecture guide organises the data layer by type: "The data folder organizes code by type".',
                rules: { 'max-files': ['error', { max: 30 }], 'prefix-groups': 'warn' },
            },
        ],
    },
};
