# @waypoint-org/api

Types and helpers for writing [Waypoint](https://github.com/alexsilver8/waypoint) extensions: the shape of every view, item and action, and small functions that build them with less to type.

Waypoint gives this package to extensions as they run, so an extension can import it without installing anything. Install it for your editor's completions and type checks:

```sh
npm install --save-dev @waypoint-org/api
# or
pnpm add -D @waypoint-org/api
```

A copy in your extension's `node_modules` is the one your extension gets, instead of Waypoint's.

## Use

```js
// @ts-check
import { randomUUID } from 'node:crypto';
import { Action, Icon, defineExtension, item, list } from '@waypoint-org/api';

const uuids = () =>
  list({
    title: 'Generate UUID',
    items: Array.from({ length: 5 }, () => randomUUID()).map((uuid) =>
      item({
        title: uuid,
        icon: Icon.emoji('🎲'),
        actions: [
          Action.copy(uuid, { title: 'Copy UUID' }),
          Action.callback('regenerate', 'Generate New Ones', { shortcut: 'mod+r' }),
        ],
      }),
    ),
  });

export default defineExtension({
  commands: {
    uuid: { view: uuids, onAction: () => ({ replace: uuids() }) },
  },
});
```

`require('@waypoint-org/api')` works the same in CommonJS. Each helper returns a plain object, so they mix with object literals: `Action.copy(text)` is `{ type: 'copy', text }`.

| Helper | Builds |
| --- | --- |
| `defineExtension`, `defineCommand` | Your module's export, or one command, typed. Each returns what it's given. |
| `list`, `item` | A list view (`items`, or `sections`), and its items. An item's `id` is its title unless you give one. |
| `detail` | A detail view: a page of Markdown, with `metadata` and `actions`. |
| `form`, `field.text`, `field.password`, `field.textarea`, `field.checkbox`, `field.dropdown`, `field.description`, `field.separator`, `formValues` | A form, its fields, and what it submitted. |
| `Action.copy`, `Action.paste`, `Action.openUrl`, `Action.openPath`, `Action.revealPath`, `Action.openCommand`, `Action.callback` | Actions, with `title`, `shortcut` and other options last. |
| `Icon.builtin`, `Icon.emoji`, `Icon.path` | Icons. |
| `shortcut('mod+shift+c')` | A shortcut; `mod` is ⌘ on macOS and Ctrl on Windows and Linux. Actions take the string too. |
| `metadata({ Port: 3000 })` | Label–value pairs for a preview or a detail view, leaving out empty values. |

Lists of items, sections, actions, fields and keywords skip `false`, `0`, `''`, `null` and `undefined`, so `condition && Action.copy(text)` adds an action only when it applies.

The full guide, with every field of every view, is [Writing extensions](https://github.com/alexsilver8/waypoint/blob/main/docs/extensions.md).

## Develop

The types come from the app's own source, `src/shared/extension-api.ts` and `src/shared/types.ts`, and are written there only. `pnpm build` (in this folder) bundles them with the helpers' types into `dist/index.d.ts`, which refers to no other file, and builds the helpers as an ES module and as CommonJS with esbuild. `pnpm test` checks that the bundled declarations match the source, type for type.

## License

[MIT](./LICENSE)
