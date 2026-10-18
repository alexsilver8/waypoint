/** Where the launcher opens on a display, and the guides it snaps to while you drag it. */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** How close the launcher has to come to a guide to snap to it, in pixels. */
export const SNAP_DISTANCE = 12;

/** A line the launcher snaps to while you drag it, in screen coordinates. */
export interface Guide {
  /** A vertical line at x = `at`, or a horizontal one at y = `at`. */
  axis: 'vertical' | 'horizontal';
  at: number;
  /** The launcher is sitting on it. */
  snapped: boolean;
}

/**
 * Where the launcher goes in a display's work area: where you last dragged it on that display,
 * kept fully on screen, or else centered across and a bit above the middle.
 */
export function launcherPosition(workArea: Rect, size: Size, dragged?: Point): Point {
  if (!dragged) {
    return {
      x: Math.round(workArea.x + (workArea.width - size.width) / 2),
      y: Math.round(workArea.y + workArea.height * 0.2),
    };
  }
  return {
    x: clamp(dragged.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(dragged.y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

/** `value` within `min`–`max`; `min` when the window is bigger than the display. */
function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(value, max)));
}

/**
 * Where the launcher goes while you drag it to `target`, like Raycast's: it snaps to a display's
 * guides when it comes within SNAP_DISTANCE of one. The guides are the display's vertical center
 * (for the launcher's center), where the launcher opens (its top) and the display's middle (its
 * center). `inset` is the clear margin between the window's edge and its panes, so the "opens
 * here" line runs along the panes' top edge rather than the window's.
 *
 * It never snaps out from under `pointer`: grabbed near its edge, the launcher stays where you
 * drag it rather than leave the pointer outside, where letting go would be missed.
 */
export function snapLauncher(
  target: Point,
  workArea: Rect,
  size: Size,
  inset = 0,
  pointer?: Point,
): { position: Point; guides: Guide[] } {
  const centerX = workArea.x + workArea.width / 2;
  const middleY = workArea.y + workArea.height / 2;
  const home = launcherPosition(workArea, size).y;

  const snapCenter = Math.abs(target.x + size.width / 2 - centerX) <= SNAP_DISTANCE;
  const toHome = Math.abs(target.y - home);
  const toMiddle = Math.abs(target.y + size.height / 2 - middleY);
  const snapHome = toHome <= SNAP_DISTANCE && toHome <= toMiddle;
  const snapMiddle = !snapHome && toMiddle <= SNAP_DISTANCE;

  const x = Math.round(snapCenter ? centerX - size.width / 2 : target.x);
  const y = Math.round(snapHome ? home : snapMiddle ? middleY - size.height / 2 : target.y);
  const keepsPointer =
    !pointer || (pointer.x >= x && pointer.x < x + size.width && pointer.y >= y && pointer.y < y + size.height);
  return {
    position: keepsPointer ? { x, y } : { x: Math.round(target.x), y: Math.round(target.y) },
    guides: [
      { axis: 'vertical', at: Math.round(centerX), snapped: keepsPointer && snapCenter },
      { axis: 'horizontal', at: home + inset, snapped: keepsPointer && snapHome },
      { axis: 'horizontal', at: Math.round(middleY), snapped: keepsPointer && snapMiddle },
    ],
  };
}
