// Runs real scripts through the commands, from folders made for the test. Shell scripts, so
// not on Windows.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import extension from './index.js';

const root = mkdtempSync(join(tmpdir(), 'script-commands-'));
const supportPath = join(root, 'support');
const scripts = join(supportPath, 'scripts');
const more = join(root, 'more');
/** @type {Map<string, any>} */
const data = new Map();

const search = /** @type {import('../../src/shared/extension-api').CommandImplementation<any>} */ (
  extension.commands.search
);

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

/** @param {string} dir @param {string} name @param {string[]} headers @param {string} body */
function script(dir, name, headers, body) {
  writeFileSync(
    join(dir, name),
    ['#!/bin/bash', ...headers.map((header) => `# @raycast.${header}`), body, ''].join('\n'),
  );
}

/** @param {string} query */
async function items(query) {
  const view = await search.view?.(ctx(query));
  return view?.sections.flatMap((section) => section.items) ?? [];
}

/**
 * What an item's first action hands back when it's picked.
 * @param {import('../../src/shared/extension-api').ListItem | undefined} item
 */
const payloadOf = (item) => /** @type {any} */ (item?.actions[0])?.payload;

/** @param {string} title */
async function runPayload(title) {
  return payloadOf((await items(title)).find((each) => each.title === title));
}

beforeAll(() => {
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(more, 'nested'), { recursive: true });
  script(
    scripts,
    'hello.sh',
    ['title Say Hello', 'mode compact', 'packageName Greetings'],
    'echo working; echo "Hello there"',
  );
  script(scripts, 'report.sh', ['title Disk Report', 'mode fullOutput'], 'echo "# Disk"; echo "- 40% used"');
  script(
    scripts,
    'greet.sh',
    ['title Greet', 'mode compact', 'argument1 { "type": "text", "placeholder": "Name" }'],
    'echo "Hi $1"',
  );
  script(scripts, 'danger.sh', ['title Clear Caches', 'mode compact', 'needsConfirmation true'], 'echo cleared');
  script(scripts, 'fail.sh', ['title Broken', 'mode compact'], 'echo "nope: missing file" >&2; exit 3');
  script(scripts, 'quiet.sh', ['title Quietly', 'mode silent'], 'true');
  script(scripts, 'weather.sh', ['title Weather', 'mode inline', 'refreshTime 1h'], 'echo "Sunny, 21°"');
  writeFileSync(join(scripts, 'README.md'), '# My scripts\nUse @raycast.title in yours.');
  script(join(more, 'nested'), 'deep.sh', ['title Deep Script', 'mode compact'], 'echo deep');
});

describe.skipIf(process.platform === 'win32')('Script Commands', () => {
  it('lists scripts by package, then the folders', async () => {
    const view = await search.view?.(ctx(''));
    expect(view?.sections.map((section) => section.title)).toEqual(['Scripts', 'Greetings', 'Script folders']);
    expect(view?.sections[0]?.items.map((item) => item.title)).toEqual([
      'Broken',
      'Clear Caches',
      'Disk Report',
      'Greet',
      'Quietly',
      'Weather',
    ]);
  });

  it('shows the last line printed', async () => {
    const result = await search.onAction?.('run', await runPayload('Say Hello'), ctx('say'));
    expect(result).toEqual({ toast: 'Hello there' });
  });

  it('shows everything printed, as printed', async () => {
    const result = await search.onAction?.('run', await runPayload('Disk Report'), ctx('disk'));
    const output = result?.push?.sections[0];
    expect(output?.title).toMatch(/^Finished in/);
    expect(output?.items[0]?.detail?.body).toBe('​# Disk\n​- 40% used\n');
  });

  it('reports a failure with what the script said', async () => {
    const result = await search.onAction?.('run', await runPayload('Broken'), ctx('broken'));
    expect(result).toEqual({ toast: 'nope: missing file', toastStyle: 'failure' });
  });

  it('closes the launcher for silent scripts', async () => {
    expect(await search.onAction?.('run', await runPayload('Quietly'), ctx('quietly'))).toEqual({ hide: true });
  });

  it('asks for arguments after the title, then runs with them', async () => {
    const [greet] = await items('greet');
    expect(greet?.accessory).toBe('<Name>');
    expect(await search.onAction?.('arguments', 'Greet', ctx('greet'))).toEqual({ search: 'Greet: ' });
    expect((await items('Greet: '))[0]?.title).toBe('Type the Name');
    const [run] = await items('Greet: Alex Silver');
    expect(run?.title).toBe('Run “Greet”');
    expect(run?.subtitle).toBe('With "Alex Silver"');
    const result = await search.onAction?.('run', payloadOf(run), ctx('Greet: Alex Silver'));
    expect(result).toEqual({ toast: 'Hi Alex Silver' });
  });

  it('asks first when a script says to', async () => {
    const payload = await runPayload('Clear Caches');
    const asked = await search.onAction?.('run', payload, ctx('clear'));
    expect(asked?.push?.sections[0]?.items.map((item) => item.title)).toEqual(['Run “Clear Caches”', 'Cancel']);
    const confirm = payloadOf(asked?.push?.sections[0]?.items[0]);
    expect(await search.onAction?.('run', confirm, ctx(''))).toEqual({ toast: 'cleared', pop: true });
  });

  it('shows what inline scripts print beside them', async () => {
    await items('weather');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const [weather] = await items('weather');
    expect(weather?.accessory).toBe('Sunny, 21°');
  });

  it('adds a folder typed into the search field, with the folders inside it', async () => {
    const [add] = await items(more);
    expect(add?.title).toMatch(/^Add “/);
    const result = await search.onAction?.('add-folder', more, ctx(more));
    expect(result?.toast).toMatch(/: 1 script$/);
    expect((await items('deep')).map((item) => item.title)).toEqual(['Deep Script']);
    expect((await items('readme')).length).toBe(0);
  });

  it('offers a template in each language this system runs', async () => {
    const view = await extension.commands.create?.view?.(
      /** @type {any} */ ({ ...ctx('Open Jira'), platform: 'linux' }),
    );
    expect(view?.sections[0]?.items.map((item) => item.subtitle)).toEqual([
      'open-jira.sh',
      'open-jira.py',
      'open-jira.js',
    ]);
  });
});
