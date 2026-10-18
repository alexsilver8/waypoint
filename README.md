# Waypoint

[![CI](https://github.com/alexsilver8/waypoint/actions/workflows/ci.yml/badge.svg)](https://github.com/alexsilver8/waypoint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexsilver8/waypoint?sort=semver)](https://github.com/alexsilver8/waypoint/releases)
[![License](https://img.shields.io/github/license/alexsilver8/waypoint)](./LICENSE)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196.svg)](https://www.conventionalcommits.org)

An open-source, keyboard-first launcher for macOS, Windows and Linux, in the spirit of Raycast. Press <kbd>⌥</kbd> <kbd>Space</kbd>, type a few letters, press <kbd>↵</kbd>.

Website: [waypoint.alexsilver.dev](https://waypoint.alexsilver.dev/)

![Waypoint finding a note, with its preview beside the results](docs/images/launcher.png)

## What it does

- **Finds everything from one box** — apps, commands, notes and copied text all show up as you type. <kbd>⇥</kbd>, or the icons down the left of the window, narrow the list to Apps, Commands, Notes or Clipboard, or to **Extensions**, which lists every extension with its commands so you can pick one without remembering its name. A preview beside the results shows the note or copied text you've selected.
- **Opens apps** — finds installed applications on every platform.
- **Keeps notes, as many as you want** — a floating Notes window that works like Raycast Notes: one note at a time in a small window that grows as you write, **Browse Notes** (<kbd>⌘</kbd> <kbd>P</kbd>), an action panel (<kbd>⌘</kbd> <kbd>K</kbd>), pinned notes, back and forward, find and replace, and Recently Deleted. Every note is a plain Markdown file, so you can sync, back up or edit them with anything. There's no limit on how many you keep.
- **Calculates as you type** — `1200 * 1.077 + 2^5` shows `1,324.4`; <kbd>↵</kbd> copies it.
- **Remembers your clipboard** — searchable history of copied text, skipping anything password managers mark as private.
- **Searches the web** — anything that doesn't match falls back to Google, DuckDuckGo or any extension that offers itself.
- **Learns what you use** — frequently used items rise to the top.
- **Snaps windows** — halves, thirds, quarters, maximize, centre and the next display for the window you were using, and **Restore** to put it back. See [Windows](#windows).
- **Runs your computer** — lock, sleep, restart, shut down, log out, empty the Trash, eject disks and turn Wi-Fi on or off, with a check before anything you can't undo. See [System](#system).
- **Comes with extensions** — developer tools like Port Manager, Docker and GitHub, plus Media Controls and System Info, described [below](#included-extensions).
- **Runs extensions** — commands written in JavaScript, each extension in a separate process. See [Writing extensions](docs/extensions.md).
- **Everything has actions** — <kbd>⌘</kbd> <kbd>K</kbd> lists what you can do with the selected item.
- **Looks at home on your desktop** — the launcher is three panes floating on your desktop with nothing around them: the scope dock, the search field, and the results with their preview and action bar. Light or dark. Drag it anywhere that isn't a control to move it: like Raycast, guide lines show the screen's center, its middle and where the launcher opens, and it snaps to them. It opens again where you left it on that display. Settings floats the same way on macOS. The Notes window is liquid glass that blurs what's behind them on macOS and Windows 11; Linux gets the same design on a solid background, since it has no system blur.

## Install

Download the latest build for your system from [Releases](https://github.com/alexsilver8/waypoint/releases).

Builds aren't code-signed yet, so your system will warn you the first time you open one. On macOS, allow it under **System Settings → Privacy & Security → Open Anyway**. On Windows, choose **More info → Run anyway**.

## Use

| Keys | |
| --- | --- |
| <kbd>⌥</kbd> <kbd>Space</kbd> (<kbd>Alt</kbd> <kbd>Space</kbd>) | Open or close the launcher |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move through results (also <kbd>Ctrl</kbd> <kbd>N</kbd> / <kbd>Ctrl</kbd> <kbd>P</kbd>) |
| <kbd>⇥</kbd> / <kbd>⇧</kbd> <kbd>⇥</kbd> | Switch between All, Apps, Commands, Extensions, Notes and Clipboard |
| <kbd>↵</kbd> | Run the primary action |
| <kbd>⌘</kbd> <kbd>↵</kbd> | Run the secondary action |
| <kbd>⌘</kbd> <kbd>1</kbd> … <kbd>9</kbd> | Run one of the first nine results in view (hold <kbd>⌘</kbd> to see the numbers; they follow the scroll) |
| <kbd>⌘</kbd> <kbd>K</kbd> | Show all actions |
| <kbd>Esc</kbd> | Go back, clear the search, return to All, then close |
| <kbd>⌘</kbd> <kbd>,</kbd> | Open settings |

The Notes window has its own shortcuts, listed in the [Notes](#notes) section.

On Windows and Linux, use <kbd>Ctrl</kbd> wherever you see <kbd>⌘</kbd>.

On Linux under Wayland, global shortcuts may not reach the app. Bind a shortcut in your desktop settings to run `waypoint` instead: launching it again opens the running instance.

## Notes

<img src="docs/images/notes.png" width="475" alt="The Notes window with Browse Notes open, listing a pinned note and the rest by when they were last open">

Run **Create Note** to start writing, or **Open Notes** to bring the window back. Notes show up in the launcher's search as you type, matching anything in them, not just the title; press <kbd>⇥</kbd> to see only notes, newest first, with a preview of the one you've selected. **Search Notes** lists them all on their own. **Create Note** also appears under **Use “…” with** for anything you type, so you can type a thought into the launcher and save it straight away.

The Notes window works like Raycast Notes. It shows one note at a time, floats above your other windows, and grows as the note gets longer, then shrinks back; the first line is the note's title, in the middle of the title bar. The three buttons at the top right are **Actions** (<kbd>⌘</kbd> <kbd>K</kbd>), **Browse Notes** (<kbd>⌘</kbd> <kbd>P</kbd>) and **New Note** (<kbd>⌘</kbd> <kbd>N</kbd>). **Browse Notes** lists every note with when you last had it open and how long it is, pinned notes first; the selected note has buttons to pin and delete it. <kbd>Esc</kbd> closes a popover, then the window.

| Keys | |
| --- | --- |
| <kbd>⌘</kbd> <kbd>K</kbd> | Show every action, with its shortcut |
| <kbd>⌘</kbd> <kbd>P</kbd> | Browse Notes |
| <kbd>⌘</kbd> <kbd>N</kbd>, <kbd>⌘</kbd> <kbd>D</kbd> | New note, duplicate the note |
| <kbd>⌘</kbd> <kbd>[</kbd>, <kbd>⌘</kbd> <kbd>]</kbd> | Go back and forward between the notes you've opened |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>P</kbd> | Pin or unpin the note; <kbd>⌘</kbd> <kbd>1</kbd>–<kbd>9</kbd> open the first nine pinned notes |
| <kbd>⌘</kbd> <kbd>F</kbd> | Find and replace in the note (<kbd>↵</kbd> next, <kbd>⇧</kbd> <kbd>↵</kbd> previous) |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>C</kbd> | Copy the note, or the selected text, as Markdown, HTML or plain text |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>D</kbd> | Copy a `waypoint://` link that opens the note from anywhere |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>E</kbd> | Export the note as Markdown, HTML or plain text |
| <kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>,</kbd> | Show or hide the format bar, with the note's character or word count |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>/</kbd> | Turn window auto-resizing off or on |
| <kbd>⌘</kbd> <kbd>=</kbd>, <kbd>⌘</kbd> <kbd>-</kbd>, <kbd>⌘</kbd> <kbd>0</kbd> | Make the text bigger, smaller, or its usual size |
| <kbd>⌃</kbd> <kbd>X</kbd> (<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Backspace</kbd>) | Delete the note; <kbd>⌃</kbd> <kbd>⇧</kbd> <kbd>X</kbd> deletes them all, after asking |

The action panel also turns **Always on Top** off and on, shows the note in Finder, and opens **Recently Deleted**: deleted notes wait there for 60 days, so you can bring one back with <kbd>↵</kbd>, then go to the system Trash.

### Formatting

Markdown you type turns into formatting as you go: `# ` starts a heading, `- ` a list, `[ ] ` a checklist, `> ` a quote and ` ``` ` a code block. Typing `/` at the start of a line (or after a space) opens a menu of the same, and a colon with a couple of letters, like `:tada`, picks an emoji. **Format...** in the action panel and the format bar (<kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>,</kbd>) format the selection or the line you're on.

| Keys | |
| --- | --- |
| <kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>1</kbd>–<kbd>3</kbd>, <kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>0</kbd> | Heading 1–3, back to text |
| <kbd>⌘</kbd> <kbd>B</kbd>, <kbd>⌘</kbd> <kbd>I</kbd>, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd> | Bold, italic, strikethrough |
| <kbd>⌘</kbd> <kbd>L</kbd> | Add or edit a link; <kbd>⌘</kbd>-click a link to open it |
| <kbd>⌘</kbd> <kbd>E</kbd>, <kbd>⌘</kbd> <kbd>⌥</kbd> <kbd>C</kbd> | Inline code, code block |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>B</kbd> | Quote |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>8</kbd>, <kbd>7</kbd>, <kbd>9</kbd> | Bulleted list, numbered list, checklist |
| <kbd>⌘</kbd> <kbd>↵</kbd> | Tick or untick the checklist item you're on |

Notes are saved as you type, one `.md` file per note, and what you see is what's in the file: the formatting is Markdown, so it reads the same in any editor. A note is only rewritten when you change it, and then in a tidy form (for example `*` bullets become `-`). Notes with Markdown the editor can't show yet, like tables, images or front matter, open as plain Markdown instead, so nothing in them is lost. Set `notesDirectory` to a synced folder (Dropbox, iCloud Drive, a git repo) to have them everywhere; Markdown files already in that folder show up as notes too. Recently Deleted is the hidden `.deleted` folder inside it.

## Windows

Type a layout and press <kbd>↵</kbd>: the launcher steps aside and the window you were using moves.

| Command | |
| --- | --- |
| **Left Half**, **Right Half**, **Top Half**, **Bottom Half** | Half the screen |
| **Top Left Quarter**, **Top Right Quarter**, **Bottom Left Quarter**, **Bottom Right Quarter** | A quarter |
| **First Third**, **Center Third**, **Last Third**, **First Two Thirds**, **Last Two Thirds** | Thirds, side by side on a wide screen and stacked on a tall one |
| **Maximize**, **Almost Maximize**, **Center** | Fill the screen, nine-tenths of it, or keep the size and centre it |
| **Next Display**, **Previous Display** | The same place on another screen, scaled to fit |
| **Restore** | Back where the window was before Waypoint first moved it |

Windows fill the screen without the menu bar, Dock or taskbar. They're moved with System Events on macOS, which needs Waypoint allowed under **System Settings → Privacy & Security → Accessibility** (as pasting does), with Windows' own window calls on Windows, and with `xdotool` on Linux. Linux needs an X11 session: Wayland doesn't let one app move another's windows.

## System

| Command | |
| --- | --- |
| **Lock Screen**, **Sleep** | Right away (Sleep on macOS and Linux) |
| **Restart**, **Shut Down**, **Log Out** | Asks first; open apps are asked to quit, so they can save |
| **Empty Trash** (**Empty Recycle Bin** on Windows) | Asks first |
| **Eject Disks** | USB drives, SD cards, disk images and network shares. <kbd>↵</kbd> ejects one; **Eject All** ejects them all |
| **Toggle Wi-Fi** | Turns Wi-Fi off if it's on, and on if it's off |
| **Toggle System Appearance** | Switches macOS between light and dark |

On macOS, Empty Trash asks once to control Finder, and Restart, Shut Down and Log Out to control System Events. On Linux, Restart, Shut Down and Log Out go through GNOME, KDE, Xfce or Cinnamon, so apps can ask to save; on other desktops Restart and Shut Down use systemd, which closes apps without asking (the confirmation says so), and Log Out isn't available. Wi-Fi uses NetworkManager (`nmcli`) or `rfkill`, and ejecting uses `udisksctl`.

## Included extensions

These come with Waypoint and are written with the same [extension API](docs/extensions.md) as any other, in [`extensions/`](extensions).

| Command | |
| --- | --- |
| **Open Ports** | Every program listening on a port, with its command line and whether other devices can reach it. <kbd>↵</kbd> stops it, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>⌫</kbd> forces it, <kbd>⌘</kbd> <kbd>O</kbd> opens it in the browser. |
| **Search Gitmoji** | The [gitmoji](https://gitmoji.dev) list by name or meaning. <kbd>↵</kbd> pastes the emoji, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>C</kbd> copies its `:code:`. Recently used come first. |
| **Search Emoji** | Every emoji by name, keyword or `:shortcode:`, recently used first. <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>T</kbd> picks the skin tone for all of them. |
| **Write Commit Message** | A [Conventional Commits](https://www.conventionalcommits.org) message, checked as you type, with what it does to the version. Pick a type, or just describe the change: it suggests the type, also from the launcher's **Use “…” with**. |
| **Search Git Repositories** | The repositories in your code folders (`~/Developer`, `~/Projects`, `~/code`…), most recently changed first. <kbd>↵</kbd> opens one in your editor (VS Code, Cursor, Zed, Sublime Text, JetBrains IDEs…), <kbd>⌘</kbd> <kbd>T</kbd> in a terminal. Type a folder like `~/work` to search it too. |
| **My Pull Requests**, **My Issues**, **Search GitHub Repositories** | Pull requests waiting for your review and your own, your issues, and your repositories. Uses your [GitHub CLI](https://cli.github.com) sign-in, or a token you paste in once, which is kept in Waypoint's data folder (`extension-data/github`). |
| **Search Processes** | Every running program with its CPU and memory, busiest first. <kbd>↵</kbd> quits it, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>⌫</kbd> forces it. Programs the system needs can't be quit. |
| **Search Docker Containers**, **Search Docker Images** | Start, stop and restart containers, open the ports they publish, copy their logs, and remove what you no longer need. Works with Docker Desktop, OrbStack, Colima and Rancher Desktop. |
| **Encode or Decode Text** | Base64, URL and HTML encoding both ways, a JWT's header and claims, and SHA-256, SHA-1, SHA-512 and MD5 hashes. Also from **Use “…” with**. |
| **Convert Timestamp** | A Unix timestamp (seconds to nanoseconds), an ISO 8601 or RFC 2822 date, or nothing for now, in every common format. |
| **Convert Color** | Hex, `rgb()`, `hsl()`, `oklch()` or a CSS name, in all of those forms, with its contrast against white and black text. |
| **Search MDN** | [MDN Web Docs](https://developer.mozilla.org) as you type. Also from **Use “…” with**. |
| **Play or Pause**, **Next Track**, **Previous Track**, **Now Playing** | Controls whatever is playing, and shows the track with buttons for it. On macOS, Spotify and Music are asked directly and other apps (a browser tab, Podcasts) get the media keys, once Waypoint is allowed under Accessibility; on Windows it uses the media controls in the volume flyout, and on Linux MPRIS, which most players and browsers support (through `playerctl` when it's installed). |
| **System Info** | Battery, CPU, memory, disk space, your local and public IP addresses, the system version and uptime. <kbd>↵</kbd> copies a value, <kbd>⌘</kbd> <kbd>↵</kbd> opens Activity Monitor, Task Manager or the matching settings. The public IP comes from [api.ipify.org](https://www.ipify.org), asked when the list opens. |
| **Search Homebrew**, **Manage Homebrew Packages** | Every formula and cask, and what you've installed, out-of-date first. Installing, upgrading and uninstalling run in a Terminal window, so you can see brew work. macOS and Linux. |

<kbd>↵</kbd> in Gitmoji, Emoji and Commit Message pastes into the app you were in. The first time on macOS, allow Waypoint under **System Settings → Privacy & Security → Accessibility** (and **Automation** for System Events). On Linux, pasting needs `xdotool` (X11) or `wtype` (Wayland); without them the text is copied instead. Turn off **Paste into the app you were in** in Settings to always copy.

## Settings

Open **Settings** with <kbd>⌘</kbd> <kbd>,</kbd> in the launcher, the **Open Settings** command, or **Settings…** in the tray menu. There you can record a new shortcut, pick light or dark, choose how much clipboard history to keep, move your notes folder and manage extensions.

Everything is also saved in `settings.json` (**Settings → About → Edit settings.json**), and changes you make there apply as soon as you save:

```jsonc
{
  "hotkey": "Alt+Space",              // any Electron accelerator, e.g. "CommandOrControl+Shift+Space"
  "hideOnBlur": true,                 // close when you click elsewhere
  "launchAtLogin": false,             // macOS and Windows
  "theme": "system",                  // "light" or "dark"
  "clipboardHistory": { "enabled": true, "maxItems": 200 },
  "extensionDirectories": [],         // more places to load extensions from
  "notesDirectory": ""                // where notes are saved; empty means the app's data folder
}
```

## Develop

You need Node.js 22.12 or later and pnpm (`corepack enable` sets up the right version).

```sh
pnpm install
pnpm dev          # run with hot reload; also loads examples/extensions
pnpm test         # unit tests
pnpm test:e2e     # build, then drive the app with Playwright
pnpm lint         # Biome
pnpm cleaner      # conventions Biome and TypeScript don't check, from alexsilver8/cleaner
pnpm typecheck
pnpm dist         # installers for your OS in release/
```

`pnpm install` also downloads the Electron binary for your platform.

### How it fits together

```
┌──────────────────────┐  IPC   ┌────────────────────────────┐  messages  ┌─────────────────────┐
│ Renderer (React)     │◀──────▶│ Main process               │◀──────────▶│ Extension host      │
│ search, ranking,     │        │ window, hotkey, tray,      │            │ (utility process)   │
│ calculator, actions  │        │ apps, clipboard, built-in  │            │ third-party         │
│                      │        │ commands, command registry │            │ extensions          │
└──────────────────────┘        └────────────────────────────┘            └─────────────────────┘
```

- `src/main` — app lifecycle, the launcher window, built-in commands (`commands/`), app indexing (`apps/`), clipboard history, notes (`notes/`) and the command registry that routes every action.
- `src/extension-host` — loads extensions and runs their commands in a separate process.
- `src/renderer` — the launcher and Notes windows. Root search and the calculator run here, so typing never waits on IPC.
- `src/shared` — types, fuzzy matching and the calculator, shared by all three.
- `extensions` — the extensions that come with Waypoint, in plain JavaScript checked through JSDoc. `pnpm extensions:data` refreshes the gitmoji and emoji lists from their packages.
- `website` — the landing page: plain HTML, CSS and JavaScript with no build step. Serve the folder to preview it (`npx serve website`); pushes to `main` publish it to GitHub Pages.

Built-in commands implement the same interface as extensions, so anything a built-in can do, an extension can too.

## Roadmap

- Form views and full Markdown detail views for extensions
- An `@waypoint/api` package with types and helpers
- Quicklinks and snippets
- Keyboard shortcuts for any command, e.g. a key for Left Half
- Code-signed, auto-updating releases

Ideas and bug reports are welcome in [Issues](https://github.com/alexsilver8/waypoint/issues).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

[MIT](./LICENSE)
