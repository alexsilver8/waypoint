// Script Commands: run your own scripts from the launcher. A script says in comments near its
// top what it's called and how it runs, Raycast's way (`# @raycast.title`) or Waypoint's
// (`# @waypoint.title`), so the scripts in raycast/script-commands work as they are. Scripts
// live in Waypoint's script folder, or any folder you add by typing its path.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import {
  asPlainPreview,
  expandHome,
  fileNameFor,
  fillArguments,
  firstLine,
  HEADER_BYTES,
  interpreterFor,
  LANGUAGES,
  lastLine,
  matchScripts,
  mightBeScript,
  parseInvocation,
  parseScript,
  shownForm,
  spawnArgs,
  template,
  typedForm,
  usage,
} from './scripts.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListSection} ListSection */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('@waypoint-org/api').ActionResult} ActionResult */
/** @typedef {import('@waypoint-org/api').Icon} Icon */
/** @typedef {import('./scripts.js').Script} Script */

/**
 * @typedef {object} Run A script running, or that ran, and what it printed.
 * @property {string} id
 * @property {Script} script
 * @property {string[]} args
 * @property {string} output
 * @property {number} startedAt
 * @property {number} [endedAt]
 * @property {number | null} [code] Its exit code; `null` when a signal stopped it.
 * @property {number} [pid]
 * @property {Promise<void>} done
 */

const home = homedir();
const RESCAN_AFTER_MS = 10_000;
/** How long to wait for a script before showing what it has printed so far; calls time out at 10 s. */
/** What a call may take in all: the launcher gives up on an extension after 10 seconds. */
const BUDGET_MS = 8000;
const INLINE_WAIT_MS = 30_000;
const MAX_OUTPUT = 1_000_000;
const MAX_DEPTH = 3;
const MAX_FILES = 3000;
const SCRIPTS_REPO = 'https://github.com/raycast/script-commands';

/** @type {{ key: string, at: number, scripts: Script[] } | undefined} */
let scanned;
/** @type {Map<string, Run>} */
const runs = new Map();
let nextRun = 1;
/** The first line each inline script printed, and when. @type {Map<string, { at: number, line: string }>} */
const inline = new Map();
/** @type {Set<string>} */
const refreshing = new Set();

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} path */
function tildify(path) {
  return path === home ? '~' : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** @param {string} path */
function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} platform */
function fileManager(platform) {
  return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'Files';
}

/** @param {Context} ctx */
function ownFolder(ctx) {
  return join(ctx.supportPath, 'scripts');
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
 * Waypoint's own script folder, made if it isn't there yet, then the folders you added.
 * @param {Context} ctx
 * @returns {Array<{ path: string, added: boolean }>}
 */
function folders(ctx) {
  const own = ownFolder(ctx);
  try {
    mkdirSync(own, { recursive: true });
  } catch {
    // Read-only data folder: the added folders still work.
  }
  return [
    { path: own, added: false },
    ...addedFolders(ctx)
      .filter((path) => path !== own && isFolder(path))
      .map((path) => ({ path, added: true })),
  ];
}

/**
 * The start of a file, where its headers are.
 * @param {string} path
 */
async function readHead(path) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await file.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

/**
 * Every script in the folders and the folders inside them, a few levels down.
 * @param {string[]} roots
 * @returns {Promise<Script[]>}
 */
async function findScripts(roots) {
  /** @type {string[]} */
  const paths = [];
  /**
   * @param {string} dir
   * @param {number} depth
   */
  const walk = async (dir, depth) => {
    if (paths.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(path, depth + 1);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && mightBeScript(path) && paths.length < MAX_FILES) {
        paths.push(path);
      }
    }
  };
  for (const root of roots) await walk(root, 0);

  /** @type {Script[]} */
  const scripts = [];
  for (let index = 0; index < paths.length; index += 32) {
    const batch = await Promise.all(
      paths.slice(index, index + 32).map(async (path) => {
        try {
          return parseScript(path, await readHead(path), home);
        } catch {
          return undefined;
        }
      }),
    );
    for (const script of batch) if (script) scripts.push(script);
  }
  return scripts.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * @param {Context} ctx
 * @param {boolean} [fresh] Look again even if the folders were searched a moment ago.
 */
async function loadScripts(ctx, fresh = false) {
  const roots = folders(ctx).map((folder) => folder.path);
  const key = roots.join('\n');
  if (!fresh && scanned && scanned.key === key && Date.now() - scanned.at < RESCAN_AFTER_MS) return scanned.scripts;
  const scripts = await findScripts(roots);
  scanned = { key, at: Date.now(), scripts };
  return scripts;
}

/**
 * Apps started from the Dock or Start menu get a short PATH, so the places Homebrew and pip put
 * programs are added, for scripts that call them.
 * @param {string} platform
 */
function scriptEnv(platform) {
  if (platform === 'win32') return process.env;
  const extra = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(home, '.local', 'bin'),
  ];
  const standard = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const path = [...new Set([...extra, ...(process.env.PATH ?? '').split(delimiter), ...standard])].filter(Boolean);
  return { ...process.env, PATH: path.join(delimiter) };
}

/** @param {number} deadline */
const left = (deadline) => Math.max(0, deadline - Date.now());

/**
 * Starts a script, keeping what it prints.
 * @param {Script} script
 * @param {string[]} args
 * @param {string} platform
 * @param {{ keep?: boolean }} [options] `keep: false` for runs nobody will look at again.
 * @returns {Promise<Run>}
 */
async function startRun(script, args, platform, { keep = true } = {}) {
  const head = await readHead(script.path);
  const command = spawnArgs(interpreterFor(script.path, head, platform), args);
  const id = String(nextRun++);
  /** @type {(value: void) => void} */
  let finish = () => {};
  /** @type {Run} */
  const run = {
    id,
    script,
    args,
    output: '',
    startedAt: Date.now(),
    done: new Promise((resolve) => {
      finish = resolve;
    }),
  };
  if (keep) {
    runs.set(id, run);
    // Keep the last few finished runs, for Run Again, and every one still going, to stop.
    const finished = [...runs.values()].filter((each) => each.endedAt !== undefined);
    for (const old of finished.slice(0, -20)) runs.delete(old.id);
  }

  const child = spawn(command.file, command.args, {
    cwd: script.cwd && isFolder(script.cwd) ? script.cwd : dirname(script.path),
    env: scriptEnv(platform),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: command.verbatim,
    // Its own process group, so stopping it stops what it started too.
    detached: platform !== 'win32',
  });
  run.pid = child.pid;
  const append = (/** @type {string} */ text) => {
    run.output += text;
    if (run.output.length > MAX_OUTPUT) run.output = run.output.slice(-MAX_OUTPUT);
  };
  // Decoded as a stream, so a character split between two reads arrives whole.
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const end = (/** @type {number | null} */ code) => {
    if (run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    run.code = code;
    finish();
  };
  child.once('error', (error) => {
    const missing = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT';
    run.output += missing
      ? `Couldn't run it: ${command.file} isn't installed, or isn't where Waypoint looks.\n`
      : `Couldn't run it: ${error.message}\n`;
    end(127);
  });
  child.once('close', (code) => end(code));
  return run;
}

/**
 * Waits for a run to finish, up to `ms`.
 * @param {Run} run
 * @param {number} ms
 */
async function settle(run, ms) {
  let timer;
  await Promise.race([run.done, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/** @param {Run} run */
function stopRun(run) {
  if (run.endedAt !== undefined || !run.pid) return;
  try {
    process.kill(process.platform === 'win32' ? run.pid : -run.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(run.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Starts a script without watching it, for `silent` mode: the launcher closes straight away.
 * @param {Script} script
 * @param {string[]} args
 * @param {string} platform
 * @returns {Promise<void>}
 */
async function startSilently(script, args, platform) {
  const command = spawnArgs(interpreterFor(script.path, await readHead(script.path), platform), args);
  await new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: script.cwd && isFolder(script.cwd) ? script.cwd : dirname(script.path),
      env: scriptEnv(platform),
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: command.verbatim,
      // Not on Windows: a detached PowerShell or cmd.exe has no console, and exits at once.
      detached: platform !== 'win32',
    });
    child.once('error', (error) =>
      reject(
        /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
          ? new Error(`${command.file} isn't installed.`)
          : error,
      ),
    );
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
  });
}

/** @param {number} ms */
function took(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/**
 * What a script printed, in the preview pane.
 * @param {Run} run
 * @returns {ListView}
 */
function outputView(run) {
  const running = run.endedAt === undefined;
  const status = running
    ? 'Still running…'
    : run.code === 0
      ? `Finished in ${took(/** @type {number} */ (run.endedAt) - run.startedAt)}`
      : run.code === null
        ? 'Stopped'
        : `Failed with exit code ${run.code}`;
  const output = run.output;
  /** @type {Action[]} */
  const actions = [
    { type: 'copy', text: output, title: 'Copy Output' },
    { type: 'paste', text: output, title: 'Paste Output' },
  ];
  if (running) {
    actions.push(
      {
        type: 'callback',
        id: 'refresh-output',
        title: 'Refresh',
        payload: run.id,
        shortcut: { key: 'r', modifiers: ['mod'] },
      },
      {
        type: 'callback',
        id: 'stop',
        title: 'Stop Script',
        payload: run.id,
        style: 'destructive',
        shortcut: { key: '.', modifiers: ['mod'] },
      },
    );
  } else {
    actions.push({
      type: 'callback',
      id: 'run-again',
      title: 'Run Again',
      payload: run.id,
      shortcut: { key: 'r', modifiers: ['mod'] },
    });
  }
  actions.push({ type: 'reveal-path', path: run.script.path, title: 'Show Script' });
  return {
    type: 'list',
    title: run.script.title,
    sections: [
      {
        title: status,
        items: [
          {
            id: `output:${run.id}`,
            title: firstLine(output) || (running ? 'Nothing printed yet' : 'It printed nothing'),
            icon: { builtin: 'terminal', tint: run.code ? 'red' : 'gray' },
            detail: {
              title: run.script.title,
              body: asPlainPreview(output) || (running ? 'Nothing printed yet.' : 'It printed nothing.'),
              metadata: [
                { label: 'Status', value: status },
                ...(run.args.length > 0 ? [{ label: 'Arguments', value: shownForm(run.script, run.args) }] : []),
                { label: 'Script', value: tildify(run.script.path) },
              ],
            },
            actions,
          },
        ],
      },
    ],
  };
}

/**
 * Runs a script the way its mode says, and what the launcher should do then.
 * @param {Script} script
 * @param {string[]} args
 * @param {Context} ctx
 * @param {{ show: 'push' | 'replace', deadline: number }} options `show` is how to show full
 *   output; by `deadline` the call has to answer, the script running on if need be.
 * @returns {Promise<ActionResult>}
 */
async function runScript(script, args, ctx, { show, deadline }) {
  if (script.mode === 'silent') {
    try {
      await startSilently(script, args, ctx.platform);
    } catch (error) {
      return { toast: `Couldn't run “${script.title}”: ${message(error)}`, toastStyle: 'failure' };
    }
    return { hide: true };
  }
  let run;
  try {
    run = await startRun(script, args, ctx.platform);
  } catch (error) {
    return { toast: `Couldn't run “${script.title}”: ${message(error)}`, toastStyle: 'failure' };
  }
  await settle(run, left(deadline));
  if (script.mode === 'fullOutput') return show === 'push' ? { push: outputView(run) } : { replace: outputView(run) };

  if (run.endedAt === undefined) return { toast: `“${script.title}” is still running` };
  if (script.mode === 'inline') inline.set(script.path, { at: Date.now(), line: firstLine(run.output) });
  const said = lastLine(run.output);
  if (run.code === 0) return { toast: said || `Ran “${script.title}”` };
  return { toast: said || `“${script.title}” failed with exit code ${run.code}`, toastStyle: 'failure' };
}

/**
 * Runs inline scripts whose first line is out of date, a few at a time, in the background; the
 * list shows what they print the next time it's drawn.
 * @param {Script[]} scripts
 * @param {string} platform
 */
function refreshInline(scripts, platform) {
  const now = Date.now();
  for (const script of scripts) {
    if (script.mode !== 'inline' || refreshing.has(script.path) || refreshing.size >= 3) continue;
    if (script.arguments.some((argument) => !argument.optional)) continue;
    const known = inline.get(script.path);
    if (known && now - known.at < (script.refreshSeconds ?? 3600) * 1000) continue;
    refreshing.add(script.path);
    void (async () => {
      try {
        const run = await startRun(script, [], platform, { keep: false });
        await settle(run, INLINE_WAIT_MS);
        if (run.endedAt === undefined) stopRun(run);
        inline.set(script.path, { at: Date.now(), line: run.code === 0 ? firstLine(run.output) : '' });
      } catch {
        inline.set(script.path, { at: Date.now(), line: '' });
      } finally {
        refreshing.delete(script.path);
      }
    })();
  }
}

/**
 * @param {Script} script
 * @returns {Icon}
 */
function iconOf(script) {
  if (!script.icon) return { builtin: 'terminal', tint: 'gray' };
  return script.icon.startsWith('/') || /^[A-Za-z]:[\\/]/.test(script.icon)
    ? { path: script.icon }
    : { emoji: script.icon };
}

/** @type {Record<string, string>} */
const MODE_NAMES = {
  silent: 'Runs and closes the launcher',
  compact: 'Shows the last line it prints',
  fullOutput: 'Shows everything it prints',
  inline: 'Shows its first line here, run again now and then',
};

/**
 * @param {Script} script
 * @param {Context} ctx
 * @returns {ListItem}
 */
function scriptItem(script, ctx) {
  const needsArguments = script.arguments.length > 0;
  /** @type {Action} */
  const primary = needsArguments
    ? { type: 'callback', id: 'arguments', title: 'Type Arguments', payload: script.title }
    : { type: 'callback', id: 'run', title: 'Run Script', payload: { path: script.path, args: [] } };
  /** @type {Action[]} */
  const actions = [
    primary,
    {
      type: 'callback',
      id: 'edit',
      title: 'Edit Script',
      payload: script.path,
      shortcut: { key: 'e', modifiers: ['mod'] },
    },
    { type: 'reveal-path', path: script.path, title: `Show in ${fileManager(ctx.platform)}` },
    { type: 'copy', text: script.path, title: 'Copy Path', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    { type: 'callback', id: 'reload', title: 'Reload Scripts', shortcut: { key: 'r', modifiers: ['mod'] } },
  ];
  if (script.authorUrl) actions.push({ type: 'open-url', url: script.authorUrl, title: 'Open Author’s Page' });
  const line = script.mode === 'inline' ? inline.get(script.path)?.line : undefined;
  return {
    id: script.path,
    title: script.title,
    subtitle: script.description,
    accessory: line || (needsArguments ? usage(script).slice(script.title.length + 2) : ''),
    icon: iconOf(script),
    detail: {
      title: script.title,
      body: script.description ?? '',
      metadata: [
        { label: 'Mode', value: MODE_NAMES[script.mode] ?? script.mode },
        ...(needsArguments ? [{ label: 'Type', value: usage(script) }] : []),
        ...(script.needsConfirmation ? [{ label: 'Asks first', value: 'Yes' }] : []),
        ...(script.author ? [{ label: 'Author', value: script.author }] : []),
        { label: 'File', value: tildify(script.path) },
      ],
    },
    actions,
  };
}

/**
 * What's typed after a script's title and a colon: its arguments, and running it with them.
 * @param {Script} script
 * @param {string} rest
 * @returns {ListSection[]}
 */
function argumentSections(script, rest) {
  const filled = fillArguments(script, rest);
  const spec = script.arguments[filled.next];
  /** @type {ListItem[]} */
  const items = [];

  if (filled.complete) {
    const typed = typedForm(script, filled.values);
    items.push({
      id: 'run',
      title: `Run “${script.title}”`,
      subtitle: typed ? `With ${shownForm(script, filled.values)}` : 'Without arguments',
      icon: iconOf(script),
      actions: [
        { type: 'callback', id: 'run', title: 'Run Script', payload: { path: script.path, args: filled.values } },
      ],
    });
  }
  // A dropdown: its choices, narrowed by what's typed. Picking one runs the script once
  // nothing else is needed, else it's typed in and the next argument is asked for.
  if (spec?.type === 'dropdown' && !filled.problem) {
    const partial = filled.partial.toLowerCase();
    const after = script.arguments.slice(filled.next + 1);
    for (const option of spec.options ?? []) {
      const matches = option.title.toLowerCase().includes(partial) || option.value.toLowerCase().includes(partial);
      if (partial && !matches) continue;
      const values = [...filled.values, spec.percentEncoded ? encodeURIComponent(option.value) : option.value];
      items.push({
        id: `option:${option.value}`,
        title: option.title,
        subtitle: spec.placeholder,
        icon: iconOf(script),
        actions: after.every((each) => each.optional)
          ? [
              {
                type: 'callback',
                id: 'run',
                title: `Run with ${option.title}`,
                payload: { path: script.path, args: values },
              },
            ]
          : [
              {
                type: 'callback',
                id: 'type',
                title: `Choose ${option.title}`,
                payload: `${script.title}: ${typedForm(script, values)} `,
              },
            ],
      });
    }
  }
  if (items.length === 0) {
    items.push({
      id: 'waiting',
      title:
        filled.problem ??
        `Type the ${spec?.placeholder ?? 'arguments'}${spec?.type === 'password' ? ' (it shows as you type)' : ''}`,
      subtitle: usage(script),
      icon: { builtin: filled.problem ? 'alert' : 'text', tint: filled.problem ? 'orange' : 'gray' },
      actions: [],
    });
  }
  return [{ title: usage(script), items }];
}

/**
 * The folders searched, and ways to get more scripts.
 * @param {Context} ctx
 * @param {Array<{ path: string, added: boolean }>} folderList
 * @param {Script[]} scripts
 * @returns {ListSection}
 */
function foldersSection(ctx, folderList, scripts) {
  /** @type {ListItem[]} */
  const items = folderList.map((folder) => {
    const count = scripts.filter((script) => !relative(folder.path, script.path).startsWith('..')).length;
    /** @type {Action[]} */
    const actions = [
      { type: 'open-path', path: folder.path, title: `Open in ${fileManager(ctx.platform)}` },
      { type: 'copy', text: folder.path, title: 'Copy Path', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    ];
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
      subtitle: folder.added ? 'Added by you' : "Waypoint's script folder",
      accessory: `${count} ${count === 1 ? 'script' : 'scripts'}`,
      icon: { builtin: 'folder', tint: 'gray' },
      actions,
    };
  });
  items.push(
    {
      id: 'create',
      title: 'Create Script Command',
      subtitle: 'From a template',
      icon: { builtin: 'sparkles', tint: 'blue' },
      actions: [
        {
          type: 'open-command',
          ref: { extension: 'script-commands', command: 'create' },
          title: 'Create Script Command',
        },
      ],
    },
    {
      id: 'browse',
      title: 'Browse Raycast’s Script Commands',
      subtitle: 'Hundreds of ready-made scripts that work here too',
      icon: { builtin: 'globe', tint: 'blue' },
      actions: [{ type: 'open-url', url: SCRIPTS_REPO, title: 'Open on GitHub' }],
    },
  );
  return { title: 'Script folders', items };
}

/**
 * Typing a folder's path: adding it.
 * @param {string} text
 * @param {Array<{ path: string, added: boolean }>} folderList
 * @returns {{ sections: ListSection[], emptyText?: string }}
 */
function addFolderSections(text, folderList) {
  const path = expandHome(text, home);
  if (!isFolder(path)) return { sections: [], emptyText: `There's no folder at ${tildify(path)}.` };
  if (folderList.some((folder) => folder.path === path)) {
    return { sections: [], emptyText: `${tildify(path)} is searched already.` };
  }
  return {
    sections: [
      {
        items: [
          {
            id: `add:${path}`,
            title: `Add “${tildify(path)}”`,
            subtitle: 'Look for scripts in this folder too',
            icon: { builtin: 'folder', tint: 'blue' },
            actions: [{ type: 'callback', id: 'add-folder', title: 'Add Folder', payload: path }],
          },
        ],
      },
    ],
  };
}

/**
 * Scripts by package, the ones without a package first.
 * @param {Script[]} scripts
 * @param {Context} ctx
 * @returns {ListSection[]}
 */
function packageSections(scripts, ctx) {
  /** @type {Map<string, Script[]>} */
  const byPackage = new Map();
  for (const script of scripts) {
    const name = script.packageName ?? '';
    byPackage.set(name, [...(byPackage.get(name) ?? []), script]);
  }
  return [...byPackage.keys()]
    .sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map((name) => ({
      title: name || 'Scripts',
      items: (byPackage.get(name) ?? []).map((script) => scriptItem(script, ctx)),
    }));
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function searchView(ctx) {
  const scripts = await loadScripts(ctx);
  refreshInline(scripts, ctx.platform);
  const text = ctx.query.trim();
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Script Commands',
    searchPlaceholder: 'Search scripts, or type a folder to add…',
    filtering: false,
  };

  const invocation = parseInvocation(ctx.query, scripts);
  if (invocation) return { ...base, sections: argumentSections(invocation.script, invocation.rest) };

  const folderList = folders(ctx);
  if (/^(~([\\/]|$)|\/|[A-Za-z]:[\\/])/.test(text)) return { ...base, ...addFolderSections(text, folderList) };

  if (text) {
    const matches = matchScripts(scripts, text);
    return {
      ...base,
      emptyText: `No script matches “${text}”.`,
      sections:
        matches.length > 0 ? [{ title: 'Results', items: matches.map((script) => scriptItem(script, ctx)) }] : [],
    };
  }
  return { ...base, sections: [...packageSections(scripts, ctx), foldersSection(ctx, folderList, scripts)] };
}

/**
 * Asks before running a script that says it should be asked about.
 * @param {Script} script
 * @param {string[]} args
 * @returns {ListView}
 */
function confirmView(script, args) {
  return {
    type: 'list',
    title: script.title,
    searchPlaceholder: 'Press ↵ to run it, or Esc to go back',
    sections: [
      {
        items: [
          {
            id: 'confirm',
            title: `Run “${script.title}”`,
            subtitle: script.description,
            icon: iconOf(script),
            actions: [
              {
                type: 'callback',
                id: 'run',
                title: 'Run Script',
                payload: { path: script.path, args, confirmed: true },
                style: 'destructive',
              },
            ],
          },
          {
            id: 'cancel',
            title: 'Cancel',
            icon: { builtin: 'close', tint: 'gray' },
            actions: [{ type: 'callback', id: 'cancel', title: 'Cancel' }],
          },
        ],
      },
    ],
  };
}

/**
 * Opens a script in a text editor: the default one on macOS, Notepad on Windows, and what
 * opens text files on Linux.
 * @param {string} path
 * @param {string} platform
 * @returns {Promise<void>}
 */
function editFile(path, platform) {
  const [file, args] =
    platform === 'darwin'
      ? ['open', ['-t', path]]
      : platform === 'win32'
        ? ['notepad.exe', [path]]
        : ['xdg-open', [path]];
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * The script at a path, as of the last look through the folders, or read now if it's new
 * since: a whole new look could take longer than the call has.
 * @param {Context} ctx
 * @param {string} path
 * @returns {Promise<Script | undefined>}
 */
async function scriptAt(ctx, path) {
  const known = (await loadScripts(ctx)).find((each) => each.path === path);
  if (known) return known;
  const inFolder = folders(ctx).some((folder) => !relative(folder.path, path).startsWith('..'));
  if (!inFolder) return undefined;
  try {
    return parseScript(path, await readHead(path), home);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} id
 * @param {unknown} payload
 * @param {Context} ctx
 * @returns {Promise<ActionResult | undefined>}
 */
async function onSearchAction(id, payload, ctx) {
  const deadline = Date.now() + BUDGET_MS;
  if (id === 'reload') {
    await loadScripts(ctx, true);
    inline.clear();
    return { replace: await searchView(ctx), toast: 'Reloaded your scripts' };
  }
  if (id === 'arguments' && typeof payload === 'string') return { search: `${payload}: ` };
  if (id === 'type' && typeof payload === 'string') return { search: payload };
  if (id === 'cancel') return { pop: true };
  if (id === 'add-folder' && typeof payload === 'string' && isFolder(payload)) {
    ctx.storage.set('folders', [...addedFolders(ctx).filter((folder) => folder !== payload), payload]);
    const scripts = await loadScripts(ctx, true);
    const count = scripts.filter((script) => !relative(payload, script.path).startsWith('..')).length;
    return {
      replace: await searchView({ ...ctx, query: '' }),
      clearSearch: true,
      toast: `Added ${tildify(payload)}: ${count} ${count === 1 ? 'script' : 'scripts'}`,
    };
  }
  if (id === 'remove-folder' && typeof payload === 'string') {
    ctx.storage.set(
      'folders',
      addedFolders(ctx).filter((folder) => folder !== payload),
    );
    await loadScripts(ctx, true);
    return { replace: await searchView(ctx), toast: `Stopped searching ${tildify(payload)}` };
  }
  if (id === 'edit' && typeof payload === 'string') {
    try {
      await editFile(payload, ctx.platform);
    } catch (error) {
      return { toast: `Couldn't open an editor: ${message(error)}`, toastStyle: 'failure' };
    }
    return { hide: true };
  }
  if (id === 'run' && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const { path, args, confirmed } = /** @type {Record<string, unknown>} */ (payload);
    if (typeof path !== 'string') return undefined;
    const script = await scriptAt(ctx, path);
    if (!script) return { toast: "That script isn't there any more.", toastStyle: 'failure' };
    const values = Array.isArray(args) ? args.filter((arg) => typeof arg === 'string') : [];
    if (script.needsConfirmation && confirmed !== true) return { push: confirmView(script, values) };
    const result = await runScript(script, values, ctx, { show: confirmed === true ? 'replace' : 'push', deadline });
    // Back from asking first, unless the output is shown in its place.
    return confirmed === true && !result.replace && !result.hide ? { ...result, pop: true } : result;
  }
  if (typeof payload !== 'string') return undefined;
  const run = runs.get(payload);
  if (!run) return { toast: 'That run is gone; run the script again.', toastStyle: 'failure' };
  if (id === 'refresh-output') {
    await settle(run, 2000);
    return { replace: outputView(run) };
  }
  if (id === 'stop') {
    stopRun(run);
    await settle(run, 2000);
    return { replace: outputView(run), toast: `Stopped “${run.script.title}”` };
  }
  if (id === 'run-again') {
    const again = await startRun(run.script, run.args, ctx.platform);
    await settle(again, left(deadline));
    return { replace: outputView(again) };
  }
  return undefined;
}

/**
 * Making a script: type its title, pick a language.
 * @param {Context} ctx
 * @returns {ListView}
 */
function createView(ctx) {
  const title = ctx.query.trim();
  const languages = LANGUAGES.filter((language) => language.platforms.includes(ctx.platform));
  return {
    type: 'list',
    title: 'Create Script Command',
    searchPlaceholder: 'The new script’s title…',
    filtering: false,
    sections: [
      {
        title: title ? `Create “${title}”` : 'Type a title, then pick a language',
        items: languages.map((language) => ({
          id: language.id,
          title: `${language.name} Script`,
          subtitle: fileNameFor(title || 'New Script', language.extension),
          icon: { builtin: 'terminal', tint: 'blue' },
          actions: [
            {
              type: 'callback',
              id: 'create',
              title: `Create ${language.name} Script`,
              payload: { language: language.id, title: title || 'New Script' },
            },
          ],
        })),
      },
    ],
  };
}

/**
 * Writes the new script into Waypoint's script folder and opens it to edit.
 * @param {string} id
 * @param {unknown} payload
 * @param {Context} ctx
 * @returns {Promise<ActionResult | undefined>}
 */
async function onCreateAction(id, payload, ctx) {
  if (id !== 'create' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const { language: languageId, title } = /** @type {Record<string, unknown>} */ (payload);
  const language = LANGUAGES.find((each) => each.id === languageId);
  if (!language || typeof title !== 'string') return undefined;
  const dir = ownFolder(ctx);
  mkdirSync(dir, { recursive: true });
  let path = join(dir, fileNameFor(title, language.extension));
  for (let n = 2; existsSync(path); n++) path = join(dir, fileNameFor(`${title} ${n}`, language.extension));
  writeFileSync(path, template(language, title));
  if (ctx.platform !== 'win32') chmodSync(path, 0o755);
  scanned = undefined;
  try {
    await editFile(path, ctx.platform);
  } catch {
    return { toast: `Created ${tildify(path)}` };
  }
  return { hide: true };
}

/** @type {Extension} */
export default {
  commands: {
    search: { view: searchView, onAction: onSearchAction },
    create: { view: createView, onAction: onCreateAction },
  },
};
