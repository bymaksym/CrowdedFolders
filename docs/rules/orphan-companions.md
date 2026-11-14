# `orphan-companions`

A file that an engine keeps next to an asset, without the asset: Unity's `.meta`, Godot's `.import` and
`.uid`.

**Off in `recommended`, error in `unity` and `godot`.** Options and defaults:
[configuration.md](../configuration.md#orphan-companions).

<!-- output: orphan-companions -->

```text
Assets/Scripts/
  ✖ error  orphan-companions  Player.cs.meta is without its asset: the asset was moved, renamed or
                              deleted outside the editor, or never committed. Move it with its
                              asset, or delete it if the asset is gone.

✖ 1 error, 0 warnings in 1 folder (3 folders and 3 files checked; 100 % of folders within the
  max-files limit (3/3)).
```

<!-- /output -->

It is the costliest merge failure in those engines, and it is silent until someone opens the project:

- **Unity:** "Meta files contain important information about how the asset is used in your project,
  and they must stay with the asset file they relate to." The `.meta` holds the ID every scene and prefab
  refers to the asset by, and "if an asset loses its .meta file, any reference to that asset is broken in
  your project": Unity makes a new `.meta`, with a new ID, and deletes the old one.
  ([Unity manual: asset metadata](https://docs.unity3d.com/Manual/AssetMetadata.html))
- **Godot:** "Importing will add an extra `<asset>.import` file next to the source file, containing the
  import configuration. Make sure to commit these files to your version control system, as these files
  contain important metadata." ([Godot: import process](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html))
  Since Godot 4.4 a script or shader also has a `.uid` file, which holds the ID other resources use
  ([Godot 4.4: UID changes](https://godotengine.org/article/uid-changes-coming-to-godot-4-4/)).

`X.meta` goes with the file **or folder** `X` (Unity writes a `.meta` for each folder too), in the same
folder. A companion whose asset is in the repository but left out of the check (`Assets/Plugins.meta`
with `Assets/Plugins` excluded) is not an orphan. An asset that differs only in case (`player.cs` and
`Player.cs.meta`) is reported, and the message says so: Linux and git tell them apart.

## The fix

<!-- fix: orphan-companions -->

No move makes this decision: it is a person who does. After it, the files are these, and the run passes:

```text
Assets/Scripts/ Enemy.cs, Enemy.cs.meta, Player.cs, Player.cs.meta

✔ No crowded folders (3 folders and 4 files checked; 100 % of folders within the max-files limit
```

<!-- /fix -->

## Empty folders

Git stores no empty folder, so the `.meta` of an empty folder is committed alone. Unity's manual says what
happens: "If Unity detects a new .meta file for a folder, but that folder doesn't exist locally, it assumes
another user in your VCS created a new folder", and makes it. That is not a broken reference, so a
companion of a name without an extension (`Glade.meta`) is taken for a folder's and not reported;
`explain` lists it. `emptyFolders: true` reports them too.

## In the field trial

None. UnityTechnologies/open-project-1 has 3,649 `.meta` files and three without their asset, all three
of empty folders (`AddressableAssetsData/OSX.meta`, `Dialogue System/Dialogues.meta`,
`GeneralMapMediumMultipleScenes/Glade.meta`); godot-demo-projects has 840 `.import` and 538 `.uid`
files, each with its asset. It is an error in the engine presets on the engines' own words, not on a
count: what it finds breaks references.
