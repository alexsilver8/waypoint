import { describe, expect, it } from 'vitest';
import { failureReason, group, parseFolders, parseList, remember, shellQuote, withFolders } from './shortcuts.js';

const ID_A = '2D9C1A7E-5B1F-4C3A-9E0D-1F2A3B4C5D6E';
const ID_B = 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF';
const ID_C = '00000000-1111-4222-8333-444455556666';

describe('parseList', () => {
  it('reads names and identifiers, even with brackets in the name', () => {
    const output = [`Start Focus (Work) (${ID_A})`, `Log Water (${ID_B})`, '', 'Without An ID'].join('\n');
    expect(parseList(output)).toEqual([
      { name: 'Start Focus (Work)', id: ID_A },
      { name: 'Log Water', id: ID_B },
      { name: 'Without An ID', id: 'Without An ID' },
    ]);
  });

  it('notes the folder the list came from', () => {
    expect(parseList(`Log Water (${ID_B})\n`, 'Health')).toEqual([{ name: 'Log Water', id: ID_B, folder: 'Health' }]);
  });
});

describe('parseFolders', () => {
  it('reads one folder a line', () => {
    expect(parseFolders('Health\nWork\n\n')).toEqual(['Health', 'Work']);
  });
});

describe('withFolders', () => {
  it('puts each shortcut in its folder', () => {
    const all = [
      { name: 'A', id: ID_A },
      { name: 'B', id: ID_B },
    ];
    expect(withFolders(all, [[{ name: 'B', id: ID_B, folder: 'Work' }]])).toEqual([
      { name: 'A', id: ID_A },
      { name: 'B', id: ID_B, folder: 'Work' },
    ]);
  });
});

describe('group', () => {
  const list = [
    { name: 'A', id: ID_A },
    { name: 'B', id: ID_B, folder: 'Work' },
    { name: 'C', id: ID_C, folder: 'Work' },
  ];

  it('lists recent ones first, and each shortcut once', () => {
    expect(group(list, [ID_C, 'gone'])).toEqual([
      { title: 'Recently Run', shortcuts: [{ name: 'C', id: ID_C, folder: 'Work' }] },
      { title: 'Other Shortcuts', shortcuts: [{ name: 'A', id: ID_A }] },
      { title: 'Work', shortcuts: [{ name: 'B', id: ID_B, folder: 'Work' }] },
    ]);
  });

  it('calls the list All Shortcuts when there are no folders', () => {
    expect(group([{ name: 'A', id: ID_A }], [])).toEqual([
      { title: 'All Shortcuts', shortcuts: [{ name: 'A', id: ID_A }] },
    ]);
  });
});

describe('failureReason', () => {
  it('takes the last thing said, without "Error:"', () => {
    expect(failureReason('Warning: something\nError: The operation couldn’t be completed.\n')).toBe(
      'The operation couldn’t be completed.',
    );
    expect(failureReason('')).toBe('');
  });
});

describe('remember', () => {
  it('keeps the five latest, without repeats', () => {
    expect(remember(['b', 'a'], 'a')).toEqual(['a', 'b']);
    expect(remember(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
  });
});

describe('shellQuote', () => {
  it('quotes so a shell expands nothing', () => {
    expect(shellQuote('Log $5 `now`')).toBe("'Log $5 `now`'");
    expect(shellQuote("Alex's Focus")).toBe("'Alex'\\''s Focus'");
  });
});
