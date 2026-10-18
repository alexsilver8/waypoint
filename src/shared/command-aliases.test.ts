import { describe, expect, it } from 'vitest';
import { aliasProblem, normalizeAlias, withCommandAlias } from './command-aliases';
import { normalizeSettings } from './settings';

const LEFT = 'window-management/left-half';
const RIGHT = 'window-management/right-half';
const commands = new Map([
  [LEFT, 'Left Half'],
  [RIGHT, 'Right Half'],
]);

describe('aliasProblem', () => {
  it('takes one word, in any case', () => {
    for (const alias of ['lh', 'LH', ' lh ', '!half', 'left-half', 'ñ']) {
      expect(aliasProblem(alias), alias).toBeUndefined();
    }
    expect(normalizeAlias(' LH ')).toBe('lh');
  });

  it('refuses nothing, spaces and long ones', () => {
    expect(aliasProblem('  ')).toBe('Type an alias.');
    expect(aliasProblem('left half')).toBe('An alias can’t have spaces in it.');
    expect(aliasProblem('l\th')).toBe('An alias can’t have spaces in it.');
    expect(aliasProblem('x'.repeat(33))).toBe('That alias is too long.');
  });
});

describe('the commandAliases setting', () => {
  it('is empty by default', () => {
    expect(normalizeSettings({}).settings.commandAliases).toEqual({});
  });

  it('keeps commands with usable aliases, lowercase', () => {
    const { settings, problems } = normalizeSettings({ commandAliases: { [LEFT]: ' LH ', [RIGHT]: 'rh' } });
    expect(settings.commandAliases).toEqual({ [LEFT]: 'lh', [RIGHT]: 'rh' });
    expect(problems).toEqual([]);
  });

  it('drops entries that name no command or give no usable alias, and says so', () => {
    const { settings, problems } = normalizeSettings({
      commandAliases: { 'left-half': 'lh', [LEFT]: 'left half', 'emoji/search': 7, 'files/search': 'ff', [RIGHT]: '' },
    });
    expect(settings.commandAliases).toEqual({ 'files/search': 'ff' });
    expect(problems).toHaveLength(3);
  });

  it('leaves an alias written twice with the command written first', () => {
    const { settings, problems } = normalizeSettings({ commandAliases: { [LEFT]: 'h', [RIGHT]: 'H' } });
    expect(settings.commandAliases).toEqual({ [LEFT]: 'h' });
    expect(problems).toEqual([`Ignoring "commandAliases.${RIGHT}": "${LEFT}" already has the alias "h".`]);
  });

  it('refuses anything but an object', () => {
    const { settings, problems } = normalizeSettings({ commandAliases: ['lh'] });
    expect(settings.commandAliases).toEqual({});
    expect(problems).toEqual(['Ignoring invalid value for "commandAliases".']);
  });
});

describe('withCommandAlias', () => {
  it('sets one, lowercase, keeping the others', () => {
    expect(withCommandAlias({ [RIGHT]: 'rh' }, LEFT, ' LH ', commands)).toEqual({
      aliases: { [RIGHT]: 'rh', [LEFT]: 'lh' },
    });
  });

  it('changes one in place', () => {
    expect(withCommandAlias({ [LEFT]: 'lh', [RIGHT]: 'rh' }, LEFT, 'l', commands)).toEqual({
      aliases: { [LEFT]: 'l', [RIGHT]: 'rh' },
    });
  });

  it('clears one with null or nothing', () => {
    expect(withCommandAlias({ [LEFT]: 'lh', [RIGHT]: 'rh' }, LEFT, null, commands)).toEqual({
      aliases: { [RIGHT]: 'rh' },
    });
    expect(withCommandAlias({ [LEFT]: 'lh' }, LEFT, '  ', commands)).toEqual({ aliases: {} });
  });

  it('refuses one another command has, in any case, saying which', () => {
    expect(withCommandAlias({ [LEFT]: 'lh' }, RIGHT, 'LH', commands)).toEqual({
      error: 'Left Half already has that alias.',
    });
  });

  it('takes one over from a command that isn’t here', () => {
    expect(withCommandAlias({ 'gone/away': 'lh' }, LEFT, 'lh', commands)).toEqual({ aliases: { [LEFT]: 'lh' } });
  });

  it('refuses a bad alias, or a command that isn’t here', () => {
    expect(withCommandAlias({}, LEFT, 'left half', commands)).toEqual({ error: 'An alias can’t have spaces in it.' });
    expect(withCommandAlias({}, 'gone/away', 'ga', commands)).toEqual({ error: 'That command isn’t available here.' });
  });
});
