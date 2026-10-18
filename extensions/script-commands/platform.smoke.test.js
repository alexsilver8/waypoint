// Runs a batch file and a PowerShell script with arguments through cmd.exe and PowerShell on
// Windows, where index.test.js's shell scripts can't run. Off by default; the platform workflow
// runs it with WAYPOINT_SMOKE=1.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import extension from './index.js';

const enabled = process.env.WAYPOINT_SMOKE === '1' && process.platform === 'win32';
const root = join(tmpdir(), `script-commands-smoke-${process.pid}`);
const supportPath = join(root, 'support');
/** @type {Map<string, any>} */
const data = new Map();
const search = /** @type {import('@waypoint-org/api').CommandImplementation<any>} */ (extension.commands.search);

/** @param {string} query */
const ctx = (query) => ({
  query,
  platform: process.platform,
  supportPath,
  extension: { name: 'script-commands', path: import.meta.dirname },
  storage: {
    get: (/** @type {string} */ key) => data.get(key),
    set: (/** @type {string} */ key, /** @type {any} */ value) => data.set(key, value),
    remove: (/** @type {string} */ key) => data.delete(key),
  },
});

/**
 * Picks what's offered for a query, as pressing ↵ would.
 * @param {string} query
 */
async function run(query) {
  const view = await search.view?.(ctx(query));
  const item = view?.sections.flatMap((section) => section.items)[0];
  const action = /** @type {any} */ (item?.actions[0]);
  return search.onAction?.(action?.id, action?.payload, ctx(query));
}

const ARGUMENTS = [
  'argument1 { "type": "text", "placeholder": "First" }',
  'argument2 { "type": "text", "placeholder": "Second" }',
];

describe.runIf(enabled)('Script Commands on Windows', () => {
  // Both written before the folder is first read: it's read again only every few seconds.
  beforeAll(() => {
    const scripts = join(supportPath, 'scripts');
    mkdirSync(scripts, { recursive: true });
    writeFileSync(
      join(scripts, 'echo.cmd'),
      [
        '@echo off',
        ...['title Echo Batch', 'mode compact', ...ARGUMENTS].map((header) => `REM @raycast.${header}`),
        // Read into variables and printed with !…!, so nothing in them is run.
        'setlocal EnableDelayedExpansion',
        'set "one=%~1"',
        'set "two=%~2"',
        'echo [!one!] [!two!]',
        '',
      ].join('\r\n'),
    );
    writeFileSync(
      join(scripts, 'echo.ps1'),
      [
        ...['title Echo PowerShell', 'mode compact', ...ARGUMENTS].map((header) => `# @raycast.${header}`),
        'Write-Output "[$($args[0])] [$($args[1])]"',
        '',
      ].join('\r\n'),
    );
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('hands a batch file its arguments as typed', { timeout: 30_000 }, async () => {
    const result = await run('Echo Batch: "50% & more" "x^y (1) <2> | C:\\dir\\"');
    console.log('batch:', result);
    expect(result).toEqual({ toast: '[50% & more] [x^y (1) <2> | C:\\dir\\]' });

    const refused = await run(`Echo Batch: 'say "hi"' two`);
    expect(refused?.toastStyle).toBe('failure');
    expect(refused?.toast).toMatch(/double quotes/);
  });

  it('hands a PowerShell script its arguments as typed', { timeout: 30_000 }, async () => {
    const result = await run(`Echo PowerShell: 'say "hi"' "a & b"`);
    console.log('powershell:', result);
    expect(result).toEqual({ toast: '[say "hi"] [a & b]' });
  });
});
