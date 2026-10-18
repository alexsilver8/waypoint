import type { NotesWindowState } from '../../../shared/notes';

/** How you got to a note: anew (it goes on the back stack), back, forward, or neither. */
export type Move = 'push' | 'back' | 'forward' | 'none';

type History = Pick<NotesWindowState, 'back' | 'forward'>;

const LIMIT = 50;

/**
 * Go Back (⌘[) and Go Forward (⌘]) keep notes the way a browser keeps pages. Opening a note
 * puts the one you left on the back stack and forgets what was ahead; going back moves the
 * note you left forward, and the other way round. `left` is null when the note you left is
 * gone (an empty note is thrown away when you leave it), so there's nothing to go back to.
 */
export function nextHistory(history: History, move: Move, left: string | null, target: string): History {
  let { back, forward } = history;
  const from = left && left !== target ? left : null;
  if (move === 'push') {
    forward = [];
    if (from && back[back.length - 1] !== from) back = [...back, from];
  } else if (move === 'back') {
    const at = back.lastIndexOf(target);
    if (at !== -1) back = back.slice(0, at);
    if (from) forward = [...forward, from];
  } else if (move === 'forward') {
    const at = forward.lastIndexOf(target);
    if (at !== -1) forward = forward.slice(0, at);
    if (from) back = [...back, from];
  }
  return { back: back.slice(-LIMIT), forward: forward.slice(-LIMIT) };
}

/** The note Go Back (or Go Forward) would open: the nearest one that still exists and isn't this one. */
export function historyTarget(
  stack: string[],
  exists: (id: string) => boolean,
  current: string | null,
): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const id = stack[i] as string;
    if (id !== current && exists(id)) return id;
  }
  return undefined;
}
