// Keep Awake: stops your computer sleeping for a while, until a time, or until you turn it
// off. It runs caffeinate on macOS, gnome-session-inhibit or systemd-inhibit on Linux and a
// small PowerShell script on Windows, started on their own so they keep going when the
// extension restarts. The process is saved, and checked to be the same program started at
// the same time before anything is stopped.

import { execFile, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { uptime } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  awakeCommand,
  computerName,
  formatDuration,
  formatUntil,
  isOver,
  isSessionProcess,
  parseProcess,
  parseRequest,
  toSession,
  windowsProcessScript,
} from './awake.js';

/** @typedef {import('../../src/shared/extension-api').Extension} Extension */
/** @typedef {import('../../src/shared/extension-api').ExtensionContext} Context */
/** @typedef {import('../../src/shared/extension-api').ListItem} ListItem */
/** @typedef {import('../../src/shared/extension-api').ListSection} ListSection */
/** @typedef {import('../../src/shared/extension-api').ListView} ListView */
/** @typedef {import('../../src/shared/extension-api').Action} Action */
/** @typedef {import('../../src/shared/extension-api').ActionResult} ActionResult */
/** @typedef {import('./awake.js').Session} Session */

/** How long to watch a new process for an early failure, like systemd-inhibit being refused. */
const SETTLE_MS = 400;
/** How long PowerShell may take to start and say it's holding Windows awake. */
const READY_MS = 6000;

/** @type {Array<{ id: string, title: string, seconds: number | undefined }>} */
const PRESETS = [
  { id: 'indefinitely', title: 'Until you turn it off', seconds: undefined },
  { id: '30m', title: 'For 30 minutes', seconds: 30 * 60 },
  { id: '1h', title: 'For 1 hour', seconds: 60 * 60 },
  { id: '2h', title: 'For 2 hours', seconds: 2 * 60 * 60 },
  { id: '4h', title: 'For 4 hours', seconds: 4 * 60 * 60 },
  { id: '8h', title: 'For 8 hours', seconds: 8 * 60 * 60 },
];

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * gnome-session-inhibit, on a GNOME desktop that has it.
 * @returns {string | undefined}
 */
function findGnomeInhibit() {
  if (!/gnome|unity|pantheon|budgie|cinnamon/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) return undefined;
  for (const dir of [...(process.env.PATH ?? '').split(delimiter), '/usr/bin', '/usr/local/bin']) {
    if (!dir) continue;
    const file = join(dir, 'gnome-session-inhibit');
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/**
 * How long the process with this ID has been running and what it's called, from `ps`, or
 * Get-Process on Windows. `null` when there's no such process, `undefined` when there's no
 * way to tell.
 * @param {number} pid
 * @param {string} platform
 * @returns {Promise<{ elapsed: number, program: string } | null | undefined>}
 */
function processOf(pid, platform) {
  const [file, args] =
    platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(windowsProcessScript(pid), 'utf16le').toString('base64'),
          ],
        ]
      : ['ps', ['-p', String(pid), '-o', 'etime=,comm=']];
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 6000, windowsHide: true }, (error, stdout) => {
      if (/** @type {NodeJS.ErrnoException | null} */ (error)?.code === 'ENOENT') return resolve(undefined);
      resolve(parseProcess(`${stdout ?? ''}`) ?? null);
    });
  });
}

/** @param {number} pid */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The session that's keeping the computer awake, if there is one. A saved one that's over, or
 * whose process is gone or is another program now, is forgotten.
 * @param {Context} ctx
 * @returns {Promise<Session | undefined>}
 */
async function currentSession(ctx) {
  const session = toSession(ctx.storage.get('session'));
  if (!session) {
    // One saved by an earlier version, without its program: forget it rather than guess.
    if (ctx.storage.get('session') !== undefined) ctx.storage.remove('session');
    return undefined;
  }
  const now = Date.now();
  if (!isOver(session, { now, bootTime: now - uptime() * 1000 }) && isRunning(session.pid)) {
    const found = await processOf(session.pid, ctx.platform);
    // With no way to look, a running process the session started is trusted.
    if (found === undefined || (found && isSessionProcess(found, session, Date.now()))) return session;
  }
  ctx.storage.remove('session');
  return undefined;
}

/**
 * Stops a session's process. Started detached, it leads a process group of its own on macOS
 * and Linux, so the group goes too (the `sleep` of systemd-inhibit or gnome-session-inhibit).
 * @param {Session} session
 * @param {string} platform
 */
function stopProcess(session, platform) {
  try {
    if (platform === 'win32') process.kill(session.pid);
    else process.kill(-session.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(session.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Starts keeping the computer awake, after stopping a session that's already going.
 * @param {Context} ctx
 * @param {number | undefined} seconds Nothing to keep going until stopped.
 * @returns {Promise<Session>}
 */
async function start(ctx, seconds) {
  const command = awakeCommand(ctx.platform, seconds, {
    gnome: ctx.platform === 'linux' ? findGnomeInhibit() : undefined,
  });
  if (!command) throw new Error('Keep Awake works on macOS, Windows and Linux.');
  const previous = await currentSession(ctx);
  if (previous) {
    stopProcess(previous, ctx.platform);
    ctx.storage.remove('session');
  }

  const child = spawn(command.file, command.args, {
    // Its own process group on macOS and Linux, so it outlives the extension host. Not on
    // Windows: a detached PowerShell has no console, and exits without running anything.
    detached: ctx.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stderr?.on('data', (data) => {
    stderr += String(data);
  });
  /** @type {{ code: number | null } | { error: Error } | undefined} */
  const early = await new Promise((resolve) => {
    // Most programs are working once they've started and not stopped; the Windows script says
    // when it's ready, as PowerShell takes a while to start.
    const timer = setTimeout(
      () => resolve(command.ready ? { code: null } : undefined),
      command.ready ? READY_MS : SETTLE_MS,
    );
    child.stdout?.on('data', (data) => {
      stdout += String(data);
      if (command.ready && stdout.includes('ready')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ error });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
  if (early) {
    if (child.exitCode === null && child.pid)
      stopProcess({ pid: child.pid, program: command.name, startedAt: 0, until: null }, ctx.platform);
    if ('error' in early) {
      const missing = /** @type {NodeJS.ErrnoException} */ (early.error).code === 'ENOENT';
      throw new Error(missing ? `${command.file} isn't installed.` : early.error.message);
    }
    // PowerShell wraps what it says in CLIXML when its output is piped; those lines aren't news.
    const said = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#<') && !line.startsWith('<'))
      .pop();
    throw new Error(said || `${command.name} stopped straight away (exit code ${early.code}).`);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();

  const now = Date.now();
  /** @type {Session} */
  const session = {
    pid: /** @type {number} */ (child.pid),
    program: command.name,
    startedAt: now,
    until: seconds ? now + seconds * 1000 : null,
  };
  ctx.storage.set('session', session);
  return session;
}

/**
 * "Your Mac will stay awake until 3:45 PM"
 * @param {Session} session
 * @param {string} platform
 */
function startedToast(session, platform) {
  const computer = computerName(platform);
  if (session.until === null) return `Your ${computer} will stay awake until you turn it off`;
  return `Your ${computer} will stay awake until ${formatUntil(session.until, new Date())}`;
}

/**
 * @param {Context} ctx
 * @returns {Promise<ActionResult>}
 */
async function allowSleep(ctx) {
  const session = await currentSession(ctx);
  if (!session) return { toast: "Keep Awake isn't on" };
  stopProcess(session, ctx.platform);
  ctx.storage.remove('session');
  return { toast: `Your ${computerName(ctx.platform)} can sleep again` };
}

/**
 * @param {Session} session
 * @returns {ListItem}
 */
function sessionItem(session) {
  const now = new Date();
  /** @type {Action[]} */
  const actions = [{ type: 'callback', id: 'stop', title: 'Allow Sleep' }];
  if (session.until === null) {
    return {
      id: 'session',
      title: 'Awake until you turn it off',
      subtitle: `Since ${formatUntil(session.startedAt, now)}`,
      icon: { builtin: 'sparkles', tint: 'orange' },
      actions,
    };
  }
  actions.push({ type: 'callback', id: 'start', title: 'Keep Awake Until I Turn It Off', payload: 0 });
  return {
    id: 'session',
    title: `Awake until ${formatUntil(session.until, now)}`,
    subtitle: `${formatDuration(Math.max(0, (session.until - now.getTime()) / 1000))} left`,
    icon: { builtin: 'sparkles', tint: 'orange' },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function keepAwakeView(ctx) {
  const session = await currentSession(ctx);
  const computer = computerName(ctx.platform);
  const typed = ctx.query.trim();
  const now = new Date();
  const request = typed ? parseRequest(typed, now) : undefined;

  /** @type {ListItem[]} */
  const choices = [];
  if (request) {
    const until = now.getTime() + request.seconds * 1000;
    choices.push({
      id: `typed:${request.seconds}`,
      title: request.kind === 'time' ? `Until ${formatUntil(until, now)}` : `For ${formatDuration(request.seconds)}`,
      subtitle: request.kind === 'time' ? `For ${formatDuration(request.seconds)}` : `Until ${formatUntil(until, now)}`,
      icon: { builtin: 'sparkles', tint: 'orange' },
      actions: [{ type: 'callback', id: 'start', title: 'Keep Awake', payload: request.seconds }],
    });
  }
  const lower = typed.toLowerCase();
  for (const preset of PRESETS) {
    if (request || (typed && !preset.title.toLowerCase().includes(lower))) continue;
    choices.push({
      id: preset.id,
      title: preset.title,
      subtitle: preset.seconds ? `Until ${formatUntil(now.getTime() + preset.seconds * 1000, now)}` : undefined,
      icon: { builtin: preset.seconds ? 'sparkles' : 'power', tint: 'orange' },
      actions: [{ type: 'callback', id: 'start', title: 'Keep Awake', payload: preset.seconds ?? 0 }],
    });
  }

  /** @type {ListSection[]} */
  const sections = [];
  if (session) sections.push({ title: 'Now', items: [sessionItem(session)] });
  if (choices.length > 0) {
    sections.push({ title: session ? 'Or keep awake' : `Keep your ${computer} awake`, items: choices });
  }
  return {
    type: 'list',
    title: 'Keep Awake',
    searchPlaceholder: 'How long, like 45m or 2h, or a time like 5pm…',
    filtering: false,
    emptyText: `Couldn't read “${typed}” as a time. Try 45m, 1h30 or 5pm.`,
    sections,
  };
}

/** @type {Extension} */
export default {
  commands: {
    'keep-awake': {
      view: keepAwakeView,
      async onAction(id, payload, ctx) {
        if (id === 'stop') {
          const result = await allowSleep(ctx);
          return { ...result, replace: await keepAwakeView({ ...ctx, query: '' }), clearSearch: true };
        }
        if (id === 'start' && typeof payload === 'number') {
          try {
            const session = await start(ctx, payload > 0 ? payload : undefined);
            return {
              toast: startedToast(session, ctx.platform),
              replace: await keepAwakeView({ ...ctx, query: '' }),
              clearSearch: true,
            };
          } catch (error) {
            return {
              toast: `Couldn't keep your ${computerName(ctx.platform)} awake: ${message(error)}`,
              toastStyle: 'failure',
            };
          }
        }
        return undefined;
      },
    },
    toggle: {
      async run(ctx) {
        if (await currentSession(ctx)) return allowSleep(ctx);
        try {
          return { toast: startedToast(await start(ctx, undefined), ctx.platform) };
        } catch (error) {
          return {
            toast: `Couldn't keep your ${computerName(ctx.platform)} awake: ${message(error)}`,
            toastStyle: 'failure',
          };
        }
      },
    },
    'allow-sleep': { run: allowSleep },
  },
};
