import { describe, expect, it } from 'vitest';
import { displayOf, type Layout, layoutBounds, type Rect, sameBounds } from './layout';

// A laptop screen without the menu bar, and a bigger one to its right.
const laptop: Rect = { x: 0, y: 25, width: 1440, height: 875 };
const monitor: Rect = { x: 1440, y: -200, width: 2560, height: 1415 };
const window: Rect = { x: 100, y: 100, width: 800, height: 600 };

describe('layoutBounds', () => {
  it('fills halves and quarters of the screen the window is on', () => {
    const cases: Array<[Layout, Rect]> = [
      ['left-half', { x: 0, y: 25, width: 720, height: 875 }],
      ['right-half', { x: 720, y: 25, width: 720, height: 875 }],
      ['top-half', { x: 0, y: 25, width: 1440, height: 438 }],
      ['bottom-half', { x: 0, y: 463, width: 1440, height: 437 }],
      ['top-left', { x: 0, y: 25, width: 720, height: 438 }],
      ['top-right', { x: 720, y: 25, width: 720, height: 438 }],
      ['bottom-left', { x: 0, y: 463, width: 720, height: 437 }],
      ['bottom-right', { x: 720, y: 463, width: 720, height: 437 }],
      ['maximize', laptop],
    ];
    for (const [layout, expected] of cases) {
      expect(layoutBounds(layout, window, [laptop, monitor]), layout).toEqual(expected);
    }
  });

  it('splits an odd width without gaps or overlaps', () => {
    const odd: Rect = { x: 0, y: 0, width: 1001, height: 700 };
    const left = layoutBounds('left-half', window, [odd]);
    const right = layoutBounds('right-half', window, [odd]);
    expect(left && right && left.x + left.width).toBe(right?.x);
    expect(right && right.x + right.width).toBe(1001);
    const thirds = (['first-third', 'center-third', 'last-third'] as const).map((l) => layoutBounds(l, window, [odd]));
    expect(thirds.map((t) => t?.x)).toEqual([0, 334, 667]);
    expect(thirds.reduce((sum, t) => sum + (t?.width ?? 0), 0)).toBe(1001);
  });

  it('runs thirds across a landscape screen and down a portrait one', () => {
    expect(layoutBounds('first-two-thirds', window, [laptop])).toEqual({ x: 0, y: 25, width: 960, height: 875 });
    expect(layoutBounds('last-two-thirds', window, [laptop])).toEqual({ x: 480, y: 25, width: 960, height: 875 });
    const portrait: Rect = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(layoutBounds('center-third', window, [portrait])).toEqual({ x: 0, y: 640, width: 1080, height: 640 });
  });

  describe('on a wide screen, a tall one, and one that does not start at 0,0', () => {
    const wide: Rect = { x: 0, y: 0, width: 1200, height: 600 };
    const tall: Rect = { x: 0, y: 0, width: 600, height: 1200 };
    const offset: Rect = { x: 1440, y: -200, width: 1200, height: 600 };
    const on = (layout: Layout, screen: Rect) =>
      layoutBounds(layout, { ...window, x: screen.x, y: screen.y }, [screen]);

    it('centres a half and two thirds, across or down', () => {
      expect(on('center-half', wide)).toEqual({ x: 300, y: 0, width: 600, height: 600 });
      expect(on('center-half', tall)).toEqual({ x: 0, y: 300, width: 600, height: 600 });
      expect(on('center-half', offset)).toEqual({ x: 1740, y: -200, width: 600, height: 600 });
      expect(on('center-two-thirds', wide)).toEqual({ x: 200, y: 0, width: 800, height: 600 });
      expect(on('center-two-thirds', tall)).toEqual({ x: 0, y: 200, width: 600, height: 800 });
      expect(on('center-two-thirds', offset)).toEqual({ x: 1640, y: -200, width: 800, height: 600 });
    });

    it('cuts a wide screen into sixths, three across and two down', () => {
      const cases: Array<[Layout, Rect]> = [
        ['top-left-sixth', { x: 0, y: 0, width: 400, height: 300 }],
        ['top-center-sixth', { x: 400, y: 0, width: 400, height: 300 }],
        ['top-right-sixth', { x: 800, y: 0, width: 400, height: 300 }],
        ['bottom-left-sixth', { x: 0, y: 300, width: 400, height: 300 }],
        ['bottom-center-sixth', { x: 400, y: 300, width: 400, height: 300 }],
        ['bottom-right-sixth', { x: 800, y: 300, width: 400, height: 300 }],
      ];
      for (const [layout, expected] of cases) {
        expect(on(layout, wide), layout).toEqual(expected);
        expect(on(layout, offset), `${layout} offset`).toEqual({
          ...expected,
          x: expected.x + 1440,
          y: expected.y - 200,
        });
      }
    });

    it('turns the sixths on their side on a tall screen: corners keep their names, centres take the middle row', () => {
      const cases: Array<[Layout, Rect]> = [
        ['top-left-sixth', { x: 0, y: 0, width: 300, height: 400 }],
        ['top-right-sixth', { x: 300, y: 0, width: 300, height: 400 }],
        ['top-center-sixth', { x: 0, y: 400, width: 300, height: 400 }],
        ['bottom-center-sixth', { x: 300, y: 400, width: 300, height: 400 }],
        ['bottom-left-sixth', { x: 0, y: 800, width: 300, height: 400 }],
        ['bottom-right-sixth', { x: 300, y: 800, width: 300, height: 400 }],
      ];
      for (const [layout, expected] of cases) expect(on(layout, tall), layout).toEqual(expected);
    });

    it('splits sixths without gaps or overlaps on an odd size', () => {
      const odd: Rect = { x: 0, y: 0, width: 1001, height: 701 };
      const top = (['top-left-sixth', 'top-center-sixth', 'top-right-sixth'] as const).map((l) =>
        layoutBounds(l, window, [odd]),
      );
      expect(top.map((t) => t?.x)).toEqual([0, 334, 667]);
      expect(top.reduce((sum, t) => sum + (t?.width ?? 0), 0)).toBe(1001);
      const bottom = layoutBounds('bottom-left-sixth', window, [odd]) as Rect;
      expect((top[0] as Rect).height + bottom.height).toBe(701);
      expect(bottom.y).toBe((top[0] as Rect).height);
    });
  });

  describe('Make Larger and Make Smaller', () => {
    const screen: Rect = { x: 0, y: 0, width: 1000, height: 800 };

    it('grow and shrink the window by a tenth of the screen around its centre', () => {
      const small = { x: 300, y: 200, width: 400, height: 300 };
      expect(layoutBounds('make-larger', small, [screen])).toEqual({ x: 250, y: 160, width: 500, height: 380 });
      expect(layoutBounds('make-smaller', small, [screen])).toEqual({ x: 350, y: 240, width: 300, height: 220 });
    });

    it('keep the window on its screen', () => {
      const corner = { x: 0, y: 0, width: 400, height: 300 };
      expect(layoutBounds('make-larger', corner, [screen])).toEqual({ x: 0, y: 0, width: 500, height: 380 });
      const edge = { x: 700, y: 550, width: 300, height: 250 };
      expect(layoutBounds('make-larger', edge, [screen])).toEqual({ x: 600, y: 470, width: 400, height: 330 });
      const offset = { x: 1440, y: -200, width: 1000, height: 800 };
      const onOffset = { x: 1440, y: -200, width: 400, height: 300 };
      expect(layoutBounds('make-larger', onOffset, [offset])).toEqual({ x: 1440, y: -200, width: 500, height: 380 });
    });

    it('stop growing at the screen and shrinking at a fifth of it', () => {
      const big = { x: 10, y: 10, width: 950, height: 780 };
      expect(layoutBounds('make-larger', big, [screen])).toEqual(screen);
      expect(layoutBounds('make-larger', screen, [screen])).toEqual(screen);
      const nearlySmallest = { x: 400, y: 300, width: 230, height: 190 };
      expect(layoutBounds('make-smaller', nearlySmallest, [screen])).toEqual({
        x: 415,
        y: 315,
        width: 200,
        height: 160,
      });
      // Already smaller than that: left as it is.
      const tiny = { x: 400, y: 300, width: 100, height: 50 };
      expect(layoutBounds('make-smaller', tiny, [screen])).toEqual(tiny);
    });

    it('act on the display the window is on', () => {
      const onMonitor = { x: 1600, y: 0, width: 400, height: 300 };
      expect(layoutBounds('make-larger', onMonitor, [laptop, monitor])).toEqual({
        x: 1472,
        y: -71,
        width: 656,
        height: 442,
      });
    });
  });

  it('centres a window, keeping its size but not letting it hang off the screen', () => {
    expect(layoutBounds('center', window, [laptop])).toEqual({ x: 320, y: 163, width: 800, height: 600 });
    const huge = { x: 0, y: 0, width: 3000, height: 2000 };
    expect(layoutBounds('center', huge, [laptop])).toEqual(laptop);
    expect(layoutBounds('almost-maximize', window, [laptop])).toEqual({ x: 72, y: 69, width: 1296, height: 788 });
  });

  it('acts on the display the window is mostly on', () => {
    const straddling = { x: 1300, y: 100, width: 800, height: 600 };
    expect(layoutBounds('left-half', straddling, [laptop, monitor])).toEqual({
      x: 1440,
      y: -200,
      width: 1280,
      height: 1415,
    });
  });

  it('moves to the next and previous display, in the same place relatively', () => {
    expect(layoutBounds('next-display', window, [laptop, monitor])).toEqual({
      x: 1618,
      y: -79,
      width: 1422,
      height: 970,
    });
    // Wraps around: from the rightmost display, Next goes back to the first.
    const onMonitor = layoutBounds('next-display', window, [laptop, monitor]) as Rect;
    expect(sameBounds(layoutBounds('next-display', onMonitor, [laptop, monitor]) as Rect, window, 2)).toBe(true);
    expect(layoutBounds('previous-display', window, [monitor, laptop])).toEqual(onMonitor);
  });

  it('has nowhere to go with no other display, or no display at all', () => {
    expect(layoutBounds('next-display', window, [laptop])).toBeUndefined();
    expect(layoutBounds('left-half', window, [])).toBeUndefined();
  });

  it('keeps a moved window inside a smaller display', () => {
    const big = { x: 0, y: 0, width: 2560, height: 1440 };
    const small = { x: 2560, y: 0, width: 1280, height: 720 };
    const full = { x: 0, y: 0, width: 2560, height: 1440 };
    expect(layoutBounds('next-display', full, [big, small])).toEqual(small);
  });
});

describe('displayOf', () => {
  it('picks the nearest display for a window that is off every screen', () => {
    expect(displayOf({ x: 5000, y: 0, width: 100, height: 100 }, [laptop, monitor])).toBe(1);
    expect(displayOf({ x: -900, y: 0, width: 100, height: 100 }, [laptop, monitor])).toBe(0);
  });
});
