# `redundant-prefix`

Modules inside a folder do not repeat the folder's name.

**Off in `recommended`, error in `strict`.** Options and defaults: [configuration.md](../configuration.md#redundant-prefix).

<!-- output: redundant-prefix -->

```text
render/
  ✖ error  redundant-prefix  2 modules repeat the folder's name "render" (render-json, render-text):
                             the folder already says it.

✖ 1 error, 0 warnings in 1 folder (2 folders and 3 files checked; 100 % of folders within the limit
  (2/2)).
  --moves prints where each file could go; `crowded-folders explain render` shows how a folder was
    read.
```

<!-- /output -->

`render/json.ts` says "render" once. It is what [`prefix-groups`](prefix-groups.md) leads to: once the
`render-*` files are in `render/`, the prefix has nothing left to do.

- A module named exactly like the folder (`render/render.ts`) is its main file, and is fine.
- A plural folder accepts the singular: `users/user-list.ts`, `categories/category-list.ts` and
  `children/child-row.ts` repeat it; `news/new-a.ts` does not.
- A folder that glues its words is repeated too: `dayplan/DayPlanList.kt` → `dayplan/List.kt`.
- `--moves` suggests the shorter name in the file's own convention: `render-json.ts` → `json.ts`,
  `RenderText.cs` → `Text.cs`, `render_json_test.go` → `json_test.go`, `test_render_json.py` →
  `test_json.py`; never onto a name that exists, even in other case (`json.ts`, `Text.ts`).
- A name a tool reads (`naming.keepInPlace`) is not reported, and nor is any under `naming.routes`
  (Expo Router's `app/(sign)/sign-in.tsx` is the address `/sign-in`).

It is off by default because some conventions repeat the name on purpose: NestJS (`cats/cats.service.ts`
is one module, so it is not reported, but `cats/cats-admin.service.ts` would be), Flutter
(`auth/auth_repository.dart`) and Angular's file names, which mirror class names
(`user-profile/user-profile-avatar.ts`). Turn it on when your convention is the short name.

## The fix

<!-- fix: redundant-prefix -->

`--moves` prints the fix. The folder after it, and the run that passes:

```sh
git mv render/render-json.ts render/json.ts
git mv render/render-text.ts render/text.ts
```

```text
render/ json.ts, render.ts, text.ts

✔ No crowded folders (2 folders and 3 files checked; 100 % of folders within the limit (2/2)).
```

<!-- /fix -->

## Options

| Option | Default |                                                                                       |
| ------ | ------- | ------------------------------------------------------------------------------------- |
| `min`  | `2`     | How many modules have to repeat the name before it is reported; `1` reports each one. |
