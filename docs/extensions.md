# Writing extensions

An extension adds commands to Waypoint. It's a folder with a `package.json` and a JavaScript module, and it runs in its own process (Electron's [utility process](https://www.electronjs.org/docs/latest/api/utility-process)), so a slow or crashing extension can't freeze the launcher.

The quickest way to start is to copy [`examples/extensions/developer-utilities`](../examples/extensions/developer-utilities) into your extensions folder and change it. The extensions that come with Waypoint, in [`extensions/`](../extensions), use the same API and make good examples too: [Port Manager](../extensions/port-manager) runs system tools, [Emoji](../extensions/emoji) searches a big list itself and remembers what you used, [Conventional Commits](../extensions/conventional-commits) builds its list from what you type, [MDN](../extensions/mdn) searches a web API as you type, [GitHub](../extensions/github) signs in with a token pasted into its own search field, [Colors](../extensions/colors) draws its icons as SVG files in `supportPath`, [Media Controls](../extensions/media-controls) runs a different script on each system, and [Disk Usage](../extensions/disk-usage) scans in the background while its lists fill in. Run **Open Extensions Folder** from the launcher to find that folder, then **Reload Extensions** after each change.

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
| `mode` | `"view"` shows a list, a page of Markdown or a form. `"no-view"` just runs and closes the launcher. |
| `subtitle`, `icon`, `keywords` | Optional. Keywords are matched by the search too. |
| `fallback` | `true` offers the command under **Use “…” with** for any search, and passes the search text as `ctx.argument`. |
| `platforms` | Limit to some of `"darwin"`, `"win32"`, `"linux"`. |

People can give any of your commands a [shortcut of its own](../README.md#command-shortcuts), which `settings.json` names `"<extension>/<command>"`, like `"developer-utilities/uuid"`; so does `waypoint --command`. Keep a command's `name` once people may have used it. A `no-view` command run by its shortcut runs without the launcher open: its `toast` comes as a notification (a `'failure'` one opens the launcher), and a list it returns opens the launcher.

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

- **`view(ctx)`** — required for `view` commands. Returns a [list](#lists), a [detail view](#detail-views) or a [form](#forms). May be `async`.
- **`run(ctx)`** — required for `no-view` commands. Returns nothing (the launcher closes) or an [action result](#action-results).
- **`onAction(id, payload, ctx)`** — called when someone picks one of your `callback` actions, or submits one of your forms. Returns an action result.

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
  loading: false,                        // true: still filling in; view() is called again every second
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

A list with `filtering: false` is also asked for again when someone goes back to it from a view its own extension opened (with `push`, or `open-command`), whether with <kbd>⌫</kbd>, the back button or a `pop: true` result, so whatever was done there shows.

### Lists that fill in

Work that takes longer than a call may (10 seconds), like a scan, can carry on in the background after `view()` returns. Return what you have so far with `loading: true`: the launcher shows it's busy and calls `view()` again about once a second, with the same `ctx.query`, until a list comes back without it. A row picked with the arrows or the pointer stays picked as rows move, nothing changes while the action panel is open, and it waits while the launcher is closed. [Disk Usage](../extensions/disk-usage) adds up folders this way.

### Previews

When any item in a view has a `detail`, the launcher splits in two: the list on the left and a preview of the selected item on the right. Items without one show their icon, title and subtitle there instead.

| Field | |
| --- | --- |
| `body` | The text to show, up to 20,000 characters. Lines starting with `#` are headings, `- ` bullets, and `- [ ]` / `- [x]` checkboxes. Everything else is plain text; there's no other Markdown. |
| `markdown` | Instead of `body`: Markdown, up to 20,000 characters, drawn as in a [detail view](#detail-views). |
| `title` | Optional heading above the body, up to 200 characters. |
| `metadata` | Optional `{ label, value }` pairs listed at the bottom, up to 12. |

Every result also gets a quick key while you hold <kbd>⌘</kbd> (<kbd>Ctrl</kbd> on Windows and Linux): <kbd>⌘</kbd><kbd>1</kbd> to <kbd>⌘</kbd><kbd>9</kbd> run the first action of the first nine rows in view, so after scrolling <kbd>⌘</kbd><kbd>1</kbd> is the top row you can see.

Built-in icons: `alert`, `app`, `battery`, `calculator`, `clipboard`, `close`, `copy`, `cpu`, `eject`, `extension`, `file`, `folder`, `git-commit`, `globe`, `hard-drive`, `info`, `link`, `lock`, `log-out`, `memory`, `monitor`, `moon`, `music`, `network`, `note`, `pause`, `play`, `plug`, `power`, `refresh`, `restart`, `search`, `server`, `settings`, `skip-back`, `skip-forward`, `sparkles`, `terminal`, `text`, `trash`, `wifi`, `wifi-off`. A screen with the part a window fills: `window-left-half`, `window-right-half`, `window-top-half`, `window-bottom-half`, `window-top-left`, `window-top-right`, `window-bottom-left`, `window-bottom-right`, `window-first-third`, `window-center-third`, `window-last-third`, `window-first-two-thirds`, `window-last-two-thirds`, `window-maximize`, `window-almost-maximize`, `window-center`, `window-next-display`, `window-previous-display`, `window-restore`. Tints: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`.

## Detail views

A page of Markdown that fills the launcher: a README, an article, the result of something your command worked out.

```js
{
  type: 'detail',
  title: 'Release Notes',              // shown by the back button
  markdown: '# What’s new\n\n- [x] Forms\n- [ ] Grids',
  metadata: [{ label: 'Version', value: '2.0.0' }],   // optional: shown in a column beside the text
  actions: [/* … */],                  // as for a list item: ↵ runs the first, ⌘↵ the second
  loading: false,                      // true: still working; view() is called again every second
}
```

| Field | |
| --- | --- |
| `markdown` | The page, up to 100,000 characters: [CommonMark](https://commonmark.org) with GitHub's tables, task lists, strikethrough and links typed as plain URLs. |
| `title` | Shown by the back button and in the action bar, up to 100 characters. Without one, the command's title is. |
| `metadata` | Optional `{ label, value }` pairs listed beside the text, up to 24. |
| `actions` | Optional, up to 50, as for a [list item](#actions). |
| `loading` | `true` while it's still being worked out: the launcher shows that it's busy and calls `view()` again about once a second, as for a [list that fills in](#lists-that-fill-in). |

The search field has nothing to search, so it steps aside: <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Page Up</kbd> <kbd>Page Down</kbd>, <kbd>Space</kbd>, <kbd>Home</kbd> and <kbd>End</kbd> scroll the text, and the action keys work as in a list. <kbd>⌫</kbd> goes back.

Raw HTML is shown as the text it is, never as HTML. Links open in the browser (or the app for their kind of link, like `mailto:`), the way an `open-url` action does; relative links and `javascript:` ones don't open. Images can come from `https://` URLs or from absolute paths to image files on your computer, like `![Chart](/Users/me/chart.png)` or a file in `ctx.supportPath`.

## Forms

A form to fill in: to create or change something, or to ask for what a command needs.

```js
{
  type: 'form',
  title: 'New Quicklink',
  submit: { id: 'create', title: 'Create Quicklink' },   // title defaults to "Submit"
  fields: [
    { type: 'text', id: 'name', title: 'Name', placeholder: 'GitHub', required: true },
    { type: 'text', id: 'url', title: 'URL', defaultValue: 'https://', info: 'Use {query} for what you type.' },
    { type: 'textarea', id: 'notes', title: 'Notes' },
    { type: 'separator' },
    { type: 'checkbox', id: 'pinned', title: 'Pinned', label: 'Keep it at the top' },
    {
      type: 'dropdown',
      id: 'browser',
      title: 'Open With',
      defaultValue: 'default',                         // the first option when left out
      options: [
        { value: 'default', title: 'Default Browser', icon: { builtin: 'globe' } },
        { value: 'firefox', title: 'Firefox', icon: '🦊' },
      ],
    },
    { type: 'description', title: 'Tip', text: 'Quicklinks show up in the root search.' },
  ],
  actions: [/* … */],                                  // more actions for ⌘K, after the submit action
}
```

| Field type | |
| --- | --- |
| `text`, `password` | One line of text. `placeholder`, `defaultValue` and `required: true` are optional. |
| `textarea` | Several lines; <kbd>↵</kbd> starts a new line. The same options as `text`. |
| `checkbox` | `label` is shown beside the box; `defaultValue` is `true` or `false` (the default). |
| `dropdown` | One of `options` (`value`, `title`, optional `icon`, up to 500). Typing narrows the list down. |
| `description` | Text between fields, with an optional `title`. It has no value. |
| `separator` | A line between fields. |

Every field but a description or a separator has an `id`, unique within the form (up to 100 characters), and a `title` shown beside it; `info` adds a hint under it. Fields that can't be shown are left out: an unknown `type`, a missing or repeated `id`, a dropdown with no options. A `defaultValue` of the wrong kind is ignored. A form has up to 50 fields.

The first field has the keyboard when the form opens. <kbd>⇥</kbd> and <kbd>⇧</kbd> <kbd>⇥</kbd> go round the fields. <kbd>⌘</kbd> <kbd>↵</kbd> (<kbd>Ctrl</kbd> <kbd>Enter</kbd> on Windows and Linux) submits the form from any field, as does <kbd>↵</kbd> in a one-line field, the submit button in the action bar, and the first action in <kbd>⌘</kbd> <kbd>K</kbd>. <kbd>⌫</kbd> and the arrow keys are the fields' own; <kbd>Esc</kbd> goes home, as everywhere, and the back button goes back. Only an action shortcut with <kbd>⌘</kbd> or <kbd>Ctrl</kbd> works while you type in a field.

A `required` field that's empty, or only spaces, stops the form being sent: it says so under the field, which gets the keyboard. Otherwise submitting calls your `onAction(submit.id, values, ctx)`, where `values` has each field's `id` with its value: a string, or `true` / `false` for a checkbox.

```js
onAction(id, values, ctx) {
  if (id === 'create') {
    if (!values.url.startsWith('http')) return { toast: 'That’s not a web address', toastStyle: 'failure' };
    save(ctx, values);
    return { pop: true, toast: 'Quicklink created' };
  }
}
```

What `onAction` returns is applied as for any action: `pop: true` goes back to where the form was opened from, and a failure toast leaves the form as it was, with what was typed, to try again. When one command has several forms, put what each is about in its submit id, like `save:<id>`.

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
| `push: view` | Open a new view on top: a list, a detail view or a form. |
| `replace: view` | Replace the current view, e.g. a list after deleting an item. |
| `pop: true` | Go back. With `replace`, the view it goes back to is replaced, e.g. a list with the item a form just added. |
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
