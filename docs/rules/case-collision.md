# `case-collision`

Two files or folders of one folder whose names differ only in case, or in Unicode normalisation.

**Off in `recommended`, error in `strict`.**

<!-- output: case-collision -->

```text
src/
  ✖ error  case-collision  "Components/" and "components/" are one name on a disk that ignores case
                           (Windows, macOS): git cannot check them out side by side there. Rename
                           one, or join them.
  ✖ error  case-collision  "Foo.ts" and "foo.ts" are one name on a disk that ignores case (Windows,
                           macOS): git cannot check them out side by side there. Rename one, or join
                           them.

✖ 2 errors, 0 warnings in 1 folder (4 folders and 4 files checked; 100 % of folders within the
  max-files limit (4/4)).
```

<!-- /output -->

Linux keeps both; Windows and macOS have one name for them, so a checkout there gets one folder with
the files of both, or one file that overwrites the other. `café` typed on macOS (NFD) and elsewhere
(NFC) is the same case: two names in git, one on the Mac's disk.

crowded-folders reads names the same on every machine, so it counts `Foo.ts` and `foo.ts` as two
modules, the way git keeps them, and this rule says why that is a problem on the other systems.

It is off in `recommended` because a new rule on by default would fail repositories that passed (see
[decisions.md](../decisions.md#what-a-version-promises)). Turn it on when anyone checks the repository out
on Windows or macOS.

## The fix

<!-- fix: case-collision -->

No move makes this decision: it is a person who does. After it, the files are these, and the run passes:

```text
src/components/ Button.ts, Card.ts
src/ foo-helpers.ts, Foo.ts

✔ No crowded folders (3 folders and 4 files checked; 100 % of folders within the max-files limit
```

<!-- /fix -->

## Options

None.
