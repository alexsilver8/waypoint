import type { Icon, ItemDetail, Json, View } from '../../shared/types';

export interface Confirmation {
  title: string;
  /** The button, e.g. "Restart Now". */
  confirm: string;
  /** What happens, in a sentence. */
  detail: string;
  icon: Icon;
  /** A closer look at what's about to happen, in the preview pane. */
  preview?: ItemDetail;
  /** Sent with the `confirm` callback, to say what was confirmed. */
  payload?: Json;
}

/** Asks before doing something you can't take back: ↵ goes ahead, Esc goes back. */
export function confirmView({ title, confirm, detail, icon, preview, payload }: Confirmation): View {
  return {
    type: 'list',
    title,
    searchPlaceholder: 'Press ↵ to confirm, or Esc to go back',
    sections: [
      {
        items: [
          {
            id: 'confirm',
            title: confirm,
            subtitle: detail,
            icon,
            actions: [
              {
                type: 'callback',
                id: 'confirm',
                title: confirm,
                style: 'destructive',
                ...(payload ? { payload } : {}),
              },
            ],
            ...(preview ? { detail: preview } : {}),
          },
          {
            id: 'cancel',
            title: 'Cancel',
            icon: { builtin: 'close', tint: 'gray' },
            actions: [{ type: 'callback', id: 'cancel', title: 'Cancel' }],
            ...(preview ? { detail: { markdown: 'Nothing is changed.' } } : {}),
          },
        ],
      },
    ],
  };
}
