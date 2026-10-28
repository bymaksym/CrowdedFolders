# Installing it without Node, and where else it is published

`npx crowded-folders` is the way for any repository that has Node. This page is for the others: a Java, Go
or Python team that does not want to install Node 20.19 to check folders, and for the places a tool
is listed so that people find it.

- [Binaries](#binaries-no-node-needed) and [Docker](#docker) work today (the binaries once a release has
  published them).
- [A PyPI wheel](#a-pypi-wheel-uvx-crowded-folders) and [the listings](#listings-a-checklist) are **plans**:
  nothing here has been published, opened or sent to anyone, and each step says who does it.

## Binaries: no Node needed

Each release has a file per platform on its GitHub Release page:

| Platform    | File                                        |
| ----------- | ------------------------------------------- |
| Linux x64   | `crowded-folders-vX.Y.Z-linux-x64.tar.gz`   |
| Linux arm64 | `crowded-folders-vX.Y.Z-linux-arm64.tar.gz` |
| macOS arm64 | `crowded-folders-vX.Y.Z-macos-arm64.tar.gz` |
| macOS x64   | `crowded-folders-vX.Y.Z-macos-x64.tar.gz`   |
| Windows x64 | `crowded-folders-vX.Y.Z-win-x64.zip`        |

Each holds the executable and the licence; `SHA256SUMS` lists the checksum of every archive.

<!-- x-release-please-start-version -->

```sh
curl -fsSLO https://github.com/bymaksym/CrowdedFolders/releases/download/v1.0.0/crowded-folders-v1.0.0-linux-x64.tar.gz
curl -fsSLO https://github.com/bymaksym/CrowdedFolders/releases/download/v1.0.0/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS      # shasum -a 256 -c on macOS
tar -xzf crowded-folders-v1.0.0-linux-x64.tar.gz
./crowded-folders --version
```

<!-- x-release-please-end -->

It is the same command: the same options, exit codes and configuration files (JSON, and JavaScript ones,
which the binary's own Node loads), and plugins resolved from the project's `node_modules`. Git has to be on
the machine for the repository to be listed from git; without it the disk is read, as `npx` does.

What to know:

- **It is not signed.** macOS adds the quarantine flag to what a browser downloaded
  (`xattr -d com.apple.quarantine crowded-folders`; `curl` does not set it), and Windows SmartScreen may
  ask once. The macOS binaries carry the ad hoc signature macOS requires of any modified executable, which
  proves nothing about who made them: verify the checksum, or build it yourself (below).
- **It is a copy of Node with the command inside**, about 90 MiB (35 MiB compressed). That is what
  "no Node needed" costs; the npm package is a few hundred kilobytes. The Node it carries is the 24 line
  current when the release was built, and a release does not follow Node's security releases: for a
  long-lived pipeline, `npx` with a Node you keep up to date is the better choice.
- **Linux means glibc.** Alpine and other musl systems cannot run it; use [Docker](#docker) or `npx`.
- Checked on this repository (211 files, Windows 11, Node 24.18): the binary answers `--version` in about
  0.15 s and checks the repository in about 0.3 s, against about 0.55 s for `node bin/crowded-folders.js`.
  One machine, five runs: a direction, not a benchmark.

### Building one

```sh
pnpm install && pnpm run build
node tooling/build-binary.mjs            # writes binaries/crowded-folders[.exe]
```

`tooling/build-binary.mjs` bundles the built `dist/` into one script with esbuild, makes the blob with
`node --experimental-sea-config`, and injects it into a copy of the Node that runs the script with
postject ([Node's single executable applications](https://nodejs.org/api/single-executable-applications.html)).
esbuild and postject run through `npx`, at the versions the script pins, and are not dependencies of the
package: the published package still has none. A binary is its platform's Node, so one is built on each
platform; `.github/workflows/binaries.yml` does it when release-please makes a release (it is started by
`release-please.yml`, never by a push) and attaches the archives and their checksums to the release. To run it
again for a tag, use _Run workflow_ in the Actions tab with the tag as the ref.

## Docker

There is no image of crowded-folders, on purpose: an image to keep patched for a tool that needs Node and
git is a worse deal than the official Node image, which is patched by the people who make Node. Use that
one, with git, which is the only thing missing:

<!-- x-release-please-start-version -->

```sh
docker run --rm -v "$PWD":/repo -w /repo node:24-alpine sh -c \
  'apk add --no-cache git && git config --global --add safe.directory /repo && npx --yes crowded-folders@1.0.0'
```

`safe.directory` is needed because the mounted folder belongs to another user than the container's, and git
refuses to list it otherwise. In a Dockerfile of your own, for CI:

```dockerfile
FROM node:24-alpine
RUN apk add --no-cache git
ENTRYPOINT ["npx", "--yes", "crowded-folders@1.0.0"]
```

<!-- x-release-please-end -->

Pin the version, as everywhere in [ci.md](ci.md). (This recipe has not been run in this repository's CI:
there is no Docker in the environment it was written in. Run it once before relying on it.)

## A PyPI wheel: `uvx crowded-folders`

_Plan, not built._ For Python teams the natural way to run a linter is `uvx ruff` or `pipx run ruff`.
Ruff does it by publishing platform wheels that contain the executable; the same works here with the
binary above, and needs no compiler: a wheel is a zip file.

How it would work:

1. After the `Binaries` workflow, a job takes each platform's executable and writes a wheel with it in
   the wheel's `scripts` folder (`crowded_folders-X.Y.Z.data/scripts/crowded-folders[.exe]`), so that
   `pip install`, `uv tool install` and `uvx` put it on the `PATH` under the name `crowded-folders`, which
   is also the package's name (that is what lets `uvx crowded-folders` work with no `--from`). The rest of
   the wheel is `METADATA`, `WHEEL` and `RECORD`, about sixty lines of Python with `zipfile`, or `maturin`
   with `bindings = "bin"` as ruff does.
2. One wheel per platform, with the tag of the oldest system the Node inside runs on:
   `manylinux_2_28_x86_64`, `manylinux_2_28_aarch64`, `macosx_13_0_arm64`, `macosx_13_0_x86_64`,
   `win_amd64` (the macOS and glibc floors are Node 24's: check the tags against the Node release notes of
   the version built). There is no `musllinux` wheel, because there is no musl Node binary to put in one;
   Alpine users get an error from the resolver that says so, and `npx` or Docker is the answer.
3. Each wheel is about 35 MiB, under PyPI's default 100 MiB per file.
4. Published with PyPI's trusted publishing (OIDC from the same workflow, as npm's is): no token stored.
5. The Python version is the npm version; a pre-release `1.1.0-rc.1` becomes `1.1.0rc1` (PEP 440).

What has to be true before building it, because the proposal is an assumption and not a measurement:

- [ ] The name `crowded-folders` is free on PyPI and can be reserved (a request to PyPI; not done).
- [ ] Someone who does not have Node asks for it: an issue, or a team that adopted the binary and would
      rather get it through `uv`. Ninety megabytes per platform on a package index is a cost worth paying
      for a user, not on a guess.
- [ ] The binary has run in CI on each of the five platforms for at least one release.
- [ ] `uvx crowded-folders --version` works from a wheel built locally and installed in a clean virtual
      environment, on Linux and Windows.

## Listings: a checklist

_None of these has been done; each step is the maintainer's, and each needs the repository to be public._
The requirements below are written from how these projects work; read the current contribution guide of each
before starting, because they change.

### GitHub Marketplace (the Action)

`action.yml` is at the root, with `name`, `description`, `author` and `branding` (`folder`, `orange`),
which is most of what the listing asks for.

- [ ] The repository is public, and `action.yml` is the only action in it, at the root. (Met.)
- [ ] The Action's `name` is unique on the Marketplace and is not the name of a GitHub feature or of a user
      or organisation. `crowded-folders` is also the `name` in `action.yml`: search the Marketplace for it
      first; if taken, change `name` (it is what is shown), not the `uses:` path.
- [ ] The account has two-factor authentication and has accepted the Marketplace Developer Agreement (the
      first time it publishes a release this way, GitHub asks).
- [ ] The README says how to use it: the one in the root is the page the listing shows, so it needs a
      short `uses: bymaksym/CrowdedFolders@v1` example near the top, which [ci.md](ci.md) has.
- [ ] A release exists with a tag that follows semantic versioning (release-please makes them), and the
      major tag (`v1`) is moved to it, so that `@v1` works. Check that something moves it.
- [ ] On the release's page: _Publish this Action to the GitHub Marketplace_, with a primary category
      (_Code quality_) and optionally a second one (_Continuous integration_).
- [ ] `fail-on`, `sarif` and the permissions each needs are documented in [ci.md](ci.md#github-actions).
- [ ] After listing: use the Action from a clean repository by the Marketplace's snippet.

### MegaLinter

MegaLinter wraps linters, each described by a descriptor file (`megalinter/descriptors/*.yml`) that says how
to install it, how to call it, which files it takes and where its documentation is.

- [ ] Read MegaLinter's _Add a new linter_ guide and an existing descriptor that installs from npm.
- [ ] Is the descriptor a fit? crowded-folders checks a repository, not a file: `cli_lint_mode: project`,
      `file_extensions` empty, and a `cli_lint_extra_args` of `--format sarif` or the plain text. The
      MegaLinter's SARIF output support decides whether the reporting is useful there.
- [ ] A descriptor with the linter's name, URL, license, the npm package, a version command
      (`--version`) and the help command, and tests with a folder that passes and one that fails
      (`test/` in MegaLinter's layout) built from this repository's own `examples/`.
- [ ] Which flavours it belongs to: the one for each language is too many; propose the _all_ flavour and the
      JavaScript one only.
- [ ] Open the pull request from a fork, with the checklist of their template filled in. Not done, and
      nothing has been sent.

### analysis-tools.dev and awesome-eslint

- [ ] analysis-tools.dev lists tools from a data repository (one YAML file per tool: name, homepage, source,
      licence, categories, languages, a description). Read its contribution guide for its minimum (it asks
      that a tool be maintained and documented); the tool counts as a linter for "other" languages, as
      it checks no language's code.
- [ ] awesome-eslint lists plugins by their package name, and the convention there is `eslint-plugin-*`.
      crowded-folders' plugin is a subpath of the package (`crowded-folders/eslint`, [eslint.md](eslint.md)),
      which that list and ESLint's own tooling that scans for plugins do not find. Decide first whether to
      publish a package named `eslint-plugin-crowded-folders` that only re-exports it; if not, the plugin is
      not a fit for that list, and only the tool is listed elsewhere.
- [ ] Both ask for the project to have had users and activity for some time, and each has a minimum of its
      own; wait for them to be met rather than asking early.
