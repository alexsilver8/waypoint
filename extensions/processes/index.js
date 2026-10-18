// Processes: every running program with its CPU and memory, busiest first. Search by name,
// process ID or command line; ↵ asks it to quit, ⌘⇧⌫ forces it. Programs the system needs
// (WindowServer, csrss…) are listed but can't be quit from here.
import { execFile } from 'node:child_process';
import {
  appBundleOf,
  formatMemory,
  isEssential,
  mergePs,
  parsePsNames,
  parsePsStats,
  parseTasklist,
  sortProcesses,
} from './processes.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('@waypoint-org/api').ActionResult} ActionResult */
/** @typedef {import('./processes.js').Proc} Proc */

/**
 * @param {string} file
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

/**
 * @param {NodeJS.Platform} platform
 * @returns {Promise<Proc[]>}
 */
export async function listProcesses(platform) {
  if (platform === 'win32') return parseTasklist(await run('tasklist', ['/FO', 'CSV', '/NH']));
  const [stats, names] = await Promise.all([
    run('ps', ['-axww', '-o', 'pid=,ppid=,pcpu=,rss=,user=,args=']),
    run('ps', ['-axww', '-o', 'pid=,comm=']),
  ]);
  return mergePs(parsePsStats(stats), parsePsNames(names));
}

/**
 * @param {Proc} proc
 * @param {Context} ctx
 * @returns {ListItem}
 */
function toItem(proc, ctx) {
  const target = { pid: proc.pid, name: proc.name };
  const essential = isEssential(proc);
  const ours = proc.pid === process.pid || proc.pid === process.ppid;
  /** @type {Action[]} */
  const actions = [];
  if (!essential && !ours) {
    actions.push({ type: 'callback', id: 'quit', title: 'Quit Process', payload: target, style: 'destructive' });
    if (ctx.platform !== 'win32') {
      actions.push({
        type: 'callback',
        id: 'force-quit',
        title: 'Force Quit',
        payload: target,
        style: 'destructive',
        shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
      });
    }
  }
  actions.push({
    type: 'copy',
    text: String(proc.pid),
    title: 'Copy Process ID',
    shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
  });
  if (proc.command) actions.push({ type: 'copy', text: proc.command, title: 'Copy Command Line' });
  if (proc.executable) actions.push({ type: 'reveal-path', path: proc.executable, title: 'Show Program in Folder' });
  actions.push({ type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } });

  const usage = [proc.cpu === undefined ? '' : `${proc.cpu.toFixed(1)}% CPU`, formatMemory(proc.memory)]
    .filter(Boolean)
    .join(' · ');
  const bundle = appBundleOf(proc.executable);
  return {
    id: String(proc.pid),
    title: proc.name,
    subtitle: [`PID ${proc.pid}`, proc.user].filter(Boolean).join(' · '),
    accessory: usage,
    icon: bundle ? { path: bundle } : { builtin: 'terminal', tint: essential ? 'gray' : 'blue' },
    keywords: [String(proc.pid), ...(proc.user ? [proc.user] : []), ...(proc.command ? [proc.command] : [])],
    detail: {
      title: proc.name,
      body: essential
        ? `${proc.command || proc.name}\n\nThe system needs this one, so it can't be quit from here.`
        : proc.command || proc.name,
      metadata: [
        { label: 'Process ID', value: String(proc.pid) },
        ...(proc.ppid ? [{ label: 'Parent', value: String(proc.ppid) }] : []),
        ...(proc.cpu === undefined ? [] : [{ label: 'CPU', value: `${proc.cpu.toFixed(1)}%` }]),
        { label: 'Memory', value: formatMemory(proc.memory) },
        ...(proc.user ? [{ label: 'User', value: proc.user }] : []),
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function processesView(ctx) {
  /** @type {Proc[]} */
  let procs = [];
  let problem = '';
  try {
    procs = sortProcesses(await listProcesses(ctx.platform));
  } catch (error) {
    problem = `Couldn't list processes: ${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    type: 'list',
    title: 'Processes',
    searchPlaceholder: 'Search by name, process ID or command…',
    emptyText: problem || 'No processes found.',
    sections: [{ items: procs.map((proc) => toItem(proc, ctx)) }],
  };
}

/**
 * Whether a process is still running. Signal 0 only checks; EPERM means it runs as someone else.
 * @param {number} pid
 */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/**
 * @param {number} pid
 * @param {number} ms
 */
async function waitForExit(pid, ms) {
  const until = Date.now() + ms;
  while (isRunning(pid)) {
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * @param {Context} ctx
 * @param {{ pid: number, name: string }} target
 * @param {boolean} force
 * @returns {Promise<ActionResult>}
 */
async function quit(ctx, target, force) {
  const essential = isEssential({ pid: target.pid, name: target.name, memory: 0 });
  if (!Number.isInteger(target.pid) || essential || target.pid === process.pid || target.pid === process.ppid) {
    return { toast: `Processes won't quit ${target.name}.`, toastStyle: 'failure' };
  }
  try {
    process.kill(target.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ESRCH') return { replace: await processesView(ctx), toast: `${target.name} had already quit.` };
    return {
      toast:
        code === 'EPERM'
          ? `Couldn't quit ${target.name}: it belongs to another user.`
          : `Couldn't quit ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
      toastStyle: 'failure',
    };
  }
  const gone = await waitForExit(target.pid, force ? 1500 : 2500);
  return {
    replace: await processesView(ctx),
    ...(gone
      ? { toast: `Quit ${target.name}` }
      : { toast: `${target.name} is still running. Force Quit ends it at once.`, toastStyle: 'failure' }),
  };
}

/** @type {Extension} */
export default {
  commands: {
    processes: {
      view: processesView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') return { replace: await processesView(ctx) };
        if (
          (id === 'quit' || id === 'force-quit') &&
          typeof payload === 'object' &&
          payload !== null &&
          !Array.isArray(payload)
        ) {
          return quit(ctx, /** @type {{ pid: number, name: string }} */ (payload), id === 'force-quit');
        }
        return undefined;
      },
    },
  },
};
