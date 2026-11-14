# `single-file-folders`

A folder that holds one file and no subfolders is a level of nesting with nothing to group.

**Off in `recommended`, warning in `strict`.**

| Option    | Default | Meaning                                                                                                                                                                                                               |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowed` | `[]`    | Globs of files that may be alone in their folder because something outside requires it: `main.go` of a Go command, `lib.rs` of a crate. A name without `/` matches at any depth; with `/` it is a path from the root. |

<!-- output: single-file-folders -->

```text
src/utils/date/
  ⚠ warn   single-file-folders  holds only format.ts: a folder with nothing to group is one more
                                level to open.

⚠ 0 errors, 1 warning in 1 folder (4 folders and 3 files checked; 100 % of folders within the
  max-files limit (4/4)).
```

<!-- /output -->

It is the other side of [`max-files`](max-files.md): a tool that says "split" pushes some people to
split too early. The former Angular style guide's "Flat" rule — "keep a flat folder structure as long
as possible" — and React's "avoid too much nesting" say the same.

It is off by default because many conventions put a single file in a folder on purpose: a route in
Next.js (`app/about/page.tsx`), a component folder with an `index.ts`, a Go package with one file.

## The fix

<!-- fix: single-file-folders -->

No move makes this decision: it is a person who does. After it, the files are these, and the run passes:

```text
src/utils/ array.ts, date-format.ts, string.ts

✔ No crowded folders (3 folders and 3 files checked; 100 % of folders within the max-files limit
```

<!-- /fix -->
