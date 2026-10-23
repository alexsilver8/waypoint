import {
  AppWindow,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Battery,
  Calculator,
  Clipboard,
  Copy,
  Cpu,
  Eject,
  File,
  Folder,
  GitCommitHorizontal,
  Globe,
  HardDrive,
  Info,
  Link,
  Lock,
  LogOut,
  Maximize2,
  MemoryStick,
  Minimize2,
  Monitor,
  Moon,
  Music,
  Network,
  Pause,
  Play,
  Plug,
  Power,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  StickyNote,
  Terminal,
  TextAlignStart,
  Trash2,
  TriangleAlert,
  Undo2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { type ComponentType, useState } from 'react';
import type { BuiltinIconName, Icon } from '../../../shared/types';

type Glyph = ComponentType<{ size?: number; strokeWidth?: number }>;

/**
 * A screen outline with the region a window layout fills, drawn to sit beside the Lucide
 * glyphs. `x`, `y`, `width` and `height` are fractions of the screen.
 */
function layoutGlyph([x, y, width, height]: [number, number, number, number]): Glyph {
  // The inside of the outline, where the filled region goes.
  const inner = { x: 3.5, y: 4.5, width: 17, height: 13 };
  return function LayoutGlyph({ size = 24, strokeWidth = 2 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="1.5"
          y="2.5"
          width="21"
          height="17"
          rx="3"
          stroke="currentColor"
          strokeWidth={strokeWidth * 0.8}
          opacity="0.75"
        />
        <rect
          x={inner.x + inner.width * x}
          y={inner.y + inner.height * y}
          width={inner.width * width}
          height={inner.height * height}
          rx="1.25"
          fill="currentColor"
        />
      </svg>
    );
  };
}

const GLYPHS: Record<BuiltinIconName, Glyph> = {
  alert: TriangleAlert,
  app: AppWindow,
  battery: Battery,
  calculator: Calculator,
  clipboard: Clipboard,
  close: X,
  copy: Copy,
  cpu: Cpu,
  eject: Eject,
  extension: Puzzle,
  file: File,
  folder: Folder,
  'git-commit': GitCommitHorizontal,
  globe: Globe,
  'hard-drive': HardDrive,
  info: Info,
  link: Link,
  lock: Lock,
  'log-out': LogOut,
  memory: MemoryStick,
  monitor: Monitor,
  moon: Moon,
  music: Music,
  network: Network,
  note: StickyNote,
  pause: Pause,
  play: Play,
  plug: Plug,
  power: Power,
  refresh: RefreshCw,
  restart: RotateCcw,
  search: Search,
  server: Server,
  settings: Settings,
  'skip-back': SkipBack,
  'skip-forward': SkipForward,
  sparkles: Sparkles,
  terminal: Terminal,
  text: TextAlignStart,
  trash: Trash2,
  wifi: Wifi,
  'wifi-off': WifiOff,
  'window-left-half': layoutGlyph([0, 0, 1 / 2, 1]),
  'window-right-half': layoutGlyph([1 / 2, 0, 1 / 2, 1]),
  'window-top-half': layoutGlyph([0, 0, 1, 1 / 2]),
  'window-bottom-half': layoutGlyph([0, 1 / 2, 1, 1 / 2]),
  'window-center-half': layoutGlyph([1 / 4, 0, 1 / 2, 1]),
  'window-top-left': layoutGlyph([0, 0, 1 / 2, 1 / 2]),
  'window-top-right': layoutGlyph([1 / 2, 0, 1 / 2, 1 / 2]),
  'window-bottom-left': layoutGlyph([0, 1 / 2, 1 / 2, 1 / 2]),
  'window-bottom-right': layoutGlyph([1 / 2, 1 / 2, 1 / 2, 1 / 2]),
  'window-first-third': layoutGlyph([0, 0, 1 / 3, 1]),
  'window-center-third': layoutGlyph([1 / 3, 0, 1 / 3, 1]),
  'window-last-third': layoutGlyph([2 / 3, 0, 1 / 3, 1]),
  'window-first-two-thirds': layoutGlyph([0, 0, 2 / 3, 1]),
  'window-center-two-thirds': layoutGlyph([1 / 6, 0, 2 / 3, 1]),
  'window-last-two-thirds': layoutGlyph([1 / 3, 0, 2 / 3, 1]),
  'window-top-left-sixth': layoutGlyph([0, 0, 1 / 3, 1 / 2]),
  'window-top-center-sixth': layoutGlyph([1 / 3, 0, 1 / 3, 1 / 2]),
  'window-top-right-sixth': layoutGlyph([2 / 3, 0, 1 / 3, 1 / 2]),
  'window-bottom-left-sixth': layoutGlyph([0, 1 / 2, 1 / 3, 1 / 2]),
  'window-bottom-center-sixth': layoutGlyph([1 / 3, 1 / 2, 1 / 3, 1 / 2]),
  'window-bottom-right-sixth': layoutGlyph([2 / 3, 1 / 2, 1 / 3, 1 / 2]),
  'window-maximize': layoutGlyph([0, 0, 1, 1]),
  'window-almost-maximize': layoutGlyph([0.12, 0.14, 0.76, 0.72]),
  'window-center': layoutGlyph([0.25, 0.22, 0.5, 0.56]),
  'window-make-larger': Maximize2,
  'window-make-smaller': Minimize2,
  'window-next-display': ArrowRightFromLine,
  'window-previous-display': ArrowLeftFromLine,
  'window-restore': Undo2,
};

function Tile({ name, tint }: { name: BuiltinIconName; tint?: string }) {
  const Glyph = GLYPHS[name];
  return (
    <span className="icon icon--tile" data-tint={tint ?? 'gray'} aria-hidden="true">
      <Glyph size={13} strokeWidth={2.25} />
    </span>
  );
}

function FileIcon({ path }: { path: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Tile name="app" />;
  return (
    <img
      className="icon icon--image"
      src={`palette-icon://icon?path=${encodeURIComponent(path)}`}
      alt=""
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ItemIcon({ icon }: { icon?: Icon }) {
  if (!icon) return <span className="icon icon--blank" aria-hidden="true" />;
  if ('builtin' in icon) return <Tile name={icon.builtin} tint={icon.tint} />;
  if ('emoji' in icon) {
    return (
      <span className="icon icon--emoji" aria-hidden="true">
        {icon.emoji}
      </span>
    );
  }
  return <FileIcon path={icon.path} />;
}

/** The pigment a row's selection takes on, from its icon. */
export function tintOf(icon?: Icon): string | undefined {
  return icon && 'builtin' in icon ? (icon.tint ?? 'gray') : undefined;
}
