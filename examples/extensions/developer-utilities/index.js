// An example Waypoint extension: UUIDs, npm search, a to-do list with a form to add to it, and a
// page about itself. See docs/extensions.md for the full API.
//
// Each command named in package.json is implemented here. `view` commands return a list, a
// detail view or a form, `no-view` commands just do something, and `onAction` handles the
// "callback" actions that a command's items offer, and its forms when they're submitted.
import { randomUUID } from 'node:crypto';

/** @typedef {import('../../../src/shared/extension-api').Extension} Extension */
/** @typedef {import('../../../src/shared/extension-api').ExtensionContext} Context */
/** @typedef {import('../../../src/shared/extension-api').ListItem} ListItem */
/** @typedef {import('../../../src/shared/extension-api').ListView} ListView */
/** @typedef {import('../../../src/shared/extension-api').DetailView} DetailView */
/** @typedef {import('../../../src/shared/extension-api').FormView} FormView */
/** @typedef {import('../../../src/shared/extension-api').Action} Action */
/** @typedef {import('../../../src/shared/extension-api').ActionResult} ActionResult */
/** @typedef {import('../../../src/shared/extension-api').Json} Json */
/** @typedef {{ id: string, text: string, done: boolean, notes?: string, priority?: string }} Todo */

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function uuidView(ctx) {
  const uuids = Array.from({ length: 5 }, () =>
    ctx.query.toLowerCase().includes('upper') ? randomUUID().toUpperCase() : randomUUID(),
  );
  return {
    type: 'list',
    title: 'Generate UUID',
    searchPlaceholder: 'Type "upper" for uppercase…',
    // The list is generated from the query, so don't let the launcher filter it.
    filtering: false,
    sections: [
      {
        title: 'Fresh UUIDs',
        items: uuids.map((uuid) => ({
          id: uuid,
          title: uuid,
          icon: { emoji: '🎲' },
          actions: [
            { type: 'copy', text: uuid, title: 'Copy UUID' },
            {
              type: 'callback',
              id: 'regenerate',
              title: 'Generate New Ones',
              shortcut: { key: 'r', modifiers: ['mod'] },
            },
          ],
        })),
      },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function npmView(ctx) {
  const query = (ctx.query || ctx.argument || '').trim();
  if (!query) {
    return {
      type: 'list',
      title: 'npm',
      filtering: false,
      searchPlaceholder: 'Search npm packages…',
      sections: [],
      emptyText: 'Type to search the npm registry.',
    };
  }
  const response = await fetch(`https://registry.npmjs.org/-/v1/search?size=20&text=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`npm responded with ${response.status}`);
  const { objects } =
    /** @type {{ objects: Array<{ package: { name: string, version: string, description?: string, links: { npm: string, repository?: string } } }> }} */ (
      await response.json()
    );
  return {
    type: 'list',
    title: 'npm',
    searchPlaceholder: 'Search npm packages…',
    filtering: false,
    sections: [
      {
        title: `Results for “${query}”`,
        items: objects.map(({ package: pkg }) => ({
          id: pkg.name,
          title: pkg.name,
          subtitle: pkg.description,
          accessory: `v${pkg.version}`,
          icon: { emoji: '📦' },
          actions: [
            { type: 'open-url', url: pkg.links.npm, title: 'Open on npmjs.com' },
            { type: 'copy', text: `npm install ${pkg.name}`, title: 'Copy Install Command' },
            .../** @type {Action[]} */ (
              pkg.links.repository ? [{ type: 'open-url', url: pkg.links.repository, title: 'Open Repository' }] : []
            ),
          ],
        })),
      },
    ],
    emptyText: 'No packages found.',
  };
}

/**
 * @param {Context} ctx
 * @returns {Todo[]}
 */
function readTodos(ctx) {
  return /** @type {any} */ (ctx.storage.get('todos')) ?? [];
}

const PRIORITIES = [
  { value: 'normal', title: 'Normal', icon: { emoji: '🟢' } },
  { value: 'high', title: 'High', icon: { emoji: '🔴' } },
  { value: 'low', title: 'Low', icon: { emoji: '⚪️' } },
];

/**
 * A form to add a to-do. Submitting it calls `onAction('create', values)`.
 *
 * @param {string} [text] What was typed already.
 * @returns {FormView}
 */
function newTodoForm(text = '') {
  return {
    type: 'form',
    title: 'New To-do',
    submit: { id: 'create', title: 'Add To-do' },
    fields: [
      { type: 'text', id: 'text', title: 'To-do', placeholder: 'Water the plants', defaultValue: text, required: true },
      { type: 'textarea', id: 'notes', title: 'Notes', info: 'Markdown, shown beside the list.' },
      { type: 'dropdown', id: 'priority', title: 'Priority', options: PRIORITIES },
      { type: 'separator' },
      { type: 'checkbox', id: 'done', title: 'Status', label: 'Already done' },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function todosView(ctx) {
  const todos = readTodos(ctx);
  const query = ctx.query.trim();
  const matching = todos.filter((todo) => todo.text.toLowerCase().includes(query.toLowerCase()));
  /** @param {Todo} todo @returns {ListItem} */
  const toItem = (todo) => ({
    id: todo.id,
    title: todo.text,
    icon: { emoji: todo.done ? '✅' : '⬜️' },
    accessory: PRIORITIES.find((p) => p.value === todo.priority && p.value !== 'normal')?.title,
    // A preview beside the list, in Markdown.
    detail: todo.notes ? { title: todo.text, markdown: todo.notes } : undefined,
    actions: [
      { type: 'callback', id: 'toggle', title: todo.done ? 'Mark as Not Done' : 'Mark as Done', payload: todo.id },
      { type: 'copy', text: todo.text, title: 'Copy Text' },
      {
        type: 'callback',
        id: 'delete',
        title: 'Delete To-do',
        payload: todo.id,
        style: 'destructive',
        shortcut: { key: 'Backspace', modifiers: ['mod'] },
      },
      { type: 'callback', id: 'new', title: 'New To-do…', shortcut: { key: 'n', modifiers: ['mod'] } },
    ],
  });
  return {
    type: 'list',
    title: 'To-dos',
    searchPlaceholder: 'Type to search, or to add a to-do…',
    // The "Add" row depends on the search text, so this command filters by itself.
    filtering: false,
    sections: [
      {
        items: query
          ? [
              {
                id: 'add',
                title: `Add “${query}”`,
                icon: { emoji: '➕' },
                actions: [
                  { type: 'callback', id: 'add', title: 'Add To-do', payload: query },
                  { type: 'callback', id: 'new', title: 'Add with Notes…', payload: query },
                ],
              },
            ]
          : [
              {
                id: 'new',
                title: 'New To-do…',
                icon: { emoji: '📝' },
                actions: [{ type: 'callback', id: 'new', title: 'New To-do…' }],
              },
            ],
      },
      { title: 'To do', items: matching.filter((todo) => !todo.done).map(toItem) },
      { title: 'Done', items: matching.filter((todo) => todo.done).map(toItem) },
    ],
    emptyText: 'Nothing to do. Type something and press ↵ to add it.',
  };
}

/**
 * Handles the to-do list's actions and the New To-do form, for both commands that show them.
 *
 * @param {string} id
 * @param {Json | undefined} payload
 * @param {Context} ctx
 * @returns {ActionResult | undefined}
 */
function todoAction(id, payload, ctx) {
  const todos = readTodos(ctx);
  if (id === 'add' && typeof payload === 'string') {
    ctx.storage.set('todos', [{ id: randomUUID(), text: payload, done: false }, ...todos]);
    return { replace: todosView({ ...ctx, query: '' }), clearSearch: true, toast: 'To-do added' };
  }
  if (id === 'new') {
    return { push: newTodoForm(typeof payload === 'string' ? payload : '') };
  }
  if (id === 'create' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    // A form's values: a string for each field, and a boolean for the checkbox.
    const { text, notes, priority, done } = payload;
    /** @type {Todo} */
    const todo = { id: randomUUID(), text: String(text).trim(), done: done === true, priority: String(priority) };
    if (typeof notes === 'string' && notes.trim()) todo.notes = notes;
    ctx.storage.set('todos', [todo, ...todos]);
    // Back to where the form was opened from: the to-do list asks for itself again.
    return { pop: true, clearSearch: true, toast: 'To-do added' };
  }
  if (id === 'toggle') {
    ctx.storage.set(
      'todos',
      todos.map((todo) => (todo.id === payload ? { ...todo, done: !todo.done } : todo)),
    );
    return { replace: todosView(ctx) };
  }
  if (id === 'delete') {
    ctx.storage.set(
      'todos',
      todos.filter((todo) => todo.id !== payload),
    );
    return { replace: todosView(ctx), toast: 'To-do deleted' };
  }
  return undefined;
}

/**
 * A page about this extension: Markdown, with facts beside it and actions like a list item's.
 *
 * @param {Context} ctx
 * @returns {DetailView}
 */
function aboutView(ctx) {
  const versions = /** @type {Array<[string, string]>} */ (
    Object.entries(process.versions).filter(([name]) => ['node', 'v8', 'electron', 'chrome', 'uv'].includes(name))
  );
  const todos = readTodos(ctx);
  return {
    type: 'detail',
    title: 'Developer Utilities',
    markdown: [
      '# Developer Utilities',
      '',
      'An example extension for [Waypoint](https://github.com/alexsilver8/waypoint), to copy and change. ' +
        'Each of its commands shows something different an extension can do.',
      '',
      '## Try',
      '',
      '- [x] Open this page',
      `- [${todos.length > 0 ? 'x' : ' '}] Add a to-do with **New To-do**, a form`,
      '- [ ] Search npm from the root search: type a name, then pick **Search npm Packages**',
      '',
      '## Running on',
      '',
      '| Component | Version |',
      '| :-- | --: |',
      ...versions.map(([name, version]) => `| ${name} | \`${version}\` |`),
      '',
      '> Raw HTML like <b>this</b> is shown as text, never run.',
      '',
      '```js',
      "return { type: 'detail', markdown: '# Hello' };",
      '```',
    ].join('\n'),
    metadata: [
      { label: 'Commands', value: '5' },
      { label: 'To-dos', value: String(todos.length) },
      { label: 'Platform', value: ctx.platform },
      { label: 'Folder', value: ctx.extension.path },
    ],
    actions: [
      { type: 'callback', id: 'new', title: 'New To-do…' },
      {
        type: 'open-url',
        url: 'https://github.com/alexsilver8/waypoint/blob/main/docs/extensions.md',
        title: 'Read the Docs',
      },
      {
        type: 'copy',
        text: JSON.stringify(Object.fromEntries(versions), null, 2),
        title: 'Copy Versions',
        shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
      },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    uuid: {
      view: uuidView,
      onAction: (id, _payload, ctx) => (id === 'regenerate' ? { replace: uuidView(ctx) } : undefined),
    },
    'npm-search': { view: npmView },
    todos: { view: todosView, onAction: todoAction },
    'new-todo': { view: () => newTodoForm(), onAction: todoAction },
    about: { view: aboutView, onAction: todoAction },
  },
};
