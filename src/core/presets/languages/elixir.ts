import type { Preset } from '../../config/types.ts';

export const elixir: Preset = {
    description:
        "Elixir and Phoenix: mix phx.gen.html writes user_controller.ex, user_html.ex and user_json.ex (and user_controller_test.exs) for one resource, and they are one module, user. Contexts and schemas are namespaces, so a folder is a module namespace by convention, not a rule. The limits are recommended's measured 20: no Elixir guide gives a number. _build, deps and the compiled assets are left out.",
    sources: [
        {
            title: 'Phoenix: directory structure (lib/my_app_web/controllers)',
            url: 'https://hexdocs.pm/phoenix/directory_structure.html',
        },
        {
            title: 'mix phx.gen.html: a controller in controllers/user_controller.ex, an HTML view in controllers/user_html.ex',
            url: 'https://phoenix.hexdocs.pm/Mix.Tasks.Phx.Gen.Html.html',
        },
        { title: 'ExUnit: tests are *_test.exs files', url: 'https://hexdocs.pm/ex_unit/ExUnit.html' },
    ],
    detect: { files: ['mix.exs'] },
    config: {
        extends: ['recommended'],
        exclude: ['/_build', '/deps', '/cover', 'priv/static'],
        naming: { companions: ['_(?:controller|html|json|live|channel|view|test)$'] },
    },
};
