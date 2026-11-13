# `max-folders`

A folder holds at most `max` subfolders: a long list of folders is a junk drawer too.

**Off in `recommended`, error at 20 in `strict`.** Options and defaults: [configuration.md](../configuration.md#max-folders).

<!-- output: max-folders -->

```text
src/features/
  ✖ error  max-folders  34 subfolders, over the limit of 20 (accordion, alert, avatar, badge, banner
                        and 29 more): group them by what they are about.

✖ 1 error, 0 warnings in 1 folder (37 folders and 68 files checked; 100 % of folders within the
  limit (37/37)).
```

<!-- /output -->

It is off by default because some folders are long lists by nature — `packages/` of a monorepo,
`routes/`, one folder per locale — and it has not been measured on the [field trial](../field-trial.md)
yet. Turn it on with overrides for those folders.

## The fix

<!-- fix: max-folders -->

No move makes this decision: it is a person who does. After it, the files are these, and the run passes:

```text
src/features/display/accordion/ accordion.ts, index.ts
src/features/display/avatar/ avatar.ts, index.ts
src/features/display/button/ button.ts, index.ts
src/features/display/calendar/ calendar.ts, index.ts
src/features/display/card/ card.ts, index.ts
src/features/display/carousel/ carousel.ts, index.ts
src/features/display/divider/ divider.ts, index.ts
src/features/display/icon/ icon.ts, index.ts
src/features/display/list/ index.ts, list.ts
src/features/display/table/ index.ts, table.ts
src/features/feedback/alert/ alert.ts, index.ts
src/features/feedback/badge/ badge.ts, index.ts
src/features/feedback/banner/ banner.ts, index.ts
src/features/feedback/chip/ chip.ts, index.ts
src/features/feedback/progress/ index.ts, progress.ts
src/features/feedback/skeleton/ index.ts, skeleton.ts
src/features/feedback/spinner/ index.ts, spinner.ts
src/features/forms/checkbox/ checkbox.ts, index.ts
src/features/forms/form/ form.ts, index.ts
src/features/forms/input/ index.ts, input.ts
src/features/forms/radio/ index.ts, radio.ts
src/features/forms/select/ index.ts, select.ts
src/features/forms/slider/ index.ts, slider.ts
src/features/forms/switch/ index.ts, switch.ts
src/features/navigation/breadcrumb/ breadcrumb.ts, index.ts
src/features/navigation/pagination/ index.ts, pagination.ts
src/features/navigation/tabs/ index.ts, tabs.ts
src/features/overlays/dialog/ dialog.ts, index.ts
src/features/overlays/drawer/ drawer.ts, index.ts
src/features/overlays/dropdown/ dropdown.ts, index.ts
src/features/overlays/menu/ index.ts, menu.ts
src/features/overlays/modal/ index.ts, modal.ts
src/features/overlays/popover/ index.ts, popover.ts
src/features/overlays/tooltip/ index.ts, tooltip.ts

✔ No crowded folders (42 folders and 68 files checked; 100 % of folders within the limit (42/42)).
```

<!-- /fix -->

## Options

| Option | Default |                                  |
| ------ | ------- | -------------------------------- |
| `max`  | `30`    | How many subfolders it may hold. |
