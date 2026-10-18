// Git Repositories: the repositories in your code folders (~/Developer, ~/Projects, ~/code…),
// most recently worked on first. ↵ opens one in your editor, ⌘T in a terminal. Keep code
// somewhere else? Type the folder's path, like ~/work, and add it.
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { findEditors, findTerminal } from './apps.js';
import { expandHome, findRepos, hostLabel, looksLikePath, matchRepos, timeAgo, USUAL_FOLDERS } from './repos.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListSection} ListSection */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Action} Action */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./repos.js').Repo} Repo */
/** @typedef {import('./apps.js').Opener} Opener */

const RESCAN_AFTER_MS = 5 * 60_000;
const MAX_ITEMS = 500;
const home = homedir();

/** @type {{ key: string, at: number, repos: Repo[] } | undefined} */
let cache;

/** @param {string} path */
function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The real spelling of a folder, so ~/Projects and ~/projects on a case-insensitive disk count
 * as one.
 * @param {string} path
 */
function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** @param {string} path */
function tildify(path) {
  return path === home ? '~' : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/**
 * Folders you added by typing their path.
 * @param {Context} ctx
 * @returns {string[]}
 */
function addedFolders(ctx) {
  const value = ctx.storage.get('folders');
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Everywhere to look: the folders you added, then the usual code folders that exist here.
 * @param {Context} ctx
 * @returns {Array<{ path: string, added: boolean }>}
 */
function roots(ctx) {
  const seen = new Set();
  /** @type {Array<{ path: string, added: boolean }>} */
  const list = [];
  const candidates = [
    ...addedFolders(ctx).map((path) => ({ path, added: true })),
    ...USUAL_FOLDERS.map((folder) => ({ path: join(home, folder), added: false })),
  ];
  for (const { path, added } of candidates) {
    if (!isFolder(path)) continue;
    const real = canonical(path);
    if (seen.has(real)) continue;
    seen.add(real);
    list.push({ path: real, added });
  }
  return list;
}

/**
 * @param {string[]} paths
 * @returns {Promise<Repo[]>}
 */
async function scan(paths) {
  const key = paths.join('\n');
  if (cache && cache.key === key && Date.now() - cache.at < RESCAN_AFTER_MS) return cache.repos;
  const repos = await findRepos(paths);
  cache = { key, at: Date.now(), repos };
  return repos;
}

/**
 * Your editors, the one you used last first.
 * @param {Context} ctx
 * @returns {Opener[]}
 */
function editors(ctx) {
  const all = findEditors(ctx.platform);
  const last = ctx.storage.get('editor');
  const index = all.findIndex((editor) => editor.id === last);
  return index > 0 ? [/** @type {Opener} */ (all[index]), ...all.slice(0, index), ...all.slice(index + 1)] : all;
}

/** @param {NodeJS.Platform} platform */
function fileManager(platform) {
  return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'Files';
}

/**
 * @param {Repo} repo
 * @param {Context} ctx
 * @param {Opener[]} editorList
 * @param {Opener | undefined} terminal
 * @returns {ListItem}
 */
function repoItem(repo, ctx, editorList, terminal) {
  /** @type {Action[]} */
  const actions = editorList.map((editor) => ({
    type: 'callback',
    id: 'open-editor',
    title: `Open in ${editor.name}`,
    payload: { path: repo.path, editor: editor.id },
  }));
  if (terminal) {
    actions.push({
      type: 'callback',
      id: 'open-terminal',
      title: `Open in ${terminal.name}`,
      payload: repo.path,
      shortcut: { key: 't', modifiers: ['mod'] },
    });
  }
  if (repo.webUrl) {
    actions.push({
      type: 'open-url',
      url: repo.webUrl,
      title: `Open on ${hostLabel(repo.webUrl)}`,
      shortcut: { key: 'o', modifiers: ['mod', 'shift'] },
    });
  }
  actions.push(
    { type: 'open-path', path: repo.path, title: `Open in ${fileManager(ctx.platform)}` },
    { type: 'copy', text: repo.path, title: 'Copy Path', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
  );
  if (repo.remote) actions.push({ type: 'copy', text: repo.remote, title: 'Copy Remote URL' });
  if (repo.branch && !repo.branch.startsWith('detached')) {
    actions.push({ type: 'copy', text: repo.branch, title: 'Copy Branch Name' });
  }
  actions.push({
    type: 'callback',
    id: 'refresh',
    title: 'Search Folders Again',
    shortcut: { key: 'r', modifiers: ['mod'] },
  });

  return {
    id: repo.path,
    title: repo.name,
    subtitle: tildify(dirname(repo.path)),
    accessory: repo.branch ?? '',
    icon: { builtin: 'folder', tint: 'orange' },
    detail: {
      title: repo.name,
      body: tildify(repo.path),
      metadata: [
        ...(repo.branch ? [{ label: 'Branch', value: repo.branch }] : []),
        ...(repo.remote ? [{ label: 'Remote', value: repo.remote }] : []),
        ...(repo.changed ? [{ label: 'Last changed', value: timeAgo(repo.changed, Date.now()) }] : []),
        { label: 'Found in', value: tildify(repo.root) },
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @param {string} query
 * @returns {Promise<ListView>}
 */
async function buildView(ctx, query) {
  const folders = roots(ctx);
  const repos = await scan(folders.map((folder) => folder.path));
  const editorList = editors(ctx);
  const terminal = findTerminal(ctx.platform);
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Git Repositories',
    searchPlaceholder: 'Search repositories, or type a folder to add…',
    filtering: false,
  };
  const text = query.trim();

  /** @type {ListSection[]} */
  const sections = [];
  let emptyText =
    folders.length === 0
      ? 'No code folders found. Type the folder that holds your repositories, like ~/work, to add it.'
      : `No git repositories in ${folders.length > 3 ? 'your code folders' : folders.map((folder) => tildify(folder.path)).join(', ')}. Type another folder, like ~/work, to add it.`;

  if (looksLikePath(text)) {
    const path = expandHome(text, home);
    if (isFolder(path)) {
      const real = canonical(path);
      const known = folders.find((folder) => folder.path === real);
      if (!known) {
        sections.push({
          items: [
            {
              id: `add:${real}`,
              title: `Add “${tildify(real)}”`,
              subtitle: 'Look for repositories in this folder too',
              icon: { builtin: 'folder', tint: 'blue' },
              actions: [{ type: 'callback', id: 'add-folder', title: 'Add Folder', payload: real }],
            },
          ],
        });
      }
      const inside = repos.filter((repo) => repo.path === real || repo.path.startsWith(real + sep));
      if (inside.length > 0) {
        sections.push({
          title: 'Repositories',
          items: inside.slice(0, MAX_ITEMS).map((repo) => repoItem(repo, ctx, editorList, terminal)),
        });
      }
    } else {
      emptyText = `There's no folder at ${tildify(path)}.`;
    }
    return { ...base, emptyText, sections };
  }

  const matches = matchRepos(repos, text);
  if (text && matches.length === 0) emptyText = `No repository matches “${text}”.`;
  if (matches.length > 0) {
    sections.push({
      title: text ? 'Results' : 'Recently changed',
      items: matches.slice(0, MAX_ITEMS).map((repo) => repoItem(repo, ctx, editorList, terminal)),
    });
  }
  if (!text && folders.length > 0) {
    sections.push({
      title: 'Folders searched',
      items: folders.map((folder) => {
        const count = repos.filter((repo) => repo.root === folder.path).length;
        /** @type {Action[]} */
        const actions = [{ type: 'open-path', path: folder.path, title: `Open in ${fileManager(ctx.platform)}` }];
        if (folder.added) {
          actions.push({
            type: 'callback',
            id: 'remove-folder',
            title: 'Stop Searching This Folder',
            payload: folder.path,
            style: 'destructive',
          });
        }
        return {
          id: `folder:${folder.path}`,
          title: tildify(folder.path),
          subtitle: folder.added ? 'Added by you' : 'Searched automatically',
          accessory: `${count} ${count === 1 ? 'repository' : 'repositories'}`,
          icon: { builtin: 'folder', tint: 'gray' },
          actions,
        };
      }),
    });
  }
  return { ...base, emptyText, sections };
}

/**
 * @param {unknown} value
 * @returns {string | undefined} The folder, if it's a string naming one.
 */
function folderIn(value) {
  return typeof value === 'string' && isFolder(value) ? value : undefined;
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @type {Extension} */
export default {
  commands: {
    repos: {
      view: (ctx) => buildView(ctx, ctx.query),
      async onAction(id, payload, ctx) {
        if (id === 'refresh') {
          cache = undefined;
          return { replace: await buildView(ctx, ctx.query), toast: 'Searched your folders again' };
        }

        if (id === 'add-folder') {
          const path = folderIn(payload);
          if (!path) return { toast: "That folder isn't there any more.", toastStyle: 'failure' };
          ctx.storage.set('folders', [...addedFolders(ctx).filter((folder) => folder !== path), path]);
          cache = undefined;
          return { replace: await buildView(ctx, ''), clearSearch: true, toast: `Added ${tildify(path)}` };
        }

        if (id === 'remove-folder' && typeof payload === 'string') {
          ctx.storage.set(
            'folders',
            addedFolders(ctx).filter((folder) => folder !== payload),
          );
          cache = undefined;
          return { replace: await buildView(ctx, ctx.query), toast: `Stopped searching ${tildify(payload)}` };
        }

        if (id === 'open-editor' && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
          const path = folderIn(payload.path);
          const editor = findEditors(ctx.platform).find((candidate) => candidate.id === payload.editor);
          if (!path) return { toast: "That repository isn't there any more.", toastStyle: 'failure' };
          if (!editor) return { toast: "That editor isn't installed any more.", toastStyle: 'failure' };
          try {
            await editor.open(path);
          } catch (error) {
            return { toast: `Couldn't open ${editor.name}: ${message(error)}`, toastStyle: 'failure' };
          }
          ctx.storage.set('editor', editor.id);
          return { hide: true };
        }

        if (id === 'open-terminal') {
          const path = folderIn(payload);
          const terminal = findTerminal(ctx.platform);
          if (!path) return { toast: "That repository isn't there any more.", toastStyle: 'failure' };
          if (!terminal) return { toast: 'No terminal app found.', toastStyle: 'failure' };
          try {
            await terminal.open(path);
          } catch (error) {
            return { toast: `Couldn't open ${terminal.name}: ${message(error)}`, toastStyle: 'failure' };
          }
          return { hide: true };
        }
        return undefined;
      },
    },
  },
};
