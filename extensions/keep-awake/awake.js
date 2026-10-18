// How long to stay awake, and the program that keeps each system awake for that long. Kept
// free of side effects (it reads text and builds commands) so it can be tested anywhere.

/**
 * @typedef {object} Session A program keeping the computer awake, as saved between runs.
 * @property {number} pid The program's process ID.
 * @property {string} program Its name, as `ps` or Get-Process shows it.
 * @property {number} startedAt When it started, in ms.
 * @property {number | null} until When it stops by itself, in ms; `null` keeps going until stopped.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Longer than anyone means, and well inside what every program here accepts. */
export const MAX_SECONDS = 7 * DAY;

/** @type {Record<string, number>} */
const UNITS = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
};

/**
 * A length of time as typed: `45` (minutes), `45m`, `1.5h`, `1h30`, `2 hours 15 minutes`.
 * @param {string} text
 * @returns {number | undefined} Seconds, when it's between a minute and a week.
 */
export function parseDuration(text) {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/^for\s+/, '')
    .replace(/\band\b|,/g, ' ');
  if (!input) return undefined;
  if (/^\d+(\.\d+)?$/.test(input)) return clamp(Number(input) * MINUTE);

  const parts = [...input.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)\s*/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== input.replace(/^\s+/, '')) return undefined;
  let seconds = 0;
  for (const [index, part] of parts.entries()) {
    const value = Number(part[1]);
    const unit = part[2] ?? '';
    if (unit) {
      const size = UNITS[unit];
      if (size === undefined) return undefined;
      seconds += value * size;
    } else if (index === parts.length - 1 && parts[index - 1]?.[2]?.startsWith('h')) {
      // "1h30": the bare number after the hours is minutes.
      seconds += value * MINUTE;
    } else {
      return undefined;
    }
  }
  return clamp(seconds);
}

/** @param {number} seconds */
function clamp(seconds) {
  const whole = Math.round(seconds);
  return whole >= MINUTE && whole <= MAX_SECONDS ? whole : undefined;
}

/**
 * A time of day as typed, `5pm`, `5:30 pm`, `17:30` or `until 9am`, as the next time it comes.
 * @param {string} text
 * @param {Date} now
 * @returns {number | undefined} When, in ms.
 */
export function parseClockTime(text, now) {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/^(until|till|til|to|at)\s+/, '');
  // "17:30" or "17.30"; not "1h30", which is a length of time.
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(input);
  if (!match) return undefined;
  const [, hourText, minuteText, meridiem] = match;
  // A bare number is minutes ("45"), so a time needs its minutes or am/pm.
  if (minuteText === undefined && meridiem === undefined) return undefined;
  let hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (minute > 59) return undefined;
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    const pm = meridiem.startsWith('p');
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return undefined;
  }
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * What was typed, as how long to stay awake.
 * @param {string} text
 * @param {Date} now
 * @returns {{ seconds: number, kind: 'duration' | 'time' } | undefined}
 */
export function parseRequest(text, now) {
  const at = parseClockTime(text, now);
  if (at !== undefined) {
    const seconds = Math.ceil((at - now.getTime()) / 1000);
    return seconds >= MINUTE ? { seconds, kind: 'time' } : undefined;
  }
  const seconds = parseDuration(text);
  return seconds === undefined ? undefined : { seconds, kind: 'duration' };
}

/**
 * "45 minutes", "1 hour", "2 hours 30 minutes", "3 days".
 * @param {number} seconds
 */
export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / MINUTE));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  /** @param {number} n @param {string} word */
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (days > 0) return [count(days, 'day'), hours ? count(hours, 'hour') : ''].filter(Boolean).join(' ');
  return [hours ? count(hours, 'hour') : '', rest ? count(rest, 'minute') : ''].filter(Boolean).join(' ');
}

/**
 * The time a session ends, as people say it: "3:45 PM", or "Tue 3:45 AM" when it isn't today.
 * @param {number} until
 * @param {Date} now
 */
export function formatUntil(until, now) {
  const date = new Date(until);
  const sameDay = date.toDateString() === now.toDateString();
  return date.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** @type {Record<string, string>} */
const COMPUTER = { darwin: 'Mac', win32: 'PC', linux: 'computer' };

/** @param {string} platform */
export function computerName(platform) {
  return COMPUTER[platform] ?? 'computer';
}

/**
 * Whether a saved session can't still be running: it was before the last restart, or its time
 * is up. Such a session's process ID may belong to another program by now.
 * @param {Session} session
 * @param {{ now: number, bootTime: number }} times
 */
export function isOver(session, { now, bootTime }) {
  // A little slack, as the boot time is worked out from the uptime and can be off a bit.
  if (session.startedAt < bootTime - 5000) return true;
  return session.until !== null && session.until <= now;
}

/**
 * @param {unknown} value
 * @returns {Session | undefined}
 */
export function toSession(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { pid, program, startedAt, until } = /** @type {Record<string, unknown>} */ (value);
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined;
  if (typeof program !== 'string' || !program) return undefined;
  if (typeof startedAt !== 'number') return undefined;
  if (until !== null && typeof until !== 'number') return undefined;
  return { pid, program, startedAt, until };
}

/**
 * Keeps Windows and the display awake for as long as the PowerShell running it lives, through
 * SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED).
 * @param {number | undefined} seconds Nothing to keep going until stopped.
 */
export function windowsScript(seconds) {
  return [
    // A failure (Add-Type isn't allowed in Constrained Language Mode, say) ends the script, and
    // it only says it's ready once Windows has agreed.
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -Namespace Waypoint -Name Power -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);\'',
    // 0x80000003, written in decimal: Windows PowerShell reads 0x80000003 as a negative Int32.
    'if ([Waypoint.Power]::SetThreadExecutionState([uint32]2147483651) -eq 0) { exit 1 }',
    "[Console]::Out.WriteLine('ready')",
    seconds ? `Start-Sleep -Seconds ${Math.round(seconds)}` : 'while ($true) { Start-Sleep -Seconds 3600 }',
  ].join('\n');
}

/**
 * The program that keeps the computer awake, and for how long. It runs on its own until the
 * time is up, or until it's stopped.
 * @param {string} platform
 * @param {number | undefined} seconds Nothing to keep going until stopped.
 * @param {{ gnome?: string }} [options] Where gnome-session-inhibit is, on a GNOME desktop: GNOME
 *   blanks and locks the screen whatever systemd is told, and only listens to its own.
 * @returns {{ file: string, args: string[], name: string, ready?: boolean } | undefined} `name`
 *   is how the process shows up in `ps` or Get-Process, to check a saved process ID is still
 *   ours; `ready` means it says `ready` once it's working.
 */
export function awakeCommand(platform, seconds, { gnome } = {}) {
  const time = seconds ? String(Math.round(seconds)) : undefined;
  if (platform === 'darwin') {
    // -d keeps the display on and -i stops idle sleep; -t ends it after that many seconds.
    return { file: '/usr/bin/caffeinate', args: ['-d', '-i', ...(time ? ['-t', time] : [])], name: 'caffeinate' };
  }
  if (platform === 'linux' && gnome) {
    return {
      file: gnome,
      args: ['--inhibit', 'idle:suspend', '--reason', 'Keep Awake', 'sleep', time ?? 'infinity'],
      name: 'gnome-session-inhibit',
    };
  }
  if (platform === 'linux') {
    return {
      file: 'systemd-inhibit',
      args: ['--what=idle:sleep', '--who=Waypoint', '--why=Keep Awake', '--mode=block', 'sleep', time ?? 'infinity'],
      name: 'systemd-inhibit',
    };
  }
  if (platform === 'win32') {
    const encoded = Buffer.from(windowsScript(seconds), 'utf16le').toString('base64');
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded,
      ],
      name: 'powershell',
      ready: true,
    };
  }
  return undefined;
}

/**
 * Whether a program's name, as `ps` shows it (a path on macOS, a name cut to 15 characters on
 * Linux) or Get-Process does, is this one.
 * @param {string} shown
 * @param {string} name
 */
export function isProgram(shown, name) {
  const program = shown.trim().split(/[\\/]/).pop() ?? '';
  if (!program) return false;
  return program.toLowerCase() === name.toLowerCase() || (program.length === 15 && name.startsWith(program));
}

/**
 * `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, in seconds.
 * @param {string} text
 */
export function parseElapsed(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!match) return undefined;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * A process as `ps -o etime=,comm=` prints it, or as the Windows script below does: how long
 * it has been running, then its name.
 * @param {string} output
 * @returns {{ elapsed: number, program: string } | undefined} Nothing for no such process.
 */
export function parseProcess(output) {
  const line = output.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const match = /^(\S+)\s+(.+)$/.exec(line);
  if (!match) return undefined;
  const elapsed = /^\d+$/.test(match[1] ?? '') ? Number(match[1]) : parseElapsed(match[1] ?? '');
  return elapsed === undefined ? undefined : { elapsed, program: (match[2] ?? '').trim() };
}

/**
 * Prints how many seconds a process has been running and its name, or nothing if there's no
 * such process.
 * @param {number} pid
 */
export function windowsProcessScript(pid) {
  return [
    `$p = Get-Process -Id ${Math.trunc(pid)} -ErrorAction SilentlyContinue`,
    "if ($p) { '{0} {1}' -f [int]((Get-Date) - $p.StartTime).TotalSeconds, $p.ProcessName }",
  ].join('\n');
}

/**
 * Whether a process is still the session's: the same program, started when the session did.
 * Once a process ID is free again another program may get it, and that one mustn't be stopped.
 * @param {{ elapsed: number, program: string }} process
 * @param {Session} session
 * @param {number} now
 */
export function isSessionProcess(process, session, now) {
  if (!isProgram(process.program, session.program)) return false;
  const started = now - process.elapsed * 1000;
  // ps counts whole seconds, and the clock may have been adjusted a little since.
  return Math.abs(started - session.startedAt) < 15_000;
}
