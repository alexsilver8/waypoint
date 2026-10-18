import { describe, expect, it } from 'vitest';
import { launcherPosition, snapLauncher } from './window-position';

const size = { width: 816, height: 516 };
const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const secondDisplay = { x: 1440, y: 0, width: 1920, height: 1080 };

describe('launcherPosition', () => {
  it('centers across and a bit above the middle until it has been dragged', () => {
    expect(launcherPosition(laptop, size)).toEqual({ x: 312, y: 200 });
    expect(launcherPosition(secondDisplay, size)).toEqual({ x: 1992, y: 216 });
  });

  it('goes back to where it was dragged', () => {
    expect(launcherPosition(laptop, size, { x: 100, y: 300 })).toEqual({ x: 100, y: 300 });
    expect(launcherPosition(secondDisplay, size, { x: 1500, y: 40 })).toEqual({ x: 1500, y: 40 });
  });

  it('keeps a dragged launcher fully on screen', () => {
    expect(launcherPosition(laptop, size, { x: 2000, y: -50 })).toEqual({ x: 624, y: 25 });
    expect(launcherPosition(secondDisplay, size, { x: 1200, y: 900 })).toEqual({ x: 1440, y: 564 });
  });

  it('keeps the top left corner on a display smaller than the launcher', () => {
    expect(launcherPosition({ x: 0, y: 0, width: 600, height: 400 }, size, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
  });
});

describe('snapLauncher', () => {
  it('snaps the launcher’s center to the display’s center line', () => {
    const { position, guides } = snapLauncher({ x: 300, y: 400 }, laptop, size, 20);
    expect(position).toEqual({ x: 312, y: 400 });
    expect(guides).toEqual([
      { axis: 'vertical', at: 720, snapped: true },
      { axis: 'horizontal', at: 220, snapped: false },
      { axis: 'horizontal', at: 463, snapped: false },
    ]);
  });

  it('snaps to where the launcher opens, with the line along the panes’ top', () => {
    const { position, guides } = snapLauncher({ x: 1500, y: 222 }, secondDisplay, size, 20);
    expect(position).toEqual({ x: 1500, y: 216 });
    expect(guides.filter((guide) => guide.snapped)).toEqual([{ axis: 'horizontal', at: 236, snapped: true }]);
  });

  it('picks the nearer line when two are within reach', () => {
    // On a laptop, where it opens and the middle are 5px apart.
    expect(snapLauncher({ x: 100, y: 201 }, laptop, size).position.y).toBe(200);
    expect(snapLauncher({ x: 100, y: 205 }, laptop, size).position.y).toBe(205);
  });

  it('snaps the launcher’s center to the display’s middle', () => {
    const { position, guides } = snapLauncher({ x: 1800, y: 290 }, secondDisplay, size);
    expect(position).toEqual({ x: 1800, y: 282 });
    expect(guides.filter((guide) => guide.snapped)).toEqual([{ axis: 'horizontal', at: 540, snapped: true }]);
  });

  it('never snaps out from under the pointer', () => {
    // Grabbed 5px inside its left edge, 10px from the center line: snapping would leave the
    // pointer 5px outside the window.
    const pointer = { x: 307, y: 400 };
    const { position, guides } = snapLauncher({ x: 302, y: 380 }, laptop, size, 20, pointer);
    expect(position).toEqual({ x: 302, y: 380 });
    expect(guides.some((guide) => guide.snapped)).toBe(false);
    // Grabbed in the middle, it snaps as usual.
    expect(snapLauncher({ x: 302, y: 380 }, laptop, size, 20, { x: 700, y: 600 }).position).toEqual({ x: 312, y: 380 });
  });

  it('moves freely away from the guides', () => {
    const { position, guides } = snapLauncher({ x: 50, y: 600 }, laptop, size, 20);
    expect(position).toEqual({ x: 50, y: 600 });
    expect(guides.some((guide) => guide.snapped)).toBe(false);
  });
});
