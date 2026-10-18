---
name: pretty-branch-names
description: Name git branches so they read clearly, like `feat/snippet-expansion` or `fix/updater-crash-on-quit`, instead of random or auto-generated names such as `claude/elegant-rubin-cq1rjf`, `patch-1` or `new-branch`. Use whenever you are about to create, rename or suggest a git branch in this repository.
---

# Pretty branch names

A branch name should tell a reviewer what the branch does before they open it.

## Format

```
<type>/<short-description>
```

- **type** — the Conventional Commits prefix the PR title will use (see `CONTRIBUTING.md`):
  `feat`, `fix`, `perf`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`.
- **short-description** — 2 to 5 words, kebab-case, saying what changes. Lead with the
  area when it helps (`snippets-…`, `updater-…`, `api-…`).
- Add an issue number at the end when there is one: `fix/tray-icon-blurry-42`.

## Rules

- Lowercase letters, digits and hyphens only, with `/` once after the type.
  No spaces, underscores, dots, uppercase or emoji.
- 50 characters at most.
- No random or generated parts: no adjective-noun pairs (`elegant-rubin`), hashes,
  session ids, timestamps or dates.
- No filler: avoid `update`, `changes`, `stuff`, `misc`, `wip`, `test-branch`, `patch-1`,
  `new-feature`, `my-branch`.
- No tool or author prefixes (`claude/`, `codex/`, `alex/`). The type is the prefix.
- Describe the change, not the process: `fix/updater-retry`, not `fix/address-review`.
- Check the name is free first: `git branch -a --list '*<name>*'`. If taken, make it more
  specific rather than adding `-2`.

## Examples

| Task | Good | Bad |
| --- | --- | --- |
| Expand snippet keywords as you type | `feat/snippet-expansion` | `claude/elegant-rubin-cq1rjf` |
| Updater crashes when the app quits | `fix/updater-crash-on-quit` | `bugfix`, `fix_Updater` |
| Publish the API package to npm | `build/publish-api-package` | `update-package-json` |
| Remove done items from the roadmap | `docs/trim-website-roadmap` | `docs-changes-2026-10-18` |
| Bump Electron | `chore/bump-electron` | `patch-1` |

## Steps

1. Read the task and pick the type it will ship as.
2. Write the shortest description that still says what changes.
3. Check it against the rules above and that it is not already taken.
4. Create it from an up-to-date `main`:
   `git fetch origin main && git switch -c <type>/<short-description> origin/main`

## When the branch name is given to you

If the session, the user or an automation has already named the branch you must
push to (for example, a cloud session told to develop on `claude/...`), use that name:
it is how the work gets tracked. Don't rename or push elsewhere without asking. You
may suggest a pretty name the user could use instead.
