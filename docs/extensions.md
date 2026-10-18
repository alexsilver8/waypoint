# Writing extensions

An extension adds commands to Waypoint. It's a folder with a `package.json` and a JavaScript module, and it runs in its own process (Electron's [utility process](https://www.electronjs.org/docs/latest/api/utility-process)), so a slow or crashing extension can't freeze the launcher.

The quickest way to start is to copy [`examples/extensions/developer-utilities`](../examples/extensions/developer-utilities) into your extensions folder and change it. The extensions that come with Waypoint, in [`extensions/`](../extensions), use the same API and make good examples too: [Port Manager](../extensions/port-manager) runs system tools, [Emoji](../extensions/emoji) searches a big list itself and remembers what you used, [Conventional Commits](../extensions/conventional-commits) builds its list from what you type, [MDN](../extensions/mdn) searches a web API as you type, [GitHub](../extensions/github) signs in with a token pasted into its own search field, [Colors](../extensions/colors) draws its icons as SVG files in `supportPath`, and [Media Controls](../extensions/media-controls) runs a different script on each system. Run **Open Extensions Folder** from the launcher to find that folder, then **Reload Extensions** after each change.

> Extensions have full Node.js access, like a package you `npm install`. Only install extensions you trust.

## Where extensions are loaded from

- The `extensions` folder inside Waypoint's data folder (run **Open Extensions Folder**).
- Every path in `extensionDirectories` in your [settings](../README.md#settings). Each path can be one extension, or a folder of them — handy for working on an extension in its own repo.
- The extensions that come with Waypoint: inside the app once installed, `extensions/` when running from source.
- `examples/extensions` when running from source with `pnpm dev`.

**Manage Extensions** lists everything that loaded, and why anything didn't.

## package.json

```json
{
  "name": "developer-utilities",
  "type": "module",
  "main": "index.js",
  "waypoint": {
    "title": "Developer Utilities",
    "icon": "🧰",
    "commands": [
      { "name": "uuid", "title": "Generate UUID", "mode": "view", "keywords": ["guid"] },
      { "name": "npm-search", "title": "Search npm Packages", "mode": "view", "fallback": true }
    ]
  }
}
```

| Field | |
| --- | --- |
| `name` | Lowercase letters, digits and dashes; unique across your extensions. An npm scope (`@you/`) is ignored. |
| `main` | The module to load. Defaults to `index.js`. ES modules and CommonJS both work. |
| `waypoint.title` | Shown as the subtitle of every command. |
| `waypoint.icon` | An emoji, or a path to an image relative to the extension folder. |
| `waypoint.commands[]` | See below. |

Each command:

| Field | |
| --- | --- |
| `name` | Lowercase letters, digits and dashes; the key of the command in your module. |
| `title` | What people search for. |
| `mode` | `"view"` shows a list. `"no-view"` just runs and closes the launcher. |
| `subtitle`, `icon`, `keywords` | Optional. Keywords are matched by the search too. |
| `fallback` | `true` offers the command under **Use “…” with** for any search, and passes the search text as `ctx.argument`. |
| `platforms` | Limit to some of `"darwin"`, `"win32"`, `"linux"`. |

## The module

Export your commands, keyed by name:

```js
export default {
  commands: {
    uuid: {
      view(ctx) {
        return { type: 'list', items: [/* … */] };
      },
    },
  },
};
```

Types for editors live in [`src/shared/extension-api.ts`](../src/shared/extension-api.ts); the example shows how to use them from plain JavaScript with JSDoc.

A command can implement:

- **`view(ctx)`** — required for `view` commands. Returns a list (see below). May be `async`.
- **`run(ctx)`** — required for `no-view` commands. Returns nothing (the launcher closes) or an [action result](#action-results).
- **`onAction(id, payload, ctx)`** — called when someone picks one of your `callback` actions. Returns an action result.

Calls time out after 10 seconds.

### Context

| `ctx.` | |
| --- | --- |
| `query` | The text in the search field of your view (`""` when it opens). |
| `argument` | The root search text, when opened as a fallback. |
| `platform` | `"darwin"`, `"win32"` or `"linux"`. |
| `storage` | `get(key)`, `set(key, value)`, `remove(key)` — JSON values, kept between runs. |
| `supportPath` | A folder you may write to. |
| `extension` | `{ name, path }`. |
| `power` | `keepAwake({ until? })`, `wakeLock()`, `allowSleep()` — see [Keeping the computer awake](#keeping-the-computer-awake). |

### Keeping the computer awake

`ctx.power` asks Waypoint to keep the computer and its display awake, with Electron's [`powerSaveBlocker`](https://www.electronjs.org/docs/latest/api/power-save-blocker). Waypoint holds the lock, not your extension's process, so it lasts through **Reload Extensions** and an extension timing out, until its time is up, you let go of it, or Waypoint quits. Each extension has one at a time; asking again replaces it.

```js
const lock = await ctx.power.keepAwake({ until: Date.now() + 60 * 60 * 1000 }); // { since, until }
await ctx.power.wakeLock(); // the same while it holds, undefined once it's over
await ctx.power.allowSleep();
```

Leave out `until` to hold it until you let go. [Keep Awake](../extensions/keep-awake) uses it on Windows.

## Lists

```js
{
  type: 'list',
  title: 'Bookmarks',                    // shown next to the search field
  searchPlaceholder: 'Search bookmarks…',
  filtering: true,                       // false: you filter, and view() is called again on every keystroke
  emptyText: 'No bookmarks yet.',
  sections: [
    {
      title: 'Reading list',
      items: [
        {
          id: 'electron-docs',           // unique within the view
          title: 'Electron documentation',
          subtitle: 'electronjs.org',
          accessory: 'Today',            // right-aligned
          icon: '🔖',                    // emoji, image path, or { builtin: 'globe', tint: 'blue' }
          keywords: ['docs'],
          detail: {                      // optional: shows a preview pane beside the list
            title: 'Electron documentation',
            body: '# Read later\n- [ ] Window options\n- [x] Clipboard API',
            metadata: [{ label: 'Added', value: 'Today' }],
          },
          actions: [/* … */],
        },
      ],
    },
  ],
}
```

`items: [...]` at the top level is a shortcut for a single untitled section.

### Previews

When any item in a view has a `detail`, the launcher splits in two: the list on the left and a preview of the selected item on the right. Items without one show their icon, title and subtitle there instead.

| Field | |
| --- | --- |
| `body` | The text to show, up to 20,000 characters. Lines starting with `#` are headings, `- ` bullets, and `- [ ]` / `- [x]` checkboxes. Everything else is plain text; there's no other Markdown. |
| `title` | Optional heading above the body, up to 200 characters. |
| `metadata` | Optional `{ label, value }` pairs listed at the bottom, up to 12. |

Every result also gets a quick key while you hold <kbd>⌘</kbd> (<kbd>Ctrl</kbd> on Windows and Linux): <kbd>⌘</kbd><kbd>1</kbd> to <kbd>⌘</kbd><kbd>9</kbd> run the first action of the first nine rows in view, so after scrolling <kbd>⌘</kbd><kbd>1</kbd> is the top row you can see.

Built-in icons: `alert`, `app`, `battery`, `calculator`, `clipboard`, `close`, `copy`, `cpu`, `eject`, `extension`, `file`, `folder`, `git-commit`, `globe`, `hard-drive`, `info`, `link`, `lock`, `log-out`, `memory`, `monitor`, `moon`, `music`, `network`, `note`, `pause`, `play`, `plug`, `power`, `refresh`, `restart`, `search`, `server`, `settings`, `skip-back`, `skip-forward`, `sparkles`, `terminal`, `text`, `trash`, `wifi`, `wifi-off`. A screen with the part a window fills: `window-left-half`, `window-right-half`, `window-top-half`, `window-bottom-half`, `window-top-left`, `window-top-right`, `window-bottom-left`, `window-bottom-right`, `window-first-third`, `window-center-third`, `window-last-third`, `window-first-two-thirds`, `window-last-two-thirds`, `window-maximize`, `window-almost-maximize`, `window-center`, `window-next-display`, `window-previous-display`, `window-restore`. Tints: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`.

## Actions

The first action of an item runs on <kbd>↵</kbd>, the second on <kbd>⌘</kbd><kbd>↵</kbd> (<kbd>Ctrl</kbd><kbd>Enter</kbd> on Windows and Linux), and all of them are listed in the action panel (<kbd>⌘</kbd><kbd>K</kbd>).

| `type` | Fields | Does |
| --- | --- | --- |
| `copy` | `text` | Copies the text and closes the launcher. |
| `paste` | `text` | Closes the launcher and pastes the text into the app that was in front. |
| `open-url` | `url` | Opens the URL in the default browser or app. |
| `open-path` | `path` (absolute) | Opens a file, folder or app. |
| `reveal-path` | `path` (absolute) | Shows the file in Finder / Explorer. |
| `open-command` | `ref: { extension, command }`, `argument?` | Opens another command. |
| `callback` | `id`, `title`, `payload?`, `style?: 'destructive'` | Calls your `onAction(id, payload, ctx)`. |

Every action takes an optional `title` and `shortcut`, e.g. `{ key: 'Backspace', modifiers: ['mod'] }`, where `mod` is <kbd>⌘</kbd> on macOS and <kbd>Ctrl</kbd> elsewhere.

## Action results

`run()` and `onAction()` can return:

| Field | |
| --- | --- |
| `hide: true` | Close the launcher. |
| `toast`, `toastStyle` | A short message in the footer; `'success'` (default) or `'failure'`. |
| `push: view` | Open a new list on top. |
| `replace: view` | Replace the current list, e.g. after deleting an item. |
| `pop: true` | Go back. |
| `clearSearch: true` | Empty the search field. |
| `search: text` | Put the text in the search field, e.g. the start of something to finish typing. |
| `copy: text` | Copy the text and close the launcher. |
| `paste: text` | Close the launcher and paste the text into the app that was in front. |

If your code throws, the error message is shown as a failure toast.

Returning `copy` or `paste` from `onAction` (instead of using a `copy` or `paste` action) lets you do something first, like remembering what was picked: the Emoji extension keeps its recently used list this way.

### Pasting

To paste, Waypoint puts the text on the clipboard, closes the launcher so the previous app is in front again, and presses the paste shortcut:

- **macOS:** through System Events. The first time, macOS asks to let Waypoint control your computer (Accessibility) and System Events (Automation).
- **Windows:** with SendKeys, nothing to set up.
- **Linux:** with `xdotool` on X11 or `wtype` on Wayland, if one is installed.

When it can't, the text stays on the clipboard and a notification says how to paste it yourself. People who'd rather paste themselves can turn off **Paste into the app you were in** in Settings; then `paste` copies.

Don't give a `paste` action a shortcut with <kbd>⇧</kbd> or <kbd>⌥</kbd>: if the key is still held when the paste is typed, the app sees ⌘⇧V (often "paste and match style") instead.

## Types

The types in [`src/shared/extension-api.ts`](../src/shared/extension-api.ts) work in plain JavaScript through JSDoc, as in the examples. `pnpm typecheck` checks the bundled and example extensions that way, so a mistake in a view's shape shows up before you run it.

## Debugging

Run Waypoint from source with `pnpm dev`: `console.log` from extensions shows up in that terminal. **Reload Extensions** restarts the extension process, so your latest code is loaded.
