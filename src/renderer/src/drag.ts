import { type RefObject, useEffect } from 'react';

/** What you click, type in or scroll, which never starts a drag. */
const CONTROLS = 'input, button, select, textarea, a, .content, .action-panel, .action-panel__scrim';

/** How far the pointer moves before a press becomes a drag, so a click doesn't flash the guides. */
const THRESHOLD = 3;

interface WindowMover {
  startDrag(): void;
  endDrag(): void;
}

/**
 * Lets you move the window by dragging anything in `root` that isn't a control, like Raycast.
 * The page only says when a drag starts and ends: the main process moves the window with the
 * pointer and snaps it to the guides it draws.
 */
export function useWindowDrag(root: RefObject<HTMLElement | null>, mover: WindowMover): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let press: { pointerId: number; x: number; y: number; dragging: boolean } | null = null;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(CONTROLS)) return;
      press = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
      // Keeps the pointer's events coming here. The drag ends when it's let go, not if this
      // capture is lost (moving windows around can drop it): the window never leaves the
      // pointer, so letting go still lands here.
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!press || press.dragging || event.pointerId !== press.pointerId) return;
      if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < THRESHOLD) return;
      press.dragging = true;
      mover.startDrag();
    };
    const end = () => {
      if (press?.dragging) mover.endDrag();
      press = null;
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      end();
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
  }, [root, mover]);
}
