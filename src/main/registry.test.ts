import { describe, expect, it, vi } from 'vitest';
import type { Action, RootItem } from '../shared/types';
import type { AppIndex } from './apps/app-index';
import type { BuiltinExtension } from './commands/types';
import type { ExtensionHostClient } from './extensions/host-client';
import type { UsageTracker } from './usage';

vi.mock('electron', () => ({ shell: {} }));

const { CommandRegistry } = await import('./registry');

const greet: BuiltinExtension = {
  manifest: { name: 'greet', title: 'Greet', commands: [{ name: 'hello', title: 'Say Hello', mode: 'no-view' }] },
  commands: { hello: { run: () => ({ toast: 'Hello' }) } },
};

function setup(aliases: Record<string, string> = {}) {
  const record = vi.fn();
  const registry = new CommandRegistry({
    commandAlias: (key) => aliases[key],
    platform: 'linux',
    builtins: [greet],
    host: {} as ExtensionHostClient,
    apps: { on: () => {}, list: () => [] } as unknown as AppIndex,
    usage: { record, score: () => 0 } as unknown as UsageTracker,
    extensionRoots: () => [],
    supportRoot: '/tmp/waypoint-test',
  });
  return { registry, record };
}

async function commandRow(registry: InstanceType<typeof CommandRegistry>): Promise<RootItem> {
  const row = (await registry.getRootItems()).find((item) => item.id === 'command:greet/hello');
  if (!row) throw new Error('No row for the command');
  return row;
}

describe('CommandRegistry', () => {
  it('keeps Set Shortcut… off ⌘↵ of a command, in the action panel', async () => {
    const { registry } = setup();
    const [run, setShortcut] = (await commandRow(registry)).actions;
    expect(run).toMatchObject({ type: 'open-command', ref: { extension: 'greet', command: 'hello' } });
    expect(setShortcut).toMatchObject({ title: 'Set Shortcut…', argument: 'greet/hello', panelOnly: true });
  });

  it('offers Set Alias… beside it, and shows the alias once there is one', async () => {
    const [, , setAlias] = (await commandRow(setup().registry)).actions;
    expect(setAlias).toMatchObject({
      title: 'Set Alias…',
      ref: { extension: 'waypoint', command: 'alias' },
      argument: 'greet/hello',
      panelOnly: true,
    });
    const row = await commandRow(setup({ 'greet/hello': 'hi' }).registry);
    expect(row.alias).toBe('hi');
    expect(row.actions[2]).toMatchObject({ title: 'Change Alias…' });
  });

  it('counts running a command as using it, but not changing its shortcut', async () => {
    const { registry, record } = setup();
    const [run, setShortcut] = (await commandRow(registry)).actions as [Action, Action];
    // Settings isn't there to open; the result doesn't matter, only what's counted.
    await registry.runAction(setShortcut, { rootItemId: 'command:greet/hello' });
    expect(record).not.toHaveBeenCalled();
    expect(await registry.runAction(run, { rootItemId: 'command:greet/hello' })).toEqual({ toast: 'Hello' });
    expect(record).toHaveBeenCalledWith('command:greet/hello');
  });
});
