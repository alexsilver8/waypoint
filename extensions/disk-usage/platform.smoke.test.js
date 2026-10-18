// Scans the real home folder. Off by default; the platform workflow runs it on macOS, Windows and
// Linux with WAYPOINT_SMOKE=1, and what it finds and how fast is printed for a look.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import extension from './index.js';

const enabled = process.env.WAYPOINT_SMOKE === '1';
const platform = /** @type {'darwin' | 'win32' | 'linux'} */ (process.platform);
const ctx = /** @type {any} */ ({ query: '', platform });

/** @param {string} command @param {string} query */
async function settled(command, query) {
  const started = Date.now();
  let view = await extension.commands[command]?.view?.({ ...ctx, query });
  while (view?.loading && Date.now() - started < 240_000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    view = await extension.commands[command]?.view?.({ ...ctx, query });
    const scan = view?.sections.at(-1)?.items[0];
    if (scan) console.log(`  ${scan.title} ${scan.subtitle ?? ''}`);
  }
  return view;
}

/** @param {any} view */
function log(label, view) {
  console.log(`${label}:`, view?.emptyText ?? '');
  for (const section of view?.sections ?? []) {
    console.log(`  # ${section.title}`);
    for (const item of section.items.slice(0, 12)) {
      console.log(`  - ${item.title} | ${item.subtitle ?? ''} | ${item.accessory ?? ''}`);
    }
  }
}

describe.runIf(enabled)(`Disk Usage on ${platform}`, () => {
  it('scans the home folder', { timeout: 300_000 }, async () => {
    const view = await settled('usage', '');
    log('home', view);
    expect(view?.loading).toBeFalsy();
    const scan = view?.sections.at(-1)?.items.find((item) => item.id === 'scan');
    console.log('scan:', JSON.stringify(scan?.detail?.metadata));
    expect(scan?.title).toMatch(/^Scanned /);
    expect(view?.sections[0]?.items.length).toBeGreaterThan(0);
    if (platform !== 'win32') {
      try {
        // What du makes of it, to compare; it counts cloud storage and other disks too.
        console.log('du:', execFileSync('du', ['-sk', homedir()], { encoding: 'utf8', timeout: 120_000 }).trim());
      } catch (error) {
        console.log('du:', error instanceof Error ? error.message.split('\n')[0] : error);
      }
    }
  });

  it('lists the largest files, and archives and installers', { timeout: 120_000 }, async () => {
    const largest = await settled('largest-files', '');
    log('largest', largest);
    expect(largest?.sections[0]?.items.length ?? 0).toBeGreaterThan(0);
    log('archives', await settled('archives', ''));
  });

  it('scans a folder typed into the search, once asked', { timeout: 120_000 }, async () => {
    const folder = platform === 'win32' ? 'C:\\Windows\\Fonts' : '/usr';
    const typed = `${folder}${platform === 'win32' ? '\\' : '/'}`;
    const asked = await extension.commands.usage?.view?.({ ...ctx, query: typed });
    expect(asked?.sections[0]?.items.map((item) => item.id)).toEqual(['scan-here']);
    await extension.commands.usage?.onAction?.('scan', folder, { ...ctx, query: typed });
    const view = await settled('usage', typed);
    log(typed, view);
    expect(view?.sections[0]?.items.length).toBeGreaterThan(1);
  });
});
