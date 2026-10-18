// Port Manager: which programs are listening on which ports, with a quick way to stop them
// (a dev server you forgot, something holding port 3000) or open them in the browser.
import { execFile } from 'node:child_process';
import {
  describeAddress,
  groupPorts,
  isLocalOnly,
  parseLsof,
  parseNetstat,
  parsePs,
  parseSs,
  parseTasklist,
} from './ports.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Action} Action */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./ports.js').Port} Port */

/**
 * Runs a program and resolves to what it printed. `allowExit` lists exit codes that still
 * mean success, like lsof's 1 for "found nothing".
 * @param {string} file
 * @param {string[]} args
 * @param {number[]} [allowExit]
 * @returns {Promise<string>}
 */
function run(file, args, allowExit = []) {
  return new Promise((resolve, reject) => {
    // Short timeouts: a stop waits for the program and lists again, within the 10 s a call gets.
    execFile(file, args, { timeout: 3000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error && !(typeof error.code === 'number' && allowExit.includes(error.code))) reject(error);
      else resolve(stdout);
    });
  });
}

/** @param {unknown} error */
const notInstalled = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT';

/**
 * Every program listening on a TCP port, with its command line where the system tells.
 * @param {NodeJS.Platform} platform
 * @returns {Promise<Port[]>}
 */
export async function listPorts(platform) {
  if (platform === 'win32') {
    const [netstat, tasklist] = await Promise.all([
      run('netstat', ['-ano']),
      run('tasklist', ['/FO', 'CSV', '/NH']).catch(() => ''),
    ]);
    const names = parseTasklist(tasklist);
    return groupPorts(parseNetstat(netstat)).map((port) => {
      const process = port.pid === undefined ? undefined : names.get(port.pid);
      return process ? { ...port, process } : port;
    });
  }

  let ports;
  if (platform === 'linux') {
    // ss sees every listening socket (lsof only sees yours), and names the programs that are yours.
    try {
      ports = groupPorts(parseSs(await run('ss', ['-Hltnp'])));
    } catch (error) {
      if (!notInstalled(error)) throw error;
    }
  }
  ports ??= groupPorts(parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn'], [1])));

  const pids = [...new Set(ports.flatMap((port) => (port.pid === undefined ? [] : [port.pid])))];
  if (pids.length === 0) return ports;
  const commands = parsePs(await run('ps', ['-o', 'pid=,args=', '-p', pids.join(',')], [1]).catch(() => ''));
  return ports.map((port) => {
    const command = port.pid === undefined ? undefined : commands.get(port.pid);
    return command ? { ...port, command } : port;
  });
}

/** @param {Port} port */
const name = (port) => port.process ?? 'Unknown program';

/**
 * @param {Port} port
 * @returns {ListItem}
 */
function toItem(port) {
  const local = isLocalOnly(port);
  const url = `http://localhost:${port.port}`;
  const target = { pid: port.pid ?? 0, port: port.port, name: name(port) };
  /** @type {Action[]} */
  const actions = [];
  if (port.pid !== undefined) {
    actions.push({ type: 'callback', id: 'stop', title: 'Stop Process', payload: target, style: 'destructive' });
  }
  actions.push({ type: 'open-url', url, title: 'Open in Browser', shortcut: { key: 'o', modifiers: ['mod'] } });
  // Windows has no polite stop for Node to send: Stop already ends the program at once.
  if (port.pid !== undefined && process.platform !== 'win32') {
    actions.push({
      type: 'callback',
      id: 'force-stop',
      title: 'Force Stop',
      payload: target,
      style: 'destructive',
      shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
    });
  }
  actions.push(
    { type: 'copy', text: String(port.port), title: 'Copy Port', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    { type: 'copy', text: url, title: 'Copy URL' },
  );
  if (port.pid !== undefined) actions.push({ type: 'copy', text: String(port.pid), title: 'Copy Process ID' });
  actions.push({ type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } });

  return {
    id: `${port.port}:${port.pid ?? '?'}`,
    title: `Port ${port.port}`,
    subtitle: port.pid === undefined ? `${name(port)} (another user's)` : name(port),
    accessory: port.pid === undefined ? '' : `PID ${port.pid}`,
    icon: local ? { builtin: 'plug', tint: 'teal' } : { builtin: 'globe', tint: 'blue' },
    keywords: [
      String(port.port),
      `:${port.port}`,
      ...(port.user ? [port.user] : []),
      ...(port.command ? [port.command] : []),
    ],
    detail: {
      title: `${name(port)} on port ${port.port}`,
      body: port.command ?? (port.pid === undefined ? 'This program belongs to another user.' : name(port)),
      metadata: [
        { label: 'Port', value: String(port.port) },
        ...(port.pid === undefined ? [] : [{ label: 'Process ID', value: String(port.pid) }]),
        ...(port.user ? [{ label: 'User', value: port.user }] : []),
        { label: 'Reachable from', value: local ? 'This computer only' : 'Other devices too' },
        { label: 'Listening on', value: port.addresses.map(describeAddress).join(', ') },
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function portsView(ctx) {
  /** @type {Port[]} */
  let ports = [];
  let problem = '';
  try {
    // Leave out this extension's own process and Waypoint itself.
    ports = (await listPorts(ctx.platform)).filter((port) => port.pid !== process.pid && port.pid !== process.ppid);
  } catch (error) {
    problem = notInstalled(error)
      ? 'Port Manager needs lsof (or ss on Linux) to see open ports.'
      : `Couldn't list open ports: ${error instanceof Error ? error.message : String(error)}`;
  }
  const mine = ports.filter((port) => port.pid !== undefined);
  const others = ports.filter((port) => port.pid === undefined);
  return {
    type: 'list',
    title: 'Open Ports',
    searchPlaceholder: 'Search by port, program or command…',
    emptyText: problem || 'Nothing is listening on a port right now.',
    sections: [
      { title: 'Listening', items: mine.map(toItem) },
      { title: 'Other users', items: others.map(toItem) },
    ],
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
 * Waits up to `ms` for a process to exit.
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
 * Asks a program to stop (or makes it, with `force`), then shows the ports again.
 * @param {Context} ctx
 * @param {{ pid: number, port: number, name: string }} target
 * @param {boolean} force
 * @returns {Promise<ActionResult>}
 */
async function stop(ctx, target, force) {
  if (!Number.isInteger(target.pid) || target.pid <= 1 || target.pid === process.pid || target.pid === process.ppid) {
    return { toast: `Port Manager won't stop ${target.name}.`, toastStyle: 'failure' };
  }
  try {
    process.kill(target.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ESRCH') return { replace: await portsView(ctx), toast: `${target.name} had already stopped.` };
    return {
      toast:
        code === 'EPERM'
          ? `Couldn't stop ${target.name}: it belongs to another user.`
          : `Couldn't stop ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
      toastStyle: 'failure',
    };
  }
  const stopped = await waitForExit(target.pid, force ? 1500 : 2500);
  return {
    replace: await portsView(ctx),
    ...(stopped
      ? { toast: `Stopped ${target.name} on port ${target.port}` }
      : { toast: `${target.name} is still running. Force Stop ends it at once.`, toastStyle: 'failure' }),
  };
}

/** @type {Extension} */
export default {
  commands: {
    'open-ports': {
      view: portsView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') return { replace: await portsView(ctx) };
        if (
          (id === 'stop' || id === 'force-stop') &&
          typeof payload === 'object' &&
          payload !== null &&
          !Array.isArray(payload)
        ) {
          return stop(ctx, /** @type {{ pid: number, port: number, name: string }} */ (payload), id === 'force-stop');
        }
        return undefined;
      },
    },
  },
};
