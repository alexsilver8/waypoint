// Keep Awake on Windows, where Waypoint holds the wake lock itself: `ctx.power` is stood in for
// here, so this runs anywhere. The programs macOS and Linux use are tried for real in
// platform.smoke.test.js.
import { describe, expect, it, vi } from 'vitest';
import extension from './index.js';

/** Stands in for `ctx.power`, holding one wake lock like Waypoint does for each extension. */
function fakePower() {
  /** @type {{ since: number, until: number | null } | undefined} */
  let lock;
  return {
    keepAwake: vi.fn(async (/** @type {{ until?: number }} */ options = {}) => {
      lock = { since: Date.now(), until: options.until ?? null };
      return lock;
    }),
    allowSleep: vi.fn(async () => {
      lock = undefined;
    }),
    wakeLock: vi.fn(async () => lock),
  };
}

/** A Windows context, with storage in memory. */
function context() {
  /** @type {Map<string, any>} */
  const data = new Map();
  return /** @type {any} */ ({
    query: '',
    platform: 'win32',
    supportPath: '',
    extension: { name: 'keep-awake', path: import.meta.dirname },
    storage: {
      get: (/** @type {string} */ key) => data.get(key),
      set: (/** @type {string} */ key, /** @type {any} */ value) => data.set(key, value),
      remove: (/** @type {string} */ key) => data.delete(key),
    },
    power: fakePower(),
  });
}

const keepAwake = /** @type {import('@waypoint-org/api').CommandImplementation<any>} */ (
  extension.commands['keep-awake']
);

describe('Keep Awake on Windows', () => {
  it('asks Waypoint to keep the PC awake for a while, and to let it sleep again', async () => {
    const ctx = context();
    const before = await keepAwake.view?.(ctx);
    expect(before?.sections.map((section) => section.title)).toEqual(['Keep your PC awake']);

    const started = await keepAwake.onAction?.('start', 30 * 60, ctx);
    const [options] = ctx.power.keepAwake.mock.calls[0];
    expect(options.until).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(started?.toast).toMatch(/^Your PC will stay awake until /);
    expect(started?.replace?.sections[0]?.title).toBe('Now');
    expect(started?.replace?.sections[0]?.items[0]?.title).toMatch(/^Awake until /);

    const during = await keepAwake.view?.(ctx);
    expect(during?.sections.map((section) => section.title)).toEqual(['Now', 'Or keep awake']);

    const stopped = await keepAwake.onAction?.('stop', undefined, ctx);
    expect(ctx.power.allowSleep).toHaveBeenCalled();
    expect(stopped?.toast).toBe('Your PC can sleep again');
    expect(stopped?.replace?.sections.map((section) => section.title)).toEqual(['Keep your PC awake']);
  });

  it('toggles a wake lock that holds until it’s turned off', async () => {
    const ctx = context();
    const toggle = extension.commands.toggle;
    expect((await toggle?.run?.(ctx))?.toast).toBe('Your PC will stay awake until you turn it off');
    expect(ctx.power.keepAwake).toHaveBeenCalledWith({});
    expect((await toggle?.run?.(ctx))?.toast).toBe('Your PC can sleep again');
    expect((await extension.commands['allow-sleep']?.run?.(ctx))?.toast).toBe("Keep Awake isn't on");
  });

  it('forgets a PowerShell an earlier version started, which stopped with Waypoint', async () => {
    const ctx = context();
    ctx.storage.set('session', { pid: 4242, program: 'powershell', startedAt: Date.now(), until: null });
    const view = await keepAwake.view?.(ctx);
    expect(view?.sections.map((section) => section.title)).toEqual(['Keep your PC awake']);
    expect(ctx.storage.get('session')).toBeUndefined();
  });
});
