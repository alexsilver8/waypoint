import { describe, expect, it } from 'vitest';
import { gridMove } from './grid';

describe('gridMove', () => {
  // One section of 10 cells, 4 to a row:
  //  0  1  2  3
  //  4  5  6  7
  //  8  9
  const one = [10];

  it('goes left and right through the cells in order, stopping at the ends', () => {
    expect(gridMove(one, 4, 3, 'right')).toBe(4);
    expect(gridMove(one, 4, 4, 'left')).toBe(3);
    expect(gridMove(one, 4, 0, 'left')).toBe(0);
    expect(gridMove(one, 4, 9, 'right')).toBe(9);
  });

  it('keeps to the column going up and down', () => {
    expect(gridMove(one, 4, 1, 'down')).toBe(5);
    expect(gridMove(one, 4, 5, 'down')).toBe(9);
    expect(gridMove(one, 4, 9, 'up')).toBe(5);
    expect(gridMove(one, 4, 2, 'up')).toBe(2);
  });

  it("lands on a short row's last cell when it doesn't reach the column", () => {
    expect(gridMove(one, 4, 7, 'down')).toBe(9);
  });

  it('stays on the last row going down', () => {
    expect(gridMove(one, 4, 8, 'down')).toBe(8);
  });

  // Two sections, each starting its own row:
  //  0  1  2        (3 cells)
  //  3  4  5  6     (6 cells)
  //  7  8
  const two = [3, 6];

  it('goes down into the next section at the same column', () => {
    expect(gridMove(two, 4, 1, 'down')).toBe(4);
    expect(gridMove(two, 4, 2, 'down')).toBe(5);
  });

  it("goes up into the previous section's last row at the same column", () => {
    expect(gridMove(two, 4, 4, 'up')).toBe(1);
    // Column 3 is past the end of the 3-cell row above, so it lands on its last cell.
    expect(gridMove(two, 4, 6, 'up')).toBe(2);
    expect(gridMove(two, 4, 8, 'up')).toBe(4);
  });

  it('skips sections with nothing in them', () => {
    expect(gridMove([2, 0, 3], 4, 1, 'down')).toBe(3);
    expect(gridMove([2, 0, 3], 4, 3, 'up')).toBe(1);
  });

  it('copes with an empty grid', () => {
    expect(gridMove([], 4, 0, 'down')).toBe(0);
    expect(gridMove([0], 4, 0, 'right')).toBe(0);
  });
});
