# `max-files`

A folder holds at most `max` modules (or files). Past that it is scrolled, not read.

**On in `recommended`:** error, 20 modules. Options and defaults: [configuration.md](../configuration.md#max-files).

## What counts

By default a **module**: a file together with its companions, the files that share its stem.
`button.tsx`, `button.spec.tsx`, `button.html` and `button.scss` are one module, not four. So the 68 files
of this folder, a component and its test each, are 34 modules:

<!-- output: max-files -->

```text
src/components/
  ✖ error  max-files  34 modules, over the limit of 20: split it into folders by what the files are
                      about.

✖ 1 error, 0 warnings in 1 folder (3 folders and 68 files checked; 67 % of folders within the limit
  (2/3)).
```

<!-- /output -->

So an Angular component weighs what a Go file weighs. `count: "files"` counts every file instead.

Files whose name starts with a dot (`.gitignore`, `.editorconfig`) are not counted unless
`dotfiles: true`: they are tool settings that have to live where the tool looks.

## Why 20

It is the median 95th percentile of folder sizes over the 30 repositories of the
[field trial](../field-trial.md): about the biggest folder in twenty of a typical project. Small,
tidy projects (ripgrep, httpx, axum) have none over it.

Where a guide gives a number, its preset uses it: `angular` uses 10 (the former Angular style guide:
"Consider creating sub-folders when a folder reaches seven or more files… when a folder has ten or
more files, it may be time"); `vue` allows 100 in `components/` ("very large apps (e.g. 100+
components)"). The root gets 40 in `recommended`: manifests, lockfiles and configs live there because
their tools look for them there.

## The fix

Split by what the files are _about_ (`checkout/`, `catalog/`), not by what they _are_
(`components/`, `services/`): Angular's guide says it outright, and a folder per type just moves the
crowd. [`prefix-groups`](prefix-groups.md) usually points at the first folder to make.

<!-- fix: max-files -->

No move makes this decision: it is a person who does. After it, the files are these, and the run passes:

```text
src/components/display/ accordion.spec.tsx, accordion.tsx, avatar.spec.tsx, avatar.tsx,
  button.spec.tsx, button.tsx, calendar.spec.tsx, calendar.tsx, card.spec.tsx, card.tsx,
  carousel.spec.tsx, carousel.tsx, divider.spec.tsx, divider.tsx, icon.spec.tsx, icon.tsx,
  list.spec.tsx, list.tsx, table.spec.tsx, table.tsx
src/components/feedback/ alert.spec.tsx, alert.tsx, badge.spec.tsx, badge.tsx, banner.spec.tsx,
  banner.tsx, chip.spec.tsx, chip.tsx, progress.spec.tsx, progress.tsx, skeleton.spec.tsx,
  skeleton.tsx, spinner.spec.tsx, spinner.tsx
src/components/forms/ checkbox.spec.tsx, checkbox.tsx, form.spec.tsx, form.tsx, input.spec.tsx,
  input.tsx, radio.spec.tsx, radio.tsx, select.spec.tsx, select.tsx, slider.spec.tsx, slider.tsx,
  switch.spec.tsx, switch.tsx
src/components/navigation/ breadcrumb.spec.tsx, breadcrumb.tsx, pagination.spec.tsx, pagination.tsx,
  tabs.spec.tsx, tabs.tsx
src/components/overlays/ dialog.spec.tsx, dialog.tsx, drawer.spec.tsx, drawer.tsx, dropdown.spec.tsx,
  dropdown.tsx, menu.spec.tsx, menu.tsx, modal.spec.tsx, modal.tsx, popover.spec.tsx, popover.tsx,
  tooltip.spec.tsx, tooltip.tsx

✔ No crowded folders (8 folders and 68 files checked; 100 % of folders within the limit (8/8)).
```

<!-- /fix -->

## Two limits: warn early, fail late

A warning never fails the run, so `{ "max": 20, "warnAbove": 10 }` can go into CI the day it is
adopted: a folder of 21 fails, and the folders between 11 and 20 are still listed, as warnings, for
whoever wants to look. Without it, the choice is a limit low enough to be useful and red in CI, or
one high enough to pass and silent about everything below it.

```jsonc
"rules": { "max-files": ["error", { "max": 20, "warnAbove": 10 }] }
```

## Options

| Option      | Default                                            |                                                                                                               |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `max`       | `20`                                               | How many it may hold.                                                                                         |
| `count`     | `"files"` in the rule, `"modules"` in every preset | What is counted.                                                                                              |
| `dotfiles`  | `false`                                            | Whether dot-files count.                                                                                      |
| `warnAbove` | `0` (none)                                         | A second, lower limit: over it and within `max` is a warning; only over `max` does the rule's severity apply. |
| `hint`      | `""`                                               | Added to the message: what a folder costs in this ecosystem (presets use it: "In Go a folder is a package").  |
| `hintFor`   | `[]`                                               | Globs of file names: the hint is added only when the files counted include one (`*.java`). Default: always.   |
