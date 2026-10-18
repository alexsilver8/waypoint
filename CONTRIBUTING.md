# Contributing to waypoint

Thanks for taking the time to contribute! 🎉

## Getting started

1. Fork the repository and create a branch from `main`.
2. Set up your environment (Node.js 22.12+, and `corepack enable` for the pinned pnpm):

   ```sh
   pnpm install
   pnpm dev
   ```

3. Make your change — add or update tests where it makes sense.
4. Before pushing, run the same checks as CI:

   ```sh
   pnpm lint
   pnpm cleaner    # conventions Biome and TypeScript don't check
   pnpm typecheck
   pnpm test
   pnpm test:e2e   # on headless Linux: xvfb-run -a pnpm test:e2e
   ```

5. Open a pull request and fill in the template.

## Where things live

| Path | |
| --- | --- |
| `src/main` | Electron main process: window, hotkey, tray, settings, app index, clipboard history, notes, the command registry |
| `src/main/commands` | Built-in commands. They implement the same interface as extensions. |
| `src/extension-host` | Runs third-party extensions in a utility process |
| `src/renderer` | The launcher, Notes, Settings and first-launch setup windows (React) |
| `src/shared` | Types and logic used everywhere: fuzzy search, calculator, the extension API |
| `packages/api` | `@waypoint-org/api`, the npm package for extension authors: the extension API's types (from `src/shared`, bundled at build) and helpers. The extension host gives it to extensions that don't install it. |
| `examples/extensions` | Example extensions, loaded automatically by `pnpm dev` |
| `e2e` | Playwright tests that drive the built app |

Logic that doesn't need Electron (search, parsing, validation) lives in its own module with a `*.test.ts` next to it, so it can be unit-tested with Vitest. Anything third-party code returns is validated in `src/main/extensions/validate.ts` before it reaches the UI.

New built-in commands are a good first contribution: add a file in `src/main/commands`, register it in `src/main/index.ts`, and describe it in the README.

## Commit messages & PR titles

This project follows [Conventional Commits](https://www.conventionalcommits.org). Pull requests are **squash-merged**, so the PR title becomes the commit on `main` — that is what CI checks, and what drives the changelog and version bumps.

| Prefix | Use it for | Release |
| --- | --- | --- |
| `feat:` | a new feature | minor |
| `fix:` | a bug fix | patch |
| `perf:` | a performance improvement | patch |
| `docs:` `refactor:` `test:` `build:` `ci:` `chore:` | everything else | — |
| `feat!:` `fix!:` … | a breaking change | major |

The description after the colon starts with a lowercase letter. Examples: `feat: add --json output`, `fix(parser): handle empty input`, `docs: clarify install steps`. Check a title with `node scripts/check-commits.mjs --title "…"`, or your branch's commits with `pnpm commits:check`.

## Releases

```sh
pnpm release             # works out the version, checks, tags and pushes
pnpm release --dry-run   # shows the version and the notes, changes nothing
pnpm release minor       # forces patch, minor, major or an exact version
```

The version comes from the commit subjects since the last release: `feat:` makes a minor release, `fix:` and `perf:` a patch, and `feat!:` or a `BREAKING CHANGE:` line a major one. `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:` and `style:` don't release on their own. The command checks that `main` is clean and up to date (pulling it first), runs lint, the type checks, the unit tests and the build, bumps `package.json` and the website's version badge, writes `CHANGELOG.md`, commits, tags `vX.Y.Z` and pushes `main` and the tag together.

The tag starts `.github/workflows/release.yml`, which runs the checks again, makes the GitHub release with that version's notes from the changelog, builds the installers on macOS, Windows and Linux, attaches them, and then publishes the release. It also attaches the `latest*.yml` files and `.blockmap`s that installed copies check for updates (see `publish` in `electron-builder.yml` and `src/main/updater.ts`), so a release reaches everyone without anything else to do.

The builds aren't code-signed yet. Updates install by themselves on Windows anyway; macOS only installs them to apps signed with an Apple Developer ID, so there Waypoint just says when a new version is out.

Pushing the release commit straight to `main` needs a repository admin, whom `main`'s ruleset lets through.

## Reporting issues

- **Bugs & feature requests:** [open an issue](https://github.com/alexsilver8/waypoint/issues/new/choose).
- **Security vulnerabilities:** please don't open a public issue — see [SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
