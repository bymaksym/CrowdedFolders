# `type-folders`

A folder of a game project named after a type of asset: `Textures/`, `Materials/`, `Meshes/`, `Assets/`.

**Off in `recommended`; a warning in `unreal` (under `Content/`) and `godot` (without `assets`).**
Options and defaults: [configuration.md](../configuration.md#type-folders).

```text
Content/ActionRoguelike/Materials/
  MF_HitFlashDemo.uasset  MI_RageBar.uasset  M_3DFont.uasset

  ⚠ warn  type-folders  "Materials" is named after the type of its assets, not what they are for: put
          each next to what uses it (Rocks/ with its mesh, textures and materials), where the editor's
          type filter finds it. Allar 2.6.2: "Creating a folder named Meshes, Textures, or Materials is
          redundant."
```

A rock's mesh, textures and materials in `Meshes/`, `Textures/` and `Materials/` are one rock in three
folders, and the editor already filters by type.

## The sources

- **Unreal**, [Allar's UE5 style guide](https://github.com/Allar/ue5-style-guide#2.6), 2.6 "Do Not Create
  Folders Called `Assets` or `AssetTypes`": "2.6.1 Creating a folder named `Assets` is redundant. All
  assets are assets." and "2.6.2 Creating a folder named `Meshes`, `Textures`, or `Materials` is redundant
  … These folders offer only redundant information and the use of these folders can easily be replaced
  with the robust and easy to use filtering system the Content Browser provides." Those four are the
  defaults. Its own exceptions are not matched: very large sets of animations and audio get their own
  folders (2.7, `Characters/Common/Animations`), and shared materials live in `MaterialLibrary` (2.8).
- **Godot**, [project organization](https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html):
  "the most common approach is to group assets as close to scenes as possible; when a project grows, it
  makes it more maintainable." The guide names no folder to avoid, so the list is Allar's, read from
  Godot's advice rather than quoted from it, and without `assets`: `res://assets/` is the usual root of a
  Godot project, and the guide's own example has a `models/` folder.
- **Unity** is not included: its guide splits a project by asset type (`Materials/`, `Prefabs/`).

The name is compared as words, singular or plural, in any case: `textures` matches `Textures/` and
`texture/`, not `MaterialLibrary/` or `StaticMeshes/`.

## Why a warning, and why not elsewhere

In the [field trial](../field-trial.md) it gives 18 warnings in `tomlooman/ActionRoguelike` (many in the
Mannequin content Epic's templates ship) and 29 in godot-demo-projects (`textures/` next to a demo's
scene, mostly). A type folder costs tidying, not a build, and the guide's 2.7 makes exceptions, so it
warns, like the limits of the `unreal` preset. Outside games the same names are something else: Angular's
`src/material` is Angular Material, and every web project has an `assets/` folder — on all 36
repositories, with its four default names, it reports 104 folders, 43 of them in repositories without
the `unreal` or `godot` preset (13 in the Unity project, 30 in web, server and engine code).

```jsonc
{ "rules": { "type-folders": ["warn", { "names": ["!assets", "sprites"] }] } }
```
