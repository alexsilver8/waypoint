import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapEntries } from './entries';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapEntries', () => {
  it('leaves out an entry it can’t build, and keeps the rest', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entries = [{ name: 'One' }, { name: 'Broken' }, { name: 'Three' }];
    const built = mapEntries(entries, 'snippet', (entry) => {
      if (entry.name === 'Broken') throw new RangeError('Invalid time value');
      return entry.name.toUpperCase();
    });
    expect(built).toEqual(['ONE', 'THREE']);
    expect(error).toHaveBeenCalledWith('[snippets] Couldn’t show “Broken”:', expect.any(RangeError));
  });
});
