import { NOTES_POPOVER_FRAME } from '../../../shared/notes';

/** The popover window's page, which this page draws popovers into. */
export interface PopoverHost {
  window: Window;
  /** Where popovers go. */
  root: HTMLElement;
}

const PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notes</title></head><body></body></html>';

/**
 * Opens the popover window, hidden, and sets up its page: this page's styles and platform, and
 * a root to draw popovers in. Popovers are drawn there from this page, so they share its state
 * and the window it belongs to only has to say where to put it. Opening it again (a reload)
 * starts its page afresh.
 */
export function openPopoverHost(): PopoverHost | null {
  const popover = window.open('', NOTES_POPOVER_FRAME);
  if (!popover) return null;
  const doc = popover.document;
  doc.open();
  doc.write(PAGE);
  doc.close();
  for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = doc.importNode(sheet, true);
    // In full, since the copy's page has no address of its own to resolve it against.
    if (sheet instanceof HTMLLinkElement) copy.setAttribute('href', sheet.href);
    doc.head.append(copy);
  }
  const html = doc.documentElement;
  html.dataset.platform = document.documentElement.dataset.platform ?? '';
  // The window is clear, and popovers draw a surface of their own, whatever is behind this one.
  html.dataset.glass = 'none';
  const root = doc.createElement('div');
  root.className = 'notes-popover';
  doc.body.append(root);
  return { window: popover, root };
}
