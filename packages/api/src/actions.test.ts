import { describe, expect, it } from 'vitest';
import { Action } from './actions';
import type { Action as ActionShape } from './types';

describe('Action', () => {
  it('builds each kind of action as the plain object', () => {
    const actions: ActionShape[] = [
      Action.copy('hello'),
      Action.paste('hello'),
      Action.openUrl('https://example.com'),
      Action.openPath('/tmp/file.txt'),
      Action.revealPath('/tmp/file.txt'),
      Action.openCommand({ extension: 'disk-usage', command: 'usage' }),
      Action.callback('refresh', 'Refresh'),
    ];
    expect(actions).toEqual([
      { type: 'copy', text: 'hello' },
      { type: 'paste', text: 'hello' },
      { type: 'open-url', url: 'https://example.com' },
      { type: 'open-path', path: '/tmp/file.txt' },
      { type: 'reveal-path', path: '/tmp/file.txt' },
      { type: 'open-command', ref: { extension: 'disk-usage', command: 'usage' } },
      { type: 'callback', id: 'refresh', title: 'Refresh' },
    ]);
  });

  it('adds a title and the options of each kind', () => {
    expect(Action.copy('a', { title: 'Copy UUID' })).toEqual({ type: 'copy', text: 'a', title: 'Copy UUID' });
    expect(Action.openUrl('https://example.com/settings', { panelOnly: true })).toEqual({
      type: 'open-url',
      url: 'https://example.com/settings',
      panelOnly: true,
    });
    expect(Action.openCommand({ extension: 'x', command: 'y' }, { argument: '~/src', title: 'Show' })).toEqual({
      type: 'open-command',
      ref: { extension: 'x', command: 'y' },
      argument: '~/src',
      title: 'Show',
    });
    expect(Action.callback('delete', 'Delete', { payload: { id: 7 }, style: 'destructive' })).toEqual({
      type: 'callback',
      id: 'delete',
      title: 'Delete',
      payload: { id: 7 },
      style: 'destructive',
    });
  });

  it('takes a shortcut as an object or as keys joined with +', () => {
    expect(Action.copy('a', { shortcut: 'mod+shift+c' }).shortcut).toEqual({ key: 'c', modifiers: ['mod', 'shift'] });
    expect(Action.callback('refresh', 'Refresh', { shortcut: { key: 'r', modifiers: ['mod'] } }).shortcut).toEqual({
      key: 'r',
      modifiers: ['mod'],
    });
    expect(() => Action.copy('a', { shortcut: 'super+c' })).toThrow("isn't a modifier");
  });

  it('leaves out options that are undefined', () => {
    const action = Action.openUrl('https://example.com', { title: undefined, shortcut: undefined });
    expect(Object.keys(action)).toEqual(['type', 'url']);
  });

  it('copies the command reference rather than keeping it', () => {
    const ref = { extension: 'a', command: 'b', extra: true };
    const action = Action.openCommand(ref);
    expect(action.ref).toEqual({ extension: 'a', command: 'b' });
    expect(action.ref).not.toBe(ref);
  });
});
