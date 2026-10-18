// Keeps this system awake for real, then lets it sleep. Off by default; the platform workflow
// runs it on macOS and Linux with WAYPOINT_SMOKE=1. On Windows, Waypoint holds the wake lock
// itself (see index.test.js, and e2e/extensions.spec.ts).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import extension from './index.js';

const enabled = process.env.WAYPOINT_SMOKE === '1';
const platform = /** @type {'darwin' | 'win32' | 'linux'} */ (process.platform);

/** A context with storage in memory, like the extension host gives. */
function context() {
  /** @type {Map<string, any>} */
  const data = new Map();
  return /** @type {any} */ ({
    query: '',
    platform,
    supportPath: mkdtempSync(join(tmpdir(), 'keep-awake-')),
    extension: { name: 'keep-awake', path: import.meta.dirname },
    storage: {
      get: (/** @type {string} */ key) => data.get(key),
      set: (/** @type {string} */ key, /** @type {any} */ value) => data.set(key, value),
      remove: (/** @type {string} */ key) => data.delete(key),
    },
  });
}

describe.runIf(enabled && platform !== 'win32')(`Keep Awake on ${platform}`, () => {
  it('keeps the computer awake, and lets it sleep again', { timeout: 30_000 }, async () => {
    const ctx = context();
    const command = extension.commands['keep-awake'];
    const result = await command?.onAction?.('start', 120, ctx);
    console.log('start:', result?.toast);
    if (result?.toastStyle === 'failure') {
      // Linux CI runs without a desktop session, which logind may not let hold an inhibitor.
      expect(platform).toBe('linux');
      return;
    }
    const session = ctx.storage.get('session');
    expect(session?.pid).toBeGreaterThan(0);
    const view = await command?.view?.(ctx);
    expect(view?.sections[0]?.title).toBe('Now');

    const stopped = await extension.commands['allow-sleep']?.run?.(ctx);
    console.log('stop:', stopped?.toast);
    expect(stopped?.toast).toMatch(/can sleep again/);
    expect(ctx.storage.get('session')).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(session.pid, 0)).toThrow();
  });
});
