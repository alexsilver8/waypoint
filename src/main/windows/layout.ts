/**
 * Where a window goes for each layout. Pure geometry, in whatever coordinates the system uses
 * (points on macOS, pixels on Windows and Linux), so it can be tested without a screen.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Layout =
  | 'left-half'
  | 'right-half'
  | 'top-half'
  | 'bottom-half'
  | 'center-half'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'first-third'
  | 'center-third'
  | 'last-third'
  | 'first-two-thirds'
  | 'center-two-thirds'
  | 'last-two-thirds'
  | 'top-left-sixth'
  | 'top-center-sixth'
  | 'top-right-sixth'
  | 'bottom-left-sixth'
  | 'bottom-center-sixth'
  | 'bottom-right-sixth'
  | 'maximize'
  | 'almost-maximize'
  | 'center'
  | 'make-larger'
  | 'make-smaller'
  | 'next-display'
  | 'previous-display';

/** How much of the screen Almost Maximize fills. */
const ALMOST = 0.9;
/** How much of the screen's width and height Make Larger and Make Smaller add or take off. */
const STEP = 0.1;
/** How much of the screen a window is at its smallest, with Make Smaller. */
const SMALLEST = 0.2;

function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * The display a window is on: the one it overlaps most, or the nearest one when it's
 * entirely off-screen. Returns -1 when there are no displays.
 */
export function displayOf(window: Rect, displays: Rect[]): number {
  let best = -1;
  let bestArea = 0;
  displays.forEach((display, index) => {
    const overlap = area(intersection(window, display));
    if (overlap > bestArea) {
      best = index;
      bestArea = overlap;
    }
  });
  if (best >= 0) return best;

  const cx = window.x + window.width / 2;
  const cy = window.y + window.height / 2;
  let bestDistance = Number.POSITIVE_INFINITY;
  displays.forEach((display, index) => {
    const dx = Math.max(display.x - cx, 0, cx - (display.x + display.width));
    const dy = Math.max(display.y - cy, 0, cy - (display.y + display.height));
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Splits `length` into `parts` and returns the start and size of parts `from` to `to`, without gaps. */
function span(start: number, length: number, parts: number, from: number, to: number): [number, number] {
  const a = start + Math.round((length * from) / parts);
  const b = start + Math.round((length * to) / parts);
  return [a, b - a];
}

/**
 * Part of the screen. `columns` and `rows` are `[parts, from, to]`: the screen cut into `parts`,
 * and the span from cut `from` to cut `to`.
 */
function grid(screen: Rect, columns: [number, number, number], rows: [number, number, number]): Rect {
  const [x, width] = span(screen.x, screen.width, columns[0], columns[1], columns[2]);
  const [y, height] = span(screen.y, screen.height, rows[0], rows[1], rows[2]);
  return { x, y, width, height };
}

function isPortrait(screen: Rect): boolean {
  return screen.height > screen.width;
}

/** Cuts `from` to `to` of `parts`: across a landscape screen and down a portrait one, like thirds. */
function along(screen: Rect, parts: number, from: number, to: number): Rect {
  return isPortrait(screen) ? grid(screen, [1, 0, 1], [parts, from, to]) : grid(screen, [parts, from, to], [1, 0, 1]);
}

/** Thirds run across a landscape screen and down a portrait one. */
function thirds(screen: Rect, from: number, to: number): Rect {
  return along(screen, 3, from, to);
}

/**
 * One of six: three across and two down on a landscape screen. A portrait screen is two across
 * and three down: the corners keep their names, and the two centre sixths take the middle row.
 */
function sixth(screen: Rect, column: 0 | 1 | 2, row: 0 | 1): Rect {
  if (!isPortrait(screen)) return grid(screen, [3, column, column + 1], [2, row, row + 1]);
  const portraitColumn = column === 1 ? row : column === 0 ? 0 : 1;
  const portraitRow = column === 1 ? 1 : row === 0 ? 0 : 2;
  return grid(screen, [2, portraitColumn, portraitColumn + 1], [3, portraitRow, portraitRow + 1]);
}

/** Keeps a size within the screen and centres it there. */
function centered(screen: Rect, width: number, height: number): Rect {
  const w = Math.min(Math.round(width), screen.width);
  const h = Math.min(Math.round(height), screen.height);
  return {
    x: screen.x + Math.round((screen.width - w) / 2),
    y: screen.y + Math.round((screen.height - h) / 2),
    width: w,
    height: h,
  };
}

/**
 * The window grown or shrunk by a step of the screen on each side, around its own centre, kept on
 * the screen. Shrinking stops at a fifth of the screen, and never grows a window smaller than that.
 */
function resized(screen: Rect, window: Rect, direction: 1 | -1): Rect {
  const stepX = screen.width * STEP;
  const stepY = screen.height * STEP;
  const width =
    direction > 0
      ? Math.min(window.width + stepX, screen.width)
      : Math.max(window.width - stepX, Math.min(window.width, screen.width * SMALLEST));
  const height =
    direction > 0
      ? Math.min(window.height + stepY, screen.height)
      : Math.max(window.height - stepY, Math.min(window.height, screen.height * SMALLEST));
  const w = Math.round(width);
  const h = Math.round(height);
  return clamp(
    {
      x: Math.round(window.x + (window.width - w) / 2),
      y: Math.round(window.y + (window.height - h) / 2),
      width: w,
      height: h,
    },
    screen,
  );
}

/** Moves a rect inside the screen, shrinking it only if it's bigger than the screen. */
function clamp(rect: Rect, screen: Rect): Rect {
  const width = Math.min(rect.width, screen.width);
  const height = Math.min(rect.height, screen.height);
  return {
    x: Math.min(Math.max(rect.x, screen.x), screen.x + screen.width - width),
    y: Math.min(Math.max(rect.y, screen.y), screen.y + screen.height - height),
    width,
    height,
  };
}

/**
 * Displays left to right (then top to bottom), the order Next and Previous Display go
 * through them.
 */
function inOrder(displays: Rect[]): Rect[] {
  return [...displays].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Puts a window in the same place, relatively, on another display. */
function onDisplay(window: Rect, from: Rect, to: Rect): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return clamp(
    {
      x: Math.round(to.x + (window.x - from.x) * sx),
      y: Math.round(to.y + (window.y - from.y) * sy),
      width: Math.round(window.width * sx),
      height: Math.round(window.height * sy),
    },
    to,
  );
}

/**
 * Where a window goes for a layout. `displays` are the work areas (without the menu bar,
 * Dock or taskbar). Returns `undefined` when there's nowhere to go, like Next Display with
 * only one display.
 */
export function layoutBounds(layout: Layout, window: Rect, displays: Rect[]): Rect | undefined {
  const screen = displays[displayOf(window, displays)];
  if (!screen) return undefined;

  switch (layout) {
    case 'left-half':
      return grid(screen, [2, 0, 1], [1, 0, 1]);
    case 'right-half':
      return grid(screen, [2, 1, 2], [1, 0, 1]);
    case 'top-half':
      return grid(screen, [1, 0, 1], [2, 0, 1]);
    case 'bottom-half':
      return grid(screen, [1, 0, 1], [2, 1, 2]);
    case 'center-half':
      return along(screen, 4, 1, 3);
    case 'top-left':
      return grid(screen, [2, 0, 1], [2, 0, 1]);
    case 'top-right':
      return grid(screen, [2, 1, 2], [2, 0, 1]);
    case 'bottom-left':
      return grid(screen, [2, 0, 1], [2, 1, 2]);
    case 'bottom-right':
      return grid(screen, [2, 1, 2], [2, 1, 2]);
    case 'first-third':
      return thirds(screen, 0, 1);
    case 'center-third':
      return thirds(screen, 1, 2);
    case 'last-third':
      return thirds(screen, 2, 3);
    case 'first-two-thirds':
      return thirds(screen, 0, 2);
    case 'center-two-thirds':
      return along(screen, 6, 1, 5);
    case 'last-two-thirds':
      return thirds(screen, 1, 3);
    case 'top-left-sixth':
      return sixth(screen, 0, 0);
    case 'top-center-sixth':
      return sixth(screen, 1, 0);
    case 'top-right-sixth':
      return sixth(screen, 2, 0);
    case 'bottom-left-sixth':
      return sixth(screen, 0, 1);
    case 'bottom-center-sixth':
      return sixth(screen, 1, 1);
    case 'bottom-right-sixth':
      return sixth(screen, 2, 1);
    case 'maximize':
      return { ...screen };
    case 'almost-maximize':
      return centered(screen, screen.width * ALMOST, screen.height * ALMOST);
    case 'center':
      return centered(screen, window.width, window.height);
    case 'make-larger':
      return resized(screen, window, 1);
    case 'make-smaller':
      return resized(screen, window, -1);
    case 'next-display':
    case 'previous-display': {
      if (displays.length < 2) return undefined;
      const order = inOrder(displays);
      const step = layout === 'next-display' ? 1 : -1;
      const target = order[(order.indexOf(screen) + step + order.length) % order.length];
      return target && onDisplay(window, screen, target);
    }
  }
}

/** Whether two rects are the same, give or take a pixel of rounding. */
export function sameBounds(a: Rect, b: Rect, tolerance = 1): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}
