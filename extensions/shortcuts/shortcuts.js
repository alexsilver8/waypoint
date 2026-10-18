// Reading what the `shortcuts` command prints. Kept free of side effects so it can be tested
// anywhere, not only on a Mac.

/**
 * @typedef {object} Shortcut
 * @property {string} name Unique: the Shortcuts app won't give two shortcuts the same name.
 * @property {string} id Its identifier when `--show-identifiers` gave one, else its name.
 * @property {string} [folder]
 */

const IDENTIFIED = /^(.*\S)\s+\(([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\)$/i;

/**
 * `shortcuts list --show-identifiers`: one shortcut a line, as `Name (UUID)`. A name may hold
 * brackets of its own, so only a UUID in the last pair counts.
 * @param {string} output
 * @param {string} [folder]
 * @returns {Shortcut[]}
 */
export function parseList(output, folder) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = IDENTIFIED.exec(line);
      const shortcut = match
        ? { name: /** @type {string} */ (match[1]), id: /** @type {string} */ (match[2]) }
        : { name: line, id: line };
      return folder ? { ...shortcut, folder } : shortcut;
    });
}

/**
 * `shortcuts list --folders`: one folder name a line.
 * @param {string} output
 */
export function parseFolders(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Every shortcut once, with the folder it's in when it's in one.
 * @param {Shortcut[]} all
 * @param {Shortcut[][]} byFolder
 * @returns {Shortcut[]}
 */
export function withFolders(all, byFolder) {
  /** @type {Map<string, string>} */
  const folderOf = new Map();
  for (const list of byFolder) {
    for (const shortcut of list) if (shortcut.folder) folderOf.set(shortcut.id, shortcut.folder);
  }
  return all.map((shortcut) => {
    const folder = folderOf.get(shortcut.id);
    return folder ? { ...shortcut, folder } : shortcut;
  });
}

/**
 * The shortcuts run recently first, then the rest by folder, the way Shortcuts lists them.
 * @param {Shortcut[]} shortcuts
 * @param {string[]} recent Identifiers, the latest first.
 * @returns {Array<{ title: string, shortcuts: Shortcut[] }>}
 */
export function group(shortcuts, recent) {
  const byId = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]));
  const recentShortcuts = recent.flatMap((id) => {
    const shortcut = byId.get(id);
    return shortcut ? [shortcut] : [];
  });
  const shown = new Set(recentShortcuts.map((shortcut) => shortcut.id));
  /** @type {Map<string, Shortcut[]>} */
  const folders = new Map();
  /** @type {Shortcut[]} */
  const loose = [];
  for (const shortcut of shortcuts) {
    if (shown.has(shortcut.id)) continue;
    if (!shortcut.folder) {
      loose.push(shortcut);
      continue;
    }
    const list = folders.get(shortcut.folder) ?? [];
    list.push(shortcut);
    folders.set(shortcut.folder, list);
  }
  return [
    { title: 'Recently Run', shortcuts: recentShortcuts },
    { title: folders.size > 0 ? 'Other Shortcuts' : 'All Shortcuts', shortcuts: loose },
    ...[...folders.entries()].map(([title, list]) => ({ title, shortcuts: list })),
  ].filter((section) => section.shortcuts.length > 0);
}

/**
 * What went wrong, from what `shortcuts run` printed: its last line, without "Error:".
 * @param {string} stderr
 */
export function failureReason(stderr) {
  const line =
    stderr
      .split(/\r?\n/)
      .map((each) => each.trim())
      .filter(Boolean)
      .pop() ?? '';
  return line.replace(/^Error:\s*/i, '');
}

/**
 * Puts a shortcut first among the recent ones, keeping five.
 * @param {string[]} recent
 * @param {string} id
 */
export function remember(recent, id) {
  return [id, ...recent.filter((each) => each !== id)].slice(0, 5);
}

/**
 * Text quoted for a shell, so nothing in it is expanded: `'Say "hi" for $5'`.
 * @param {string} text
 */
export function shellQuote(text) {
  return `'${text.replace(/'/g, "'\\''")}'`;
}
