import { describe, expect, it } from 'vitest';
import { matchAtEnd, placeMenu } from './inline-menu';

describe('matchAtEnd', () => {
  it('splits off what precedes the trigger', () => {
    expect(matchAtEnd('one /he', /(^|\s)\/(\w*)$/)).toEqual({ offset: 4, query: 'he' });
    expect(matchAtEnd('no match', /(^|\s)\/(\w*)$/)).toBeNull();
  });
});

describe('placeMenu', () => {
  const view = { width: 475, height: 308 };
  const size = { width: 220, height: 332 };

  it('opens below the line when there is room there', () => {
    expect(placeMenu({ top: 60, bottom: 80, left: 24 }, { width: 220, height: 100 }, view)).toEqual({
      left: 16,
      top: 86,
      maxHeight: 214,
    });
  });

  it('opens above the line when there is more room above, never over the title bar', () => {
    expect(placeMenu({ top: 260, bottom: 282, left: 24 }, size, view)).toEqual({
      left: 16,
      bottom: 54,
      maxHeight: 198,
    });
  });

  it('stays inside the window on the right', () => {
    expect(placeMenu({ top: 60, bottom: 80, left: 440 }, size, view).left).toBe(475 - 220 - 8);
  });
});
