// Homebrew: search every formula and cask, see what you've installed and what's out of date.
// Installing, upgrading and uninstalling run in a Terminal window, so you can watch brew work
// and type your password when a cask asks for it.
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { brewCommand, findBrew, isPackageName, pageUrl, parseInstalled, parseNames, searchNames } from './brew.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('@waypoint-org/api').ActionResult} ActionResult */
/** @typedef {import('./brew.js').Package} Package */
/** @typedef {import('./brew.js').Kind} Kind */

const NAMES_MAX_AGE_MS = 24 * 60 * 60_000;
const INSTALLED_MAX_AGE_MS = 60_000;
const MAX_RESULTS = 60;
const NOT_INSTALLED = "Homebrew isn't installed. Get it from brew.sh.";

/** @type {Array<{ name: string, kind: Kind }> | undefined} */
let names;
/** @type {{ at: number, packages: Package[] } | undefined} */
let installed;

/**
 * Runs brew without its slow extras (auto-update, analytics, hints) and returns what it printed.
 * @param {string} brew
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function run(brew, args) {
  const env = {
    ...process.env,
    PATH: [dirname(brew), process.env.PATH, '/usr/bin', '/bin'].filter(Boolean).join(delimiter),
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_ENV_HINTS: '1',
    HOMEBREW_NO_COLOR: '1',
  };
  return new Promise((resolve, reject) => {
    execFile(brew, args, { timeout: 9000, maxBuffer: 64 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      // brew starts its complaint with "Error:"; warnings and hints may come before it.
      const lines = `${stderr}`.split('\n').map((line) => line.trim());
      const said = lines.find((line) => line.startsWith('Error:')) ?? lines.find(Boolean);
      reject(new Error(said?.replace(/^Error:\s*/, '') || error.message));
    });
  });
}

/**
 * Every formula and cask name, from a copy kept for a day in the extension's folder.
 * @param {Context} ctx
 * @param {string} brew
 */
async function loadNames(ctx, brew) {
  if (names) return names;
  const file = join(ctx.supportPath, 'names.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - saved.at < NAMES_MAX_AGE_MS && Array.isArray(saved.names)) {
      names = saved.names;
      return /** @type {Array<{ name: string, kind: Kind }>} */ (names);
    }
  } catch {
    // Nothing saved yet.
  }
  const [formulae, casks] = await Promise.all([
    run(brew, ['formulae']),
    // Linux has no casks.
    ctx.platform === 'darwin' ? run(brew, ['casks']).catch(() => '') : Promise.resolve(''),
  ]);
  const list = [
    ...parseNames(formulae).map((name) => ({ name, kind: /** @type {Kind} */ ('formula') })),
    ...parseNames(casks).map((name) => ({ name, kind: /** @type {Kind} */ ('cask') })),
  ];
  // Empty until `brew update` has downloaded Homebrew's package list once.
  if (list.length === 0) return list;
  names = list;
  try {
    mkdirSync(ctx.supportPath, { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now(), names: list }));
  } catch {
    // Searching still works; it just asks brew again next time.
  }
  return list;
}

/**
 * What's installed, asked again after a minute.
 * @param {string} brew
 */
async function loadInstalled(brew) {
  if (installed && Date.now() - installed.at < INSTALLED_MAX_AGE_MS) return installed.packages;
  const packages = parseInstalled(await run(brew, ['info', '--json=v2', '--installed']));
  installed = { at: Date.now(), packages };
  return packages;
}

/** @param {Package} pkg */
function versionText(pkg) {
  if (pkg.pinned) return `${pkg.version ?? ''} · Pinned`.replace(/^ · /, '');
  if (pkg.outdated && pkg.version && pkg.latest) return `${pkg.version} → ${pkg.latest}`;
  return pkg.version ?? '';
}

/** @type {Action} */
const REFRESH = { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } };

/**
 * @param {{ name: string, kind: Kind }} entry
 * @param {Package | undefined} pkg What's installed under this name, if anything.
 * @returns {ListItem}
 */
function packageItem(entry, pkg) {
  const { name, kind } = entry;
  const target = { name, kind };
  const page = pageUrl(name, kind);
  /** @type {Action[]} */
  const actions = [];
  if (!pkg) {
    actions.push(
      { type: 'callback', id: 'install', title: 'Install in Terminal', payload: target },
      { type: 'copy', text: brewCommand('install', name, kind), title: 'Copy Install Command' },
    );
  } else if (pkg.outdated && !pkg.pinned) {
    actions.push({ type: 'callback', id: 'upgrade', title: 'Upgrade in Terminal', payload: target });
  }
  if (pkg?.homepage) actions.push({ type: 'open-url', url: pkg.homepage, title: 'Open Homepage' });
  if (page)
    actions.push({
      type: 'open-url',
      url: page,
      title: 'Open on formulae.brew.sh',
      shortcut: { key: 'o', modifiers: ['mod', 'shift'] },
    });
  actions.push(
    { type: 'copy', text: name, title: 'Copy Name', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    REFRESH,
  );
  if (pkg) {
    actions.push({
      type: 'callback',
      id: 'uninstall',
      title: 'Uninstall in Terminal',
      payload: target,
      style: 'destructive',
      shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
    });
  }

  const short = name.slice(name.lastIndexOf('/') + 1);
  const tap = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : undefined;
  const kindText = kind === 'cask' ? 'Cask' : 'Formula';
  const body = pkg ? (pkg.desc ?? short) : `Not installed.\n\n${brewCommand('install', name, kind)}`;
  return {
    id: `${kind}:${name}`,
    title: short,
    subtitle: [pkg?.title !== short ? pkg?.title : undefined, tap].filter(Boolean).join(' · ') || pkg?.desc || '',
    accessory: pkg ? versionText(pkg) || 'Installed' : kindText,
    icon: { builtin: kind === 'cask' ? 'app' : 'terminal', tint: pkg ? (pkg.outdated ? 'yellow' : 'green') : 'orange' },
    keywords: [name, ...(pkg?.title ? [pkg.title] : []), ...(pkg?.desc ? [pkg.desc] : [])],
    detail: {
      title: pkg?.title ?? short,
      body,
      metadata: [
        { label: 'Kind', value: kindText },
        ...(pkg?.version ? [{ label: 'Installed', value: pkg.version }] : []),
        ...(pkg?.latest ? [{ label: 'Latest', value: pkg.latest }] : []),
        ...(pkg && !pkg.onRequest ? [{ label: 'Installed as', value: 'A dependency' }] : []),
        ...(tap ? [{ label: 'Tap', value: tap }] : []),
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function searchView(ctx) {
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Homebrew',
    searchPlaceholder: 'Search formulae and casks…',
    filtering: false,
  };
  const brew = findBrew();
  if (!brew) return { ...base, emptyText: NOT_INSTALLED, sections: [] };
  const query = ctx.query.trim();

  /** @type {Array<{ name: string, kind: Kind }>} */
  let all;
  try {
    all = await loadNames(ctx, brew);
  } catch (error) {
    return {
      ...base,
      emptyText: `Couldn't get the package list from brew: ${error instanceof Error ? error.message : String(error)}`,
      sections: [],
    };
  }
  if (all.length === 0) {
    return {
      ...base,
      emptyText: "Homebrew hasn't downloaded its package list yet.",
      sections: [
        {
          items: [
            {
              id: 'update',
              title: 'Run brew update',
              subtitle: 'Downloads the list of formulae and casks',
              icon: { builtin: 'refresh', tint: 'orange' },
              actions: [{ type: 'callback', id: 'update', title: 'Run in Terminal' }, REFRESH],
            },
          ],
        },
      ],
    };
  }
  if (!query) {
    return { ...base, emptyText: `Type to search ${all.length.toLocaleString()} formulae and casks.`, sections: [] };
  }
  /** @type {Map<string, Package>} */
  const mine = new Map();
  try {
    for (const pkg of await loadInstalled(brew)) mine.set(`${pkg.kind}:${pkg.name}`, pkg);
  } catch {
    // Results just won't say what's installed.
  }
  const results = searchNames(all, query, MAX_RESULTS);
  return {
    ...base,
    emptyText: `No formula or cask matches “${query}”.`,
    sections: [{ items: results.map((entry) => packageItem(entry, mine.get(`${entry.kind}:${entry.name}`))) }],
  };
}

/** @returns {Promise<ListView>} */
async function installedView() {
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Installed with Homebrew',
    searchPlaceholder: 'Search installed packages…',
  };
  const brew = findBrew();
  if (!brew) return { ...base, emptyText: NOT_INSTALLED, sections: [] };
  /** @type {Package[]} */
  let packages;
  try {
    packages = await loadInstalled(brew);
  } catch (error) {
    return {
      ...base,
      emptyText: `Couldn't ask brew what's installed: ${error instanceof Error ? error.message : String(error)}`,
      sections: [],
    };
  }
  const outdated = packages.filter((pkg) => pkg.outdated && !pkg.pinned);
  const item = (/** @type {Package} */ pkg) => packageItem(pkg, pkg);
  /** @type {ListItem[]} */
  const upgradeAll =
    outdated.length > 1
      ? [
          {
            id: 'upgrade-all',
            title: `Upgrade All (${outdated.length})`,
            subtitle: outdated.map((pkg) => pkg.name).join(', '),
            icon: { builtin: 'refresh', tint: 'yellow' },
            actions: [
              { type: 'callback', id: 'upgrade-all', title: 'Upgrade All in Terminal' },
              { type: 'copy', text: brewCommand('upgrade'), title: 'Copy Upgrade Command' },
            ],
            detail: {
              title: 'Upgrade everything that’s out of date',
              body: outdated.map((pkg) => `- ${pkg.name}  ${versionText(pkg)}`).join('\n'),
            },
          },
        ]
      : [];
  return {
    ...base,
    emptyText: 'Nothing installed with Homebrew yet.',
    sections: [
      { title: 'Out of date', items: [...upgradeAll, ...outdated.map(item)] },
      { title: 'Installed', items: packages.filter((pkg) => pkg.onRequest && !outdated.includes(pkg)).map(item) },
      { title: 'Dependencies', items: packages.filter((pkg) => !pkg.onRequest && !outdated.includes(pkg)).map(item) },
    ].filter((section) => section.items.length > 0),
  };
}

/**
 * Opens a terminal window running the command, so brew's progress and any password prompt
 * are in front of you.
 * @param {NodeJS.Platform} platform
 * @param {string} command Only ever brew, a verb, `--cask` and a checked package name.
 * @returns {Promise<void>}
 */
function runInTerminal(platform, command) {
  if (platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile(
        'osascript',
        ['-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script "${command}"`, '-e', 'end tell'],
        { timeout: 8000 },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }
  const script = `${command}; echo; printf 'Done. Press Enter to close this window. '; read _`;
  /** @type {Array<[string, string[]]>} */
  const terminals = [
    ['gnome-terminal', ['--', 'sh', '-c', script]],
    ['konsole', ['-e', 'sh', '-c', script]],
    ['xfce4-terminal', ['-x', 'sh', '-c', script]],
    ['kitty', ['sh', '-c', script]],
    ['alacritty', ['-e', 'sh', '-c', script]],
    ['x-terminal-emulator', ['-e', 'sh', '-c', script]],
  ];
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/usr/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
  ];
  return new Promise((resolve, reject) => {
    const tryNext = (/** @type {number} */ index) => {
      const entry = terminals[index];
      if (!entry) return reject(new Error('No terminal app found.'));
      const [name, args] = entry;
      const dir = dirs.find((candidate) => {
        try {
          accessSync(join(candidate, name), constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
      if (!dir) return tryNext(index + 1);
      const child = spawn(join(dir, name), args, { detached: true, stdio: 'ignore' });
      child.once('error', () => tryNext(index + 1));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    };
    tryNext(0);
  });
}

/**
 * @param {string} id
 * @param {unknown} payload
 * @param {Context} ctx
 * @returns {Promise<ActionResult | undefined>}
 */
async function onAction(id, payload, ctx) {
  const brew = findBrew();
  if (!brew) return { toast: NOT_INSTALLED, toastStyle: 'failure' };
  /** @type {string | undefined} */
  let command;
  if (id === 'upgrade-all') {
    command = `${brew} upgrade`;
  } else if (id === 'update') {
    command = `${brew} update`;
    names = undefined;
  } else if (id === 'install' || id === 'upgrade' || id === 'uninstall') {
    const target = /** @type {{ name?: unknown, kind?: unknown } | null} */ (
      typeof payload === 'object' ? payload : null
    );
    const kind = target?.kind === 'cask' ? 'cask' : 'formula';
    if (!isPackageName(target?.name)) return { toast: "That isn't a package name.", toastStyle: 'failure' };
    command = brewCommand(id, target.name, kind).replace(/^brew/, brew);
  }
  if (!command) return undefined;
  try {
    await runInTerminal(ctx.platform, command);
  } catch (error) {
    return {
      toast: `Couldn't open a terminal: ${error instanceof Error ? error.message : String(error)}`,
      toastStyle: 'failure',
    };
  }
  // The list is out of date once brew finishes.
  installed = undefined;
  return { hide: true };
}

/** @type {Extension} */
export default {
  commands: {
    search: {
      view: searchView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') {
          names = undefined;
          installed = undefined;
          try {
            writeFileSync(join(ctx.supportPath, 'names.json'), '{}');
          } catch {
            // Nothing saved yet.
          }
          return { replace: await searchView(ctx) };
        }
        return onAction(id, payload, ctx);
      },
    },
    installed: {
      view: installedView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') {
          installed = undefined;
          return { replace: await installedView() };
        }
        return onAction(id, payload, ctx);
      },
    },
  },
};
