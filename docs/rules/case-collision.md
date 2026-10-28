# `case-collision`

Two files or folders of one folder whose names differ only in case, or in Unicode normalisation.

**Off in `recommended`, error in `strict`.**

```text
src/
  Components/  components/  Foo.ts  foo.ts

  ✖ error  case-collision  "Components/" and "components/" are one name on a disk that ignores case
           (Windows, macOS): git cannot check them out side by side there. Rename one, or join them.
```

Linux keeps both; Windows and macOS have one name for them, so a checkout there gets one folder with
the files of both, or one file that overwrites the other. `café` typed on macOS (NFD) and elsewhere
(NFC) is the same case: two names in git, one on the Mac's disk.

crowded-folders reads names the same on every machine, so it counts `Foo.ts` and `foo.ts` as two
modules, the way git keeps them, and this rule says why that is a problem on the other systems.

It is off in `recommended` because a new rule on by default would fail repositories that passed (see
[decisions.md](../decisions.md#what-a-version-promises)). Turn it on when anyone checks the repository out
on Windows or macOS.

## Options

None.
