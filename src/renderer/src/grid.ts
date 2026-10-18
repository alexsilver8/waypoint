/** How many cells a row of a grid holds when the view doesn't say. */
export const GRID_COLUMNS = 8;

export type GridDirection = 'left' | 'right' | 'up' | 'down';

/**
 * The cell the arrow keys move to from `index` (counted across every section) in a grid whose
 * sections hold `sizes` cells, `columns` to a row. Each section starts a row of its own, so up and
 * down keep to the column, and land on a short row's last cell when it doesn't reach that far.
 * Left and right go through the cells in order, from one section into the next. At an edge it
 * stays where it is.
 */
export function gridMove(sizes: number[], columns: number, index: number, direction: GridDirection): number {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total === 0) return 0;
  if (direction === 'left') return Math.max(0, index - 1);
  if (direction === 'right') return Math.min(total - 1, index + 1);

  // Where `index` is: which section, and which cell within it.
  let section = 0;
  let start = 0;
  while (section < sizes.length - 1 && index >= start + (sizes[section] ?? 0)) {
    start += sizes[section] ?? 0;
    section += 1;
  }
  const size = sizes[section] ?? 0;
  const at = index - start;
  const column = at % columns;

  if (direction === 'down') {
    const below = at - column + columns;
    if (below < size) return start + Math.min(below + column, size - 1);
    // On into the next section that has anything, at the same column of its first row.
    let next = start + size;
    for (let s = section + 1; s < sizes.length; s += 1) {
      const nextSize = sizes[s] ?? 0;
      if (nextSize > 0) return next + Math.min(column, nextSize - 1);
      next += nextSize;
    }
    return index;
  }

  if (at >= columns) return index - columns;
  // Back into the previous section that has anything, at the same column of its last row.
  let previousEnd = start;
  for (let s = section - 1; s >= 0; s -= 1) {
    const previousSize = sizes[s] ?? 0;
    if (previousSize > 0) {
      const lastRow = Math.floor((previousSize - 1) / columns) * columns;
      return previousEnd - previousSize + Math.min(lastRow + column, previousSize - 1);
    }
    previousEnd -= previousSize;
  }
  return index;
}
