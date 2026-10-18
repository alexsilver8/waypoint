import { describe, expect, it } from 'vitest';
import { historyTarget, nextHistory } from './history';

describe('nextHistory', () => {
  it('puts the note you left on the back stack and forgets what was ahead', () => {
    expect(nextHistory({ back: ['a'], forward: ['x'] }, 'push', 'b', 'c')).toEqual({ back: ['a', 'b'], forward: [] });
  });

  it('moves between the stacks going back and forward', () => {
    const back = nextHistory({ back: ['a', 'b'], forward: [] }, 'back', 'c', 'b');
    expect(back).toEqual({ back: ['a'], forward: ['c'] });
    expect(nextHistory(back, 'forward', 'b', 'c')).toEqual({ back: ['a', 'b'], forward: [] });
  });

  it('skips past notes that are gone when going back', () => {
    expect(nextHistory({ back: ['a', 'deleted'], forward: [] }, 'back', 'c', 'a')).toEqual({
      back: [],
      forward: ['c'],
    });
  });

  it('remembers nothing for a note that was thrown away', () => {
    expect(nextHistory({ back: ['a'], forward: [] }, 'push', null, 'b')).toEqual({ back: ['a'], forward: [] });
  });

  it('keeps the last 50', () => {
    const back = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const next = nextHistory({ back, forward: [] }, 'push', 'last', 'new');
    expect(next.back).toHaveLength(50);
    expect(next.back.at(-1)).toBe('last');
  });
});

describe('historyTarget', () => {
  it('finds the nearest note that still exists and is not the one you are on', () => {
    const exists = (id: string) => id !== 'deleted';
    expect(historyTarget(['a', 'b', 'deleted', 'current'], exists, 'current')).toBe('b');
    expect(historyTarget(['deleted'], exists, null)).toBeUndefined();
  });
});
