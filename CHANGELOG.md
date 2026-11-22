# Changelog

## [2.0.0](https://github.com/bymaksym/CrowdedFolders/compare/v1.0.1...v2.0.0) (2026-11-22)


### ⚠ BREAKING CHANGES

* **presets:** the unity, godot and unreal presets are detected, so a Unity or Godot project with a .meta or .import left without its asset now fails, and Unreal and Godot projects get warnings for type folders.
* reading names finds some groups and folders it did not before, in the default configuration. Singular and plural group together (mastodon: accounts with account_notes; docusaurus: Doc* with Docs*), and a folder of versions counts each version (git's Documentation/RelNotes: 543 modules instead of a handful). Suppression keys change where a name is read differently (IProfile was in the group "i" and is in "profile"); run --prune-suppressions after updating.

### Features

* **action:** comment: true keeps one comment on the pull request ([ef7256e](https://github.com/bymaksym/CrowdedFolders/commit/ef7256e3f932fc740074c31701f266e38d33235b))
* **action:** sarif upload, category, fail-on, outputs and a single run ([ecdfa7e](https://github.com/bymaksym/CrowdedFolders/commit/ecdfa7ee457810e3927e0aa8ced748c94b78fb45))
* **agents:** add the Claude Code hook and init --agents ([1386f08](https://github.com/bymaksym/CrowdedFolders/commit/1386f08f7c09fa507566d05e7dfcbd7631789711))
* **agents:** ship a skill and a Claude Code plugin in the package ([e8cfdcb](https://github.com/bymaksym/CrowdedFolders/commit/e8cfdcb754001af5531629641d559e174420fbb3))
* **api:** lint() as the command runs it, createLinter, and crowded-folders/engine ([0e5b663](https://github.com/bymaksym/CrowdedFolders/commit/0e5b66360df686deed1f28d1a1af75c8d98bb798))
* **build:** single-file binaries with Node SEA, built on release ([ed35394](https://github.com/bymaksym/CrowdedFolders/commit/ed35394d677035d861b3d1e42a7dc5e35fdc6312))
* **cli:** --project, package configurations, per-folder presets, overrides, --no-code ([ef3fee2](https://github.com/bymaksym/CrowdedFolders/commit/ef3fee2e57b1ce903afe741f402b90000792db87))
* **cli:** add the where command ([3171ead](https://github.com/bymaksym/CrowdedFolders/commit/3171ead839bd4c91e45047d0825399193f3086d3))
* **cli:** annotations with a base say what the change adds to a folder over its limit ([6b3f4cb](https://github.com/bymaksym/CrowdedFolders/commit/6b3f4cbb3dd33b9dc61b5e8c188ffdb73881e9f2))
* **cli:** explain --prompt writes the reorganisation task for an agent ([d5a6b53](https://github.com/bymaksym/CrowdedFolders/commit/d5a6b53c406c9fe6f5e3c84b7b1b7870622caf55))
* **cli:** explain says where each value comes from and why a folder is not checked ([983acbc](https://github.com/bymaksym/CrowdedFolders/commit/983acbc7072d4bfe04b0ccb1b70d3beef4fe6c7c))
* **cli:** history, --compare-config, and new/grew/improved against a base ([1afb54c](https://github.com/bymaksym/CrowdedFolders/commit/1afb54c3f03e5d4d0c89ed2e7cf5acb0c1f26654))
* **cli:** init writes where it is told, pins the schema and leaves one line to type ([cd8520c](https://github.com/bymaksym/CrowdedFolders/commit/cd8520c4ab7e85771da2260aa9a0080f246a2efa))
* **cli:** print moves that run, alone when asked, with what they break ([5903181](https://github.com/bymaksym/CrowdedFolders/commit/590318105753d899cf378707ece30bbc531db566))
* **cli:** refuse unknown, repeated and misplaced options, and add --tracked-only ([a1431fd](https://github.com/bymaksym/CrowdedFolders/commit/a1431fddd1b9b8d3c78d8d51f7b79e0509de6ca5))
* **cli:** say what --quiet hides, wrap the report to the terminal, words without a terminal ([aab1279](https://github.com/bymaksym/CrowdedFolders/commit/aab1279868bda84df4fbbba3994082f6c425f9e6))
* **cli:** say whose rule broke, and list the rules and presets of plugins ([cdd996c](https://github.com/bymaksym/CrowdedFolders/commit/cdd996c3983044065c48df4928d4134137bcb0f7))
* **cli:** the tree command, --format html, badge and tree, and a note for tiny files ([410cb43](https://github.com/bymaksym/CrowdedFolders/commit/410cb43ceeaa9b522fe7fe8e355142f76388053b))
* **config:** ".*/" leaves out folders only, and dotfiles: true says what it needs ([5ff4157](https://github.com/bymaksym/CrowdedFolders/commit/5ff41576724f82734f1a3ab8598ce995fd051c75))
* **config:** check reasons, duplicate keys and "!" in folders; expires, owner and ticket ([a46ce20](https://github.com/bymaksym/CrowdedFolders/commit/a46ce20c0e2119ed1b373806384ddbe5135ace37))
* **config:** files that describe their folder, and options that can never match ([7e573a2](https://github.com/bymaksym/CrowdedFolders/commit/7e573a203e3d85fee93f69ba66c52342d9840a35))
* **config:** presets under some folders, package configurations, and strict in any order ([cd41add](https://github.com/bymaksym/CrowdedFolders/commit/cd41add1763a12520201ab720b0bbe0b5b41052e))
* **core:** guard what rules see and report, and allow tree rules ([2daca4d](https://github.com/bymaksym/CrowdedFolders/commit/2daca4d97c564bdd444b638d904ee96660f6a029))
* **core:** read .gitignore files without git, and suggest the closest name ([fcf107f](https://github.com/bymaksym/CrowdedFolders/commit/fcf107f5a713be981602ef9a10eb0691c6482933))
* **core:** resolveConfig, so runEngine works with a configuration written by hand ([8566f12](https://github.com/bymaksym/CrowdedFolders/commit/8566f12cdb25a94f7b38e61d504df0ec386deb1b))
* **core:** say what a new file would do to its folder ([890bab3](https://github.com/bymaksym/CrowdedFolders/commit/890bab3b1dce909b15559b0688fe3d3f00fb5e2d))
* **core:** the folder tree, treemap layout, health figure and field-trial comparison ([b14709c](https://github.com/bymaksym/CrowdedFolders/commit/b14709cf7072f407218187e872be232ac2d41b6d))
* documentation that cannot drift from the command (points 196-206) ([3341c1b](https://github.com/bymaksym/CrowdedFolders/commit/3341c1b6dfbbf67a0537455ffea9008312300fcc))
* **eslint:** crowded-folders/eslint, the analysis as a flat-config ESLint plugin ([c37aefc](https://github.com/bymaksym/CrowdedFolders/commit/c37aefc8e6312fcf22af9e6a596e49b5a07936f3))
* **explain:** say what is not reported, and why ([5de3e00](https://github.com/bymaksym/CrowdedFolders/commit/5de3e000104f6ae6112aaecf723eeb99f3068351))
* **explain:** suggest linguist-generated for names that look generated ([4d2940d](https://github.com/bymaksym/CrowdedFolders/commit/4d2940da557cac185b31a551f41e1f8b8772911e))
* let presets say where a hint, a lone file or an override applies ([56d102e](https://github.com/bymaksym/CrowdedFolders/commit/56d102e7b6c752824b4315caba790095636cfb9b))
* **max-files:** warnAbove, a second limit that warns before max fails ([342c0e2](https://github.com/bymaksym/CrowdedFolders/commit/342c0e2145078c47c90d98c3aa4106899805e293))
* **moves:** propose moves that keep the project working ([305f71a](https://github.com/bymaksym/CrowdedFolders/commit/305f71a047abd798e29413ff40a4b6dbb96f1db9))
* **plugins:** check a plugin's rules and version when it loads, and find it as Node would ([583b5d2](https://github.com/bymaksym/CrowdedFolders/commit/583b5d2c88c1d2d8584a9b0265c60ffda1208e8a))
* **presets:** add protobuf, elixir (Phoenix), scala and bazel ([c2cc9fd](https://github.com/bymaksym/CrowdedFolders/commit/c2cc9fdcf11f1d4e7db4e7db64d198af1ec10fa8))
* **presets:** anchor outputs, recognise migrations by name, fix JVM, .NET and Swift ([00ab6da](https://github.com/bymaksym/CrowdedFolders/commit/00ab6da3cac6e0798371d19db08c93111a863f3a))
* **presets:** angular takes recommended's 20, with 10 only under features/ ([57d9fdd](https://github.com/bymaksym/CrowdedFolders/commit/57d9fdd2165bc41c8bf8701389779f68a5d0ff33))
* **presets:** generated code and flat folders for go, rust, django and flutter ([9858204](https://github.com/bymaksym/CrowdedFolders/commit/9858204a949c57e58839ab9e5c19eb832b90391d))
* **presets:** orphan-companions in unity and godot, type-folders in unreal and godot ([027631b](https://github.com/bymaksym/CrowdedFolders/commit/027631ba07fffa9eaf961c9b670a9383cf2be3a3))
* **presets:** unity, unreal and godot data, and detection that drops redundant parents ([ce740d0](https://github.com/bymaksym/CrowdedFolders/commit/ce740d01d35dfe074cf9ddf6b54a295954eb2417))
* **report:** safe, stable, relative machine formats and three new ones ([f989732](https://github.com/bymaksym/CrowdedFolders/commit/f989732f63e1fb7e66bad8413e98719958e9d081))
* **rules:** case-collision, for names that are one on Windows and macOS ([f1a2b44](https://github.com/bymaksym/CrowdedFolders/commit/f1a2b44822e445ae0c27cfde682f7efba5cbafb0))
* **rules:** scattered-feature, orphan-companions and type-folders ([e24daaa](https://github.com/bymaksym/CrowdedFolders/commit/e24daaa14f79d8d4d7eb32ee45784389d60d49ab))
* **suppressions:** judge only the folders checked, and compare with a base ([3942ce2](https://github.com/bymaksym/CrowdedFolders/commit/3942ce2efb16504c25dc1731926924144f33c5fd))
* **testing:** a RuleTester for plugin rules ([d252e1a](https://github.com/bymaksym/CrowdedFolders/commit/d252e1a760af2ae56abe82953dcb113de1815e1a))


### Bug Fixes

* **agents:** say junk drawer in the reorganisation prompt and the docs ([1c03fa3](https://github.com/bymaksym/CrowdedFolders/commit/1c03fa3f4be3d3a621b61f70e134aa32c17ca829))
* **angular:** do not propose a name that redundant-prefix would flag ([40c6eaa](https://github.com/bymaksym/CrowdedFolders/commit/40c6eaa8bd2043b12442ff2c43516a90a3d57f7a))
* **angular:** give the "by type" hint only to folders named after a type ([3934730](https://github.com/bymaksym/CrowdedFolders/commit/3934730835dbc832dc7c179d208605ff4808af27))
* **api:** read lint({ files }) the way the command does ([3990aae](https://github.com/bymaksym/CrowdedFolders/commit/3990aae346a64fcc5b09177941a157c2cc44735c))
* **check:** refuse to write suppressions when no rule is on ([fabe951](https://github.com/bymaksym/CrowdedFolders/commit/fabe951ac4553b4948c662eca49f85936fd4aed6))
* **cli:** a mistake of the user is exit 2 with its cause, and a config error links to its line ([e6e1798](https://github.com/bymaksym/CrowdedFolders/commit/e6e17981d62f3b9211a58b44d45ffd16cb5d8212))
* **cli:** apply --preset everywhere when it was detected only in a subfolder ([8c886b5](https://github.com/bymaksym/CrowdedFolders/commit/8c886b543e4c318a99f143758ee37f90f5f4d9b5))
* **cli:** name the last item instead of "and 1 more" in explain, overrides and markdown ([a0e9afa](https://github.com/bymaksym/CrowdedFolders/commit/a0e9afa4c003002893025451576cb61fb1a1c2ee))
* **cli:** never write a failed run's report over a file the run refused ([ed7ef8e](https://github.com/bymaksym/CrowdedFolders/commit/ed7ef8e92ef02a1512785f6a10371ef917291141))
* **cli:** recognise CI systems that do not set CI, and say which variable ([8709492](https://github.com/bymaksym/CrowdedFolders/commit/87094920091c1b86d211d0c2fe448875407a94e3))
* **cli:** refuse an option of one format when no report of that format is asked for ([f384e63](https://github.com/bymaksym/CrowdedFolders/commit/f384e631748bae95b74b7e81589ca725b967acf7))
* **cli:** refuse folders that name nothing, and read --root from its configuration ([767002e](https://github.com/bymaksym/CrowdedFolders/commit/767002e319e2f4924bf7cb9456c08d8e35102d88))
* **cli:** say why a file cannot be written when tidying up fails too ([f3a9e57](https://github.com/bymaksym/CrowdedFolders/commit/f3a9e57c0e8d8e179b06e3135885d42a6062860c))
* **cli:** show configuration and report paths from the current folder, not absolute ([b6fae72](https://github.com/bymaksym/CrowdedFolders/commit/b6fae7244c37f2d7a2d499f4b66bbdec65b5ccdf))
* **cli:** write prose symbols in ASCII when the output is not a terminal ([6c042fd](https://github.com/bymaksym/CrowdedFolders/commit/6c042fdcfddc5d41ad9b7b523de8de8758da5ef8))
* **config:** let "!x" in a rule's options take x out of the rule's defaults ([5c60c7c](https://github.com/bymaksym/CrowdedFolders/commit/5c60c7c848eb8dd0a82c1f9ac080a8e6d9d727f6))
* **core:** keep the name of an open folder clear of its count on the map ([99d9230](https://github.com/bymaksym/CrowdedFolders/commit/99d9230ca9ac8841689edca6a27fb853604d073f))
* **core:** match globs that could backtrack in linear time ([08fc35f](https://github.com/bymaksym/CrowdedFolders/commit/08fc35fdd9263666b0b5f2f26b605ea9a36681a0))
* **core:** read include like exclude, and check only the folders asked for ([5d0c0fd](https://github.com/bymaksym/CrowdedFolders/commit/5d0c0fdd9a45f2753509478a90c5e50e603a52f5))
* **django:** let strict keep management/__init__.py alone ([78dee61](https://github.com/bymaksym/CrowdedFolders/commit/78dee613053d4892de386e81c832c9f6b5589c17))
* **explain:** list the unreported groups instead of claiming no shared word ([d908072](https://github.com/bymaksym/CrowdedFolders/commit/d908072e3e13f1d65954e28f14cd001f6954580f))
* **init:** read every package.json to detect presets, and say when it stops ([fd7f03e](https://github.com/bymaksym/CrowdedFolders/commit/fd7f03ea16e5e637362a9ae400e715de6a0630b9))
* **moves:** skip names with control characters and say why a folder has nothing to move ([98ea72f](https://github.com/bymaksym/CrowdedFolders/commit/98ea72f79811e887a750317a5b727f5b851b6a2d))
* **naming:** read names the way they are written ([ad9327b](https://github.com/bymaksym/CrowdedFolders/commit/ad9327b10d7c8e94032634d1dda170a138e97fca))
* **node:** fail when git fails in a repository, and find the configuration from --root ([3177df0](https://github.com/bymaksym/CrowdedFolders/commit/3177df0dfb60375e94f9e0bd511a45864ef32c17))
* **prefix-groups:** ignore Latin prefixes of fewer than three letters ([e0ca3fb](https://github.com/bymaksym/CrowdedFolders/commit/e0ca3fb202052083b07b7adb8467919eed5f3dbd))
* **prefix-groups:** match ignore entries written in capitals ([084ab0f](https://github.com/bymaksym/CrowdedFolders/commit/084ab0f388fa38ef63bb003b52620e86b00d2baf))
* **prefix-groups:** propose only groups worth a folder ([4e9b3aa](https://github.com/bymaksym/CrowdedFolders/commit/4e9b3aa6cc6dc916d9da321c9176ecd62df1c828))
* **presets:** leave composeResources out in java too ([ca2758f](https://github.com/bymaksym/CrowdedFolders/commit/ca2758f791624e78bd0cf10428009fafd8b6408a))
* **presets:** leave Lottie animations out in react-native and flutter ([4839f36](https://github.com/bymaksym/CrowdedFolders/commit/4839f362aa52e2f88af6e24a1306bf1a06242a48))
* **presets:** read companions where they hold, and leave out the folder's own files ([cc58283](https://github.com/bymaksym/CrowdedFolders/commit/cc58283d1e4341d1bed1ce908ce7034b7dfa3ae2))
* **presets:** read only a folder's own files for the excludes anchored there ([134d0ef](https://github.com/bymaksym/CrowdedFolders/commit/134d0efb3bb26c94c826e53dc7114fb1be73807f))
* **presets:** read Unreal's asset prefixes only in Content/ ([fbe28d7](https://github.com/bymaksym/CrowdedFolders/commit/fbe28d73e8ab7955a881049851b493b1b5838305))
* **presets:** take no evidence from folders every run leaves out ([8ad1bbb](https://github.com/bymaksym/CrowdedFolders/commit/8ad1bbb732bef1a70f37ec47efd612ed62fbe3dd))
* **protobuf:** apply the preset to the whole repository when detected ([d3c99ab](https://github.com/bymaksym/CrowdedFolders/commit/d3c99ab1abfd8ee053ba16708446cb42240b7b1a))
* read every path of a run as its real path, so a link to a repository is that repository ([1d2b7ff](https://github.com/bymaksym/CrowdedFolders/commit/1d2b7ffc4e12938000c7297eb2e8e703ea631b30))
* **release:** move every version the package names with the release ([1af8628](https://github.com/bymaksym/CrowdedFolders/commit/1af8628374cafbb59846601d81eed3c18964bf8a))
* **report:** anchor the config error on its first problem; write GitLab's report on exit 2 ([79f5f32](https://github.com/bymaksym/CrowdedFolders/commit/79f5f32c295eecd0d878ece95a32a7d81b620bcf))
* **report:** say the health figure measures the max-files limit ([2066d22](https://github.com/bymaksym/CrowdedFolders/commit/2066d22fcf947435c75b065be021eb8250e8c051))
* **report:** wrap the note on tiny files to the terminal width ([f908626](https://github.com/bymaksym/CrowdedFolders/commit/f9086261fb60645aaa70300f7454922881e2abec))
* **rules:** word every rule-shape problem so it follows "it" or "the rule" ([14a8aca](https://github.com/bymaksym/CrowdedFolders/commit/14a8aca67dda4a7210e2a4aec5db8284b36299da))
* **unity:** read a number as part of a script's name wherever scripts live ([a416a89](https://github.com/bymaksym/CrowdedFolders/commit/a416a8941eb55dba9e6a3081529ee8e07dcd61fc))


### Performance Improvements

* **bin:** answer --version without loading the command ([9bf5965](https://github.com/bymaksym/CrowdedFolders/commit/9bf5965ecee3e7c48860d3955c3e5a6fe5ed1df7))
* **core:** freeze folders only where a plugin rule reads them, and share settings ([69b625f](https://github.com/bymaksym/CrowdedFolders/commit/69b625fa4f725e30d79ab0ae4d6d9fc010e36684))
* index overrides by the folders their globs name ([75ee18d](https://github.com/bymaksym/CrowdedFolders/commit/75ee18d873ce1f95d76cb1e2d76a960b57f4e527))
* **overrides:** file globs that share their folders under a plain name after the wildcard ([50058f6](https://github.com/bymaksym/CrowdedFolders/commit/50058f6a4fd9ddae0f1e58465da47b013c4f6640))
* **presets:** index the detection candidates by file name and extension ([f9611b7](https://github.com/bymaksym/CrowdedFolders/commit/f9611b77309df985a6a35180e50e7a1eeaa21ab6))
* remember exclude's answer per folder and read plain names as a set ([c2c2627](https://github.com/bymaksym/CrowdedFolders/commit/c2c2627d3247cc6358d60b1677e531a9ac65bc25))
* **stdin:** ask git about attributes only where an attributes file can mark ([9121bb4](https://github.com/bymaksym/CrowdedFolders/commit/9121bb4eccc9e83b6f84ca2070388ca6ed073b25))


### Documentation

* how names are read now, and what that does to suppressions ([a495f8c](https://github.com/bymaksym/CrowdedFolders/commit/a495f8c3b442073895d75ccfa52e37a07591b4b7))

## [1.0.1](https://github.com/bymaksym/CrowdedFolders/compare/v1.0.0...v1.0.1) (2026-10-10)


### Bug Fixes

* run the published package from the pre-commit hook ([d89fd2f](https://github.com/bymaksym/CrowdedFolders/commit/d89fd2f0959866657ab0e1fc21c6cc8407f19b63))

## 1.0.0 (2026-10-09)


### Features

* find the folders of a repository that have become a drawer ([90af1cf](https://github.com/bymaksym/CrowdedFolders/commit/90af1cf3c3f80f677dc6d6f9aa880593258039ec))
