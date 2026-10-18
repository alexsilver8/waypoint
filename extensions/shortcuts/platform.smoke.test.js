// Lists this Mac's shortcuts for real. Off by default; the platform workflow runs it on macOS
// with WAYPOINT_SMOKE=1. A CI Mac has no shortcuts of its own, so this checks that the
// `shortcuts` command answers the way the extension reads it.
import { describe, expect, it } from 'vitest';
import extension from './index.js';

const enabled = process.env.WAYPOINT_SMOKE === '1' && process.platform === 'darwin';

describe.runIf(enabled)('Shortcuts on macOS', () => {
  it('lists the shortcuts', { timeout: 30_000 }, async () => {
    const storage = { get: () => undefined, set: () => {}, remove: () => {} };
    const view = await extension.commands.run?.view?.(/** @type {any} */ ({ query: '', platform: 'darwin', storage }));
    for (const section of view?.sections ?? []) {
      console.log(`${section.title}: ${section.items.map((item) => item.title).join(', ')}`);
    }
    console.log('empty text:', view?.emptyText);
    expect(view?.sections.at(-1)?.title).toBe('Shortcuts app');
    expect(view?.emptyText).toBe('No shortcuts match.');
  });
});
