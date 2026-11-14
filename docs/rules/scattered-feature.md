# `scattered-feature`

One word that starts module names in several layer folders of one folder: a feature split by layer.

**Off in `recommended` and in every preset.** Options and defaults:
[configuration.md](../configuration.md#scattered-feature).

<!-- output: scattered-feature -->

```text
src/main/java/com/laboral/time/
  ✖ error  scattered-feature  "registro" starts 6 module names across 5 layer folders (controller/,
                              dto/, model/, repository/, service/): a feature split by layer.
                              Package by feature: move them into
                              src/main/java/com/laboral/time/registro/, one folder for everything
                              about registro.

✖ 1 error, 0 warnings in 1 folder (12 folders and 6 files checked; 100 % of folders within the
  max-files limit (12/12)).
  --moves prints where each file could go; `crowded-folders explain src/main/java/com/laboral/time`
    shows how a folder was read.
```

<!-- /output -->

Changing how the `registro` works means opening five folders, and nothing in the tree says which files
are about it. It is reported once, at the folder that holds the layers, not once per layer folder, and
`--moves` prints every `git mv` that makes it one folder. It is a tree rule: it reads every layer folder
before it reports.

## The fix

<!-- fix: scattered-feature -->

`--moves` prints the fix. The folder after it, and the run that passes:

```sh
mkdir -p src/main/java/com/laboral/time/registro
git mv src/main/java/com/laboral/time/controller/RegistroHorarioController.java src/main/java/com/laboral/time/registro/RegistroHorarioController.java
git mv src/main/java/com/laboral/time/dto/RegistroHorarioDto.java src/main/java/com/laboral/time/registro/RegistroHorarioDto.java
git mv src/main/java/com/laboral/time/dto/RegistroUsuarioConRol.java src/main/java/com/laboral/time/registro/RegistroUsuarioConRol.java
git mv src/main/java/com/laboral/time/model/RegistroHorario.java src/main/java/com/laboral/time/registro/RegistroHorario.java
git mv src/main/java/com/laboral/time/repository/RegistroHorarioRepository.java src/main/java/com/laboral/time/registro/RegistroHorarioRepository.java
git mv src/main/java/com/laboral/time/service/RegistroHorarioService.java src/main/java/com/laboral/time/registro/RegistroHorarioService.java
```

```text
src/main/java/com/laboral/time/registro/ RegistroHorario.java, RegistroHorarioController.java,
  RegistroHorarioDto.java, RegistroHorarioRepository.java, RegistroHorarioService.java,
  RegistroUsuarioConRol.java

✔ No crowded folders (8 folders and 6 files checked; 100 % of folders within the max-files limit
```

<!-- /fix -->

## What it reads

- A **layer folder** is one whose name is one word of `layers`, singular or plural, in any case:
  `service/`, `services/`, `Services/`. Its direct modules are read, not its subfolders.
- The **feature** of a module is the first word of its subject (after a type letter and
  `naming.ignoreLeadingWords`), singular and plural as one: `IRegistroService` and `RegistroHorario` are
  both `registro`. A layer word (`ServiceConfig` in `service/`), a number and a word in `ignore` are no
  feature.
- A feature that one of the folders above already names is not reported:
  `users/infrastructure/persistence/relational/{entities,mappers,repositories}/user.*` is already in
  `users/` (`brocoders/nestjs-boilerplate`).

## The moves

Into `<folder>/<feature>/`, written as `naming.folderCase` writes folders (`registro/` in Java,
`Song/` with `pascal`), into a subfolder that already has that name in other case, and never onto a
reserved word. File names are kept: a class is named like its file. Two layers with a file of the same
name (`model/Order.java` and `entity/Order.java`) cannot both go to `order/Order.java`; the second stays,
and the message says why. Where `naming.mirrors` pairs a test tree with the code (`src/test/java` of
`src/main/java`, as `java` does), the tests of the feature go to the same place, and the problem is
reported once, in the code.

## Why it is off

The [field trial](../field-trial.md) found it in 3 of 36 repositories, all of them layered on purpose
by their framework: immich's NestJS server (34 features in `server/src/{controllers,dtos,repositories,services}`),
koel's Laravel `app/{Models,Repositories,Services}` (8) and mastodon's Rails `app/` (4). It found none
in the five Java repositories, which package by feature already. A rule that mostly reports what the
framework asks for is not one to turn on for everyone: turn it on where the team chose to package by
feature, as the `java` preset's hint advises ("package by feature (user/, order/), not by layer").

```jsonc
{ "rules": { "scattered-feature": ["error", { "min": 3, "ignore": ["base"] }] } }
```
