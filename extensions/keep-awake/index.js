// Keep Awake: stops your computer sleeping for a while, until a time, or until you turn it
// off. On macOS and Linux it runs caffeinate, or gnome-session-inhibit or systemd-inhibit,
// started on their own so they keep going when the extension host restarts, or Waypoint quits.
// The process is saved, and checked to be the same program started at the same time before
// anything is stopped. On Windows, Waypoint itself holds a wake lock (`ctx.power`), for as long
// as it runs.

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
} from './awake.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListSection} ListSection */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Action} Action */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./awake.js').Session} Session */
/**
 * @typedef {object} Awake What's keeping the computer awake, as the view shows it: a process's
 *   session, or Waypoint's own wake lock on Windows.
 * @property {number} startedAt
 * @property {number | null} until
 */

/** How long to watch a new process for an early failure, like systemd-inhibit being refused. */
const SETTLE_MS = 400;
/** Every call has to answer within the extension host's 10 seconds. */
const BUDGET_MS = 8500;
/** How long a process found to be its session's is trusted to still be, while it's running. */
const CHECKED_MS = 30_000;

/** When each session's process was last found to be its own, by `pid:startedAt`. */
const checked = new Map();

/** @param {Session} session */
const keyOf = (session) => `${session.pid}:${session.startedAt}`;

/** @param {number} deadline */
const left = (deadline) => Math.max(0, deadline - Date.now());

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
 * How long the process with this ID has been running and what it's called, from `ps`. `null`
 * when there's no such process, `undefined` when there's no way to tell, or no answer in time.
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<{ elapsed: number, program: string } | null | undefined>}
 */
function processOf(pid, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-p', String(pid), '-o', 'etime=,comm='],
      { timeout: Math.max(500, timeoutMs) },
      (error, stdout) => {
        const failure = /** @type {(NodeJS.ErrnoException & { killed?: boolean }) | null} */ (error);
        if (failure?.code === 'ENOENT' || failure?.killed) return resolve(undefined);
        resolve(parseProcess(`${stdout ?? ''}`) ?? null);
      },
    );
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
 * What's keeping the computer awake, if anything.
 * @param {Context} ctx
 * @param {number} deadline
 * @returns {Promise<Awake | undefined>}
 */
async function currentAwake(ctx, deadline) {
  if (ctx.platform !== 'win32') return currentSession(ctx, deadline);
  // Saved by a version that ran PowerShell for this, which stopped when Waypoint did.
  if (ctx.storage.get('session') !== undefined) ctx.storage.remove('session');
  const lock = await ctx.power.wakeLock();
  return lock ? { startedAt: lock.since, until: lock.until } : undefined;
}

/**
 * The session of the process keeping the computer awake, if there is one. A saved one that's
 * over, or whose process is gone or is another program now, is forgotten. A process found to
 * be the session's is trusted for a while after, as long as it's running: the view is drawn
 * again with every key typed.
 * @param {Context} ctx
 * @param {number} deadline
 * @returns {Promise<Session | undefined>}
 */
async function currentSession(ctx, deadline) {
  const session = toSession(ctx.storage.get('session'));
  if (!session) {
    // One saved by an earlier version, without its program: forget it rather than guess.
    if (ctx.storage.get('session') !== undefined) ctx.storage.remove('session');
    return undefined;
  }
  const now = Date.now();
  if (!isOver(session, { now, bootTime: now - uptime() * 1000 }) && isRunning(session.pid)) {
    if (now - (checked.get(keyOf(session)) ?? Number.NEGATIVE_INFINITY) < CHECKED_MS) return session;
    const found = await processOf(session.pid, Math.min(6000, left(deadline)));
    // With no way to look, or no answer in time, a running process the session started is trusted.
    if (found === undefined || (found && isSessionProcess(found, session, Date.now()))) {
      checked.set(keyOf(session), Date.now());
      return session;
    }
  }
  checked.delete(keyOf(session));
  ctx.storage.remove('session');
  return undefined;
}

/**
 * Stops a session's process. Started detached, it leads a process group of its own, so the
 * group goes too (the `sleep` of systemd-inhibit or gnome-session-inhibit).
 * @param {number} pid
 */
function stopProcess(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Starts keeping the computer awake, in place of whatever was already.
 * @param {Context} ctx
 * @param {number | undefined} seconds Nothing to keep going until stopped.
 * @param {number} deadline
 * @returns {Promise<Awake>}
 */
async function start(ctx, seconds, deadline) {
  if (ctx.platform === 'win32') {
    // Waypoint holds it, so it lasts when the extension host restarts.
    const lock = await ctx.power.keepAwake(seconds ? { until: Date.now() + seconds * 1000 } : {});
    return { startedAt: lock.since, until: lock.until };
  }
  const command = awakeCommand(ctx.platform, seconds, {
    gnome: ctx.platform === 'linux' ? findGnomeInhibit() : undefined,
  });
  if (!command) throw new Error('Keep Awake works on macOS, Windows and Linux.');
  // Looking at the session that's going mustn't take the time starting the new one needs.
  const previous = await currentSession(ctx, deadline - SETTLE_MS - 500);
  if (previous) {
    stopProcess(previous.pid);
    checked.delete(keyOf(previous));
    ctx.storage.remove('session');
  }

  // Its own process group, so it outlives the extension host.
  const child = spawn(command.file, command.args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (data) => {
    stderr += String(data);
  });
  /** @type {{ code: number | null } | { error: Error } | undefined} */
  const early = await new Promise((resolve) => {
    // Working once it has started and not stopped.
    const timer = setTimeout(() => resolve(undefined), SETTLE_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ error });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
  child.stderr?.destroy();
  child.unref();
  if (early) {
    if ('error' in early) {
      const missing = /** @type {NodeJS.ErrnoException} */ (early.error).code === 'ENOENT';
      throw new Error(missing ? `${command.file} isn't installed.` : early.error.message);
    }
    const said = stderr.trim().split(/\r?\n/).pop()?.trim();
    throw new Error(said || `${command.name} stopped straight away (exit code ${early.code}).`);
  }

  const now = Date.now();
  /** @type {Session} */
  const session = {
    pid: /** @type {number} */ (child.pid),
    program: command.name,
    startedAt: now,
    until: seconds ? now + seconds * 1000 : null,
  };
  ctx.storage.set('session', session);
  checked.set(keyOf(session), now);
  return session;
}

/**
 * "Your Mac will stay awake until 3:45 PM"
 * @param {Awake} awake
 * @param {string} platform
 */
function startedToast(awake, platform) {
  const computer = computerName(platform);
  if (awake.until === null) return `Your ${computer} will stay awake until you turn it off`;
  return `Your ${computer} will stay awake until ${formatUntil(awake.until, new Date())}`;
}

/**
 * @param {Context} ctx
 * @param {number} deadline
 * @returns {Promise<ActionResult>}
 */
async function allowSleep(ctx, deadline) {
  const awake = await currentAwake(ctx, deadline);
  if (!awake) return { toast: "Keep Awake isn't on" };
  if (ctx.platform === 'win32') {
    await ctx.power.allowSleep();
  } else {
    const session = /** @type {Session} */ (awake);
    stopProcess(session.pid);
    checked.delete(keyOf(session));
    ctx.storage.remove('session');
  }
  return { toast: `Your ${computerName(ctx.platform)} can sleep again` };
}

/**
 * @param {Awake} session
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
  return renderView(ctx, await currentAwake(ctx, Date.now() + BUDGET_MS));
}

/**
 * @param {Context} ctx
 * @param {Awake | undefined} session
 * @returns {ListView}
 */
function renderView(ctx, session) {
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
        const deadline = Date.now() + BUDGET_MS;
        if (id === 'stop') {
          const result = await allowSleep(ctx, deadline);
          return { ...result, replace: renderView({ ...ctx, query: '' }, undefined), clearSearch: true };
        }
        if (id === 'start' && typeof payload === 'number') {
          try {
            const session = await start(ctx, payload > 0 ? payload : undefined, deadline);
            return {
              toast: startedToast(session, ctx.platform),
              replace: renderView({ ...ctx, query: '' }, session),
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
        const deadline = Date.now() + BUDGET_MS;
        if (await currentAwake(ctx, deadline)) return allowSleep(ctx, deadline);
        try {
          return { toast: startedToast(await start(ctx, undefined, deadline), ctx.platform) };
        } catch (error) {
          return {
            toast: `Couldn't keep your ${computerName(ctx.platform)} awake: ${message(error)}`,
            toastStyle: 'failure',
          };
        }
      },
    },
    'allow-sleep': { run: (ctx) => allowSleep(ctx, Date.now() + BUDGET_MS) },
  },
};
