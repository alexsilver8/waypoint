import { describe, expect, it } from 'vitest';
import {
  awakeCommand,
  formatDuration,
  isOver,
  isProgram,
  isSessionProcess,
  MAX_SECONDS,
  parseClockTime,
  parseDuration,
  parseElapsed,
  parseProcess,
  parseRequest,
  toSession,
} from './awake.js';

describe('parseDuration', () => {
  it('reads a bare number as minutes', () => {
    expect(parseDuration('45')).toBe(45 * 60);
    expect(parseDuration(' 90 ')).toBe(90 * 60);
  });

  it('reads units, alone or together', () => {
    expect(parseDuration('45m')).toBe(45 * 60);
    expect(parseDuration('1.5h')).toBe(90 * 60);
    expect(parseDuration('2 hours')).toBe(2 * 3600);
    expect(parseDuration('1h30m')).toBe(90 * 60);
    expect(parseDuration('1h 30')).toBe(90 * 60);
    expect(parseDuration('1h30')).toBe(90 * 60);
    expect(parseDuration('for 2 hours and 15 minutes')).toBe(2 * 3600 + 15 * 60);
    expect(parseDuration('1 day')).toBe(86_400);
    expect(parseDuration('90s')).toBe(90);
  });

  it('turns down anything that is not a length of time, or too short or long', () => {
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseDuration('45x')).toBeUndefined();
    expect(parseDuration('30 45')).toBeUndefined();
    expect(parseDuration('30s')).toBeUndefined();
    expect(parseDuration('0')).toBeUndefined();
    expect(parseDuration('8 days')).toBeUndefined();
    expect(parseDuration('7 days')).toBe(MAX_SECONDS);
  });
});

describe('parseClockTime', () => {
  const now = new Date(2026, 9, 18, 14, 0, 0);

  it('finds the next time it is that time', () => {
    expect(parseClockTime('5pm', now)).toBe(new Date(2026, 9, 18, 17, 0).getTime());
    expect(parseClockTime('until 5:30 pm', now)).toBe(new Date(2026, 9, 18, 17, 30).getTime());
    expect(parseClockTime('17:45', now)).toBe(new Date(2026, 9, 18, 17, 45).getTime());
    expect(parseClockTime('9am', now)).toBe(new Date(2026, 9, 19, 9, 0).getTime());
    expect(parseClockTime('12am', now)).toBe(new Date(2026, 9, 19, 0, 0).getTime());
    expect(parseClockTime('12pm', now)).toBe(new Date(2026, 9, 19, 12, 0).getTime());
  });

  it('leaves bare numbers to be minutes, and turns down impossible times', () => {
    expect(parseClockTime('5', now)).toBeUndefined();
    expect(parseClockTime('13pm', now)).toBeUndefined();
    expect(parseClockTime('24:00', now)).toBeUndefined();
    expect(parseClockTime('10:75', now)).toBeUndefined();
  });
});

describe('parseRequest', () => {
  const now = new Date(2026, 9, 18, 14, 0, 0);

  it('tells times of day from lengths of time', () => {
    expect(parseRequest('5pm', now)).toEqual({ seconds: 3 * 3600, kind: 'time' });
    expect(parseRequest('17.30', now)).toEqual({ seconds: 3.5 * 3600, kind: 'time' });
    expect(parseRequest('45', now)).toEqual({ seconds: 45 * 60, kind: 'duration' });
    expect(parseRequest('later', now)).toBeUndefined();
  });

  it('reads 1h30 as an hour and a half, not half past one', () => {
    expect(parseRequest('1h30', now)).toEqual({ seconds: 90 * 60, kind: 'duration' });
    expect(parseRequest('10h30', now)).toEqual({ seconds: 10.5 * 3600, kind: 'duration' });
  });
});

describe('formatDuration', () => {
  it('says it the way people do', () => {
    expect(formatDuration(60)).toBe('1 minute');
    expect(formatDuration(45 * 60)).toBe('45 minutes');
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(90 * 60)).toBe('1 hour 30 minutes');
    expect(formatDuration(3 * 86_400)).toBe('3 days');
    expect(formatDuration(86_400 + 2 * 3600)).toBe('1 day 2 hours');
    expect(formatDuration(5)).toBe('1 minute');
  });
});

describe('isOver', () => {
  const now = 1_000_000_000_000;

  it('is over once its time is up, or after a restart', () => {
    expect(isOver({ pid: 1, startedAt: now - 1000, until: now - 1 }, { now, bootTime: now - 3_600_000 })).toBe(true);
    expect(isOver({ pid: 1, startedAt: now - 1000, until: now + 60_000 }, { now, bootTime: now - 3_600_000 })).toBe(
      false,
    );
    expect(isOver({ pid: 1, startedAt: now - 7_200_000, until: null }, { now, bootTime: now - 3_600_000 })).toBe(true);
    expect(isOver({ pid: 1, startedAt: now - 1000, until: null }, { now, bootTime: now - 3_600_000 })).toBe(false);
  });
});

describe('toSession', () => {
  it('reads a saved session, and nothing else', () => {
    const session = { pid: 42, program: 'caffeinate', startedAt: 1, until: null };
    expect(toSession(session)).toEqual(session);
    expect(toSession({ ...session, until: 5 })).toEqual({ ...session, until: 5 });
    expect(toSession({ ...session, pid: -1 })).toBeUndefined();
    expect(toSession({ pid: 42, startedAt: 1, until: null })).toBeUndefined();
    expect(toSession({ pid: 42, program: 'caffeinate', startedAt: 1 })).toBeUndefined();
    expect(toSession('42')).toBeUndefined();
    expect(toSession(undefined)).toBeUndefined();
  });
});

describe('awakeCommand', () => {
  it('runs caffeinate on macOS, for a while or until stopped', () => {
    expect(awakeCommand('darwin', 3600)).toEqual({
      file: '/usr/bin/caffeinate',
      args: ['-d', '-i', '-t', '3600'],
      name: 'caffeinate',
    });
    expect(awakeCommand('darwin', undefined)?.args).toEqual(['-d', '-i']);
  });

  it('uses GNOME’s own inhibitor on GNOME, which ignores systemd’s for the screen', () => {
    expect(awakeCommand('linux', 60, { gnome: '/usr/bin/gnome-session-inhibit' })).toEqual({
      file: '/usr/bin/gnome-session-inhibit',
      args: ['--inhibit', 'idle:suspend', '--reason', 'Keep Awake', 'sleep', '60'],
      name: 'gnome-session-inhibit',
    });
  });

  it('holds a systemd inhibitor on Linux while sleep runs', () => {
    expect(awakeCommand('linux', 90)?.args.slice(-2)).toEqual(['sleep', '90']);
    expect(awakeCommand('linux', undefined)?.args.slice(-2)).toEqual(['sleep', 'infinity']);
    expect(awakeCommand('linux', undefined)?.args).toContain('--what=idle:sleep');
  });

  it('has no program for Windows, which Waypoint keeps awake itself, or other systems', () => {
    expect(awakeCommand('win32', 60)).toBeUndefined();
    expect(awakeCommand('freebsd', 60)).toBeUndefined();
  });
});

describe('isProgram', () => {
  it('recognises the program as ps names it', () => {
    expect(isProgram('/usr/bin/caffeinate', 'caffeinate')).toBe(true);
    expect(isProgram('systemd-inhibit', 'systemd-inhibit')).toBe(true);
    expect(isProgram('gnome-session-i', 'gnome-session-inhibit')).toBe(true);
  });

  it("doesn't mistake another program for it", () => {
    expect(isProgram('/Applications/Safari.app/Contents/MacOS/Safari', 'caffeinate')).toBe(false);
    expect(isProgram('', 'caffeinate')).toBe(false);
  });
});

describe('checking a saved process', () => {
  it('reads ps’s elapsed times', () => {
    expect(parseElapsed('00:05')).toBe(5);
    expect(parseElapsed('01:02:03')).toBe(3723);
    expect(parseElapsed('2-01:02:03')).toBe(2 * 86_400 + 3723);
    expect(parseElapsed('soon')).toBeUndefined();
  });

  it('reads a process from ps', () => {
    expect(parseProcess('      01:23 /usr/bin/caffeinate\n')).toEqual({ elapsed: 83, program: '/usr/bin/caffeinate' });
    expect(parseProcess('2-01:02:03 systemd-inhibit')).toEqual({ elapsed: 176_523, program: 'systemd-inhibit' });
    expect(parseProcess('')).toBeUndefined();
  });

  it('only counts the same program, started when the session was', () => {
    const now = 1_000_000_000_000;
    const session = { pid: 42, program: 'caffeinate', startedAt: now - 600_000, until: null };
    expect(isSessionProcess({ elapsed: 600, program: '/usr/bin/caffeinate' }, session, now)).toBe(true);
    expect(isSessionProcess({ elapsed: 603, program: '/usr/bin/caffeinate' }, session, now)).toBe(true);
    // The process ID went to another caffeinate, started later.
    expect(isSessionProcess({ elapsed: 30, program: '/usr/bin/caffeinate' }, session, now)).toBe(false);
    expect(isSessionProcess({ elapsed: 600, program: 'node' }, session, now)).toBe(false);
  });
});
