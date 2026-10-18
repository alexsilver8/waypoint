import {
  CircleArrowLeft,
  CircleArrowRight,
  Clipboard,
  Code,
  CopyPlus,
  FolderOpen,
  Hash,
  History,
  Layers,
  PanelBottom,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Share,
  TextSearch,
  Trash,
  Trash2,
  Type,
  UnfoldVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ExportFormat } from '../../../shared/notes';
import type { Platform, Shortcut } from '../../../shared/types';
import { BrowseIcon } from './icons';
import type { PopoverEntry } from './ListPopover';

export type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export interface NoteAction extends PopoverEntry {
  title: string;
  icon: IconComponent;
  /** The shortcut shown beside the action, which runs it from anywhere in the window. */
  shortcut?: Shortcut;
  /** More shortcuts that run it, not shown. */
  alsoShortcuts?: Shortcut[];
  run?(): void;
  /** Actions that open a list of their own, like Copy Note As... */
  submenu?(): NoteAction[];
}

export interface NoteActionGroup {
  key: string;
  items: NoteAction[];
}

export type CopyFormat = ExportFormat;

/** What the action panel needs to know, and what its actions do. */
export interface NoteActionContext {
  platform: Platform;
  /** The note you're on has nothing in it. */
  empty: boolean;
  pinned: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Text is selected, so copying acts on it instead of the whole note. */
  hasSelection: boolean;
  formatBar: boolean;
  autoResize: boolean;
  alwaysOnTop: boolean;
  count: 'characters' | 'words';
  zoom: number;
  revealLabel: string;
  newNote(): void;
  duplicate(): void;
  togglePin(): void;
  browse(): void;
  goBack(): void;
  goForward(): void;
  find(): void;
  copyAs(format: CopyFormat): void;
  copyDeeplink(): void;
  exportAs(format: ExportFormat): void;
  formatItems(): NoteAction[];
  toggleFormatBar(): void;
  toggleAutoResize(): void;
  toggleAlwaysOnTop(): void;
  toggleCount(): void;
  zoomBy(step: number): void;
  resetZoom(): void;
  reveal(): void;
  recentlyDeleted(): void;
  deleteNote(): void;
  deleteAll(): void;
}

const FORMATS: Array<{ format: ExportFormat; title: string; icon: IconComponent }> = [
  { format: 'md', title: 'Markdown', icon: Hash },
  { format: 'html', title: 'HTML', icon: Code },
  { format: 'txt', title: 'Plain Text', icon: Type },
];

/**
 * Everything ⌘K offers in the Notes window, grouped and in Raycast's order, with Raycast's
 * shortcuts. The shortcuts work whether or not the panel is open.
 */
export function noteActions(context: NoteActionContext): NoteActionGroup[] {
  const mac = context.platform === 'darwin';
  const mod = (key: string, ...more: Array<'shift' | 'alt' | 'ctrl'>): Shortcut => ({
    key,
    modifiers: ['mod', ...more],
  });
  return [
    {
      key: 'note',
      items: [
        // An empty note is already new, so there's nothing to make or duplicate.
        {
          key: 'new',
          title: 'New Note',
          icon: Plus,
          shortcut: mod('n'),
          disabled: context.empty,
          run: context.newNote,
        },
        {
          key: 'duplicate',
          title: 'Duplicate Note',
          icon: CopyPlus,
          shortcut: mod('d'),
          disabled: context.empty,
          run: context.duplicate,
        },
        {
          key: 'pin',
          title: context.pinned ? 'Unpin Note' : 'Pin Note',
          icon: context.pinned ? PinOff : Pin,
          shortcut: mod('p', 'shift'),
          run: context.togglePin,
        },
        { key: 'browse', title: 'Browse Notes', icon: BrowseIcon, shortcut: mod('p'), run: context.browse },
        {
          key: 'back',
          title: 'Go Back',
          icon: CircleArrowLeft,
          shortcut: mod('['),
          disabled: !context.canGoBack,
          run: context.goBack,
        },
        {
          key: 'forward',
          title: 'Go Forward',
          icon: CircleArrowRight,
          shortcut: mod(']'),
          disabled: !context.canGoForward,
          run: context.goForward,
        },
      ],
    },
    {
      key: 'share',
      items: [
        { key: 'find', title: 'Find in Note', icon: TextSearch, shortcut: mod('f'), run: context.find },
        {
          key: 'copy-as',
          title: context.hasSelection ? 'Copy Selected Text As...' : 'Copy Note As...',
          icon: Clipboard,
          shortcut: mod('c', 'shift'),
          submenu: () =>
            FORMATS.map(({ format, title, icon }) => ({
              key: `copy-${format}`,
              title,
              icon,
              run: () => context.copyAs(format),
            })),
        },
        {
          key: 'deeplink',
          title: 'Copy Deeplink',
          icon: Clipboard,
          shortcut: mod('d', 'shift'),
          run: context.copyDeeplink,
        },
        {
          key: 'export',
          title: 'Export...',
          icon: Share,
          shortcut: mod('e', 'shift'),
          submenu: () =>
            FORMATS.map(({ format, title, icon }) => ({
              key: `export-${format}`,
              title,
              icon,
              run: () => context.exportAs(format),
            })),
        },
      ],
    },
    {
      key: 'view',
      items: [
        { key: 'format', title: 'Format...', icon: Type, submenu: context.formatItems },
        {
          key: 'format-bar',
          title: context.formatBar ? 'Hide Format Bar' : 'Show Format Bar',
          icon: PanelBottom,
          shortcut: mod(',', 'alt'),
          run: context.toggleFormatBar,
        },
        {
          key: 'auto-resize',
          title: context.autoResize ? 'Disable Window Auto-Resizing' : 'Enable Window Auto-Resizing',
          icon: UnfoldVertical,
          shortcut: mod('/', 'shift'),
          run: context.toggleAutoResize,
        },
        {
          key: 'always-on-top',
          title: context.alwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top',
          icon: Layers,
          run: context.toggleAlwaysOnTop,
        },
        {
          key: 'count',
          title: context.count === 'words' ? 'Show Character Count' : 'Show Word Count',
          icon: Hash,
          run: context.toggleCount,
        },
        {
          key: 'zoom-in',
          title: 'Zoom In',
          icon: ZoomIn,
          shortcut: mod('='),
          alsoShortcuts: [mod('=', 'shift'), mod('+'), mod('+', 'shift')],
          run: () => context.zoomBy(0.1),
        },
        { key: 'zoom-out', title: 'Zoom Out', icon: ZoomOut, shortcut: mod('-'), run: () => context.zoomBy(-0.1) },
        {
          key: 'zoom-reset',
          title: 'Reset Zoom',
          icon: RotateCcw,
          shortcut: mod('0'),
          disabled: context.zoom === 1,
          run: context.resetZoom,
        },
      ],
    },
    {
      key: 'manage',
      items: [
        { key: 'reveal', title: context.revealLabel, icon: FolderOpen, run: context.reveal },
        {
          key: 'recently-deleted',
          title: 'Show Recently Deleted Notes',
          icon: History,
          run: context.recentlyDeleted,
        },
        {
          key: 'delete',
          title: 'Delete Note',
          icon: Trash2,
          // ⌃X deletes in Raycast; elsewhere Ctrl+X is Cut.
          shortcut: mac ? { key: 'x', modifiers: ['ctrl'] } : mod('Backspace', 'shift'),
          run: context.deleteNote,
        },
        {
          key: 'delete-all',
          title: 'Delete All Notes',
          icon: Trash,
          shortcut: mac ? { key: 'x', modifiers: ['ctrl', 'shift'] } : undefined,
          run: context.deleteAll,
        },
      ],
    },
  ];
}
