/** The expander's ties to the system: the keyboard hook from uiohook-napi, and Electron's clipboard. */
import { type ClipboardBookmark, ClipboardItem, clipboard } from 'electron';
import type { ClipboardKeeper, KeyboardHook } from './expander';

/**
 * Loads uiohook-napi, a native module, only when expansion is turned on: until then nothing
 * watches the keyboard, and a system without its library (X11's, on Linux) runs as before.
 */
export async function loadKeyboardHook(): Promise<KeyboardHook> {
  const { uIOhook } = await import('uiohook-napi');
  return {
    onKeyDown: (listener) => uIOhook.on('keydown', listener),
    onMouseDown: (listener) => uIOhook.on('mousedown', () => listener()),
    start: () => uIOhook.start(),
    stop: () => uIOhook.stop(),
    tap: (keycode, modifiers) => uIOhook.keyTap(keycode, modifiers),
  };
}

/**
 * Saves and restores the clipboard around an expansion, in every form it was in (text, rich text,
 * an image and so on). `quietly` is told the text about to be written, so clipboard history doesn't
 * record the snippet, nor the restored text as new.
 */
export function electronClipboardKeeper(quietly: (text: string) => void): ClipboardKeeper<SavedClipboard> {
  return {
    async save() {
      // Read every form now, while the clipboard still holds what was copied.
      const items = await clipboard.read();
      const saved = await Promise.all(
        items.map(async (item) => {
          const forms = await Promise.all(
            item.types.map(async (type) => [type, await item.getType(type).catch(() => undefined)] as const),
          );
          return Object.fromEntries(forms.filter(([, payload]) => payload !== undefined)) as SavedForms;
        }),
      );
      return { text: await clipboard.readText(), items: saved.filter((forms) => Object.keys(forms).length > 0) };
    },
    async write(text) {
      quietly(text);
      await clipboard.writeText(text);
    },
    async restore({ text, items }) {
      quietly(text);
      if (items.length === 0) clipboard.clear();
      else await clipboard.write(items.map((forms) => new ClipboardItem(forms)));
    },
  };
}

type SavedForms = Record<string, Blob | ClipboardBookmark>;

/** What was on the clipboard, every form of it read. */
export interface SavedClipboard {
  text: string;
  items: SavedForms[];
}
