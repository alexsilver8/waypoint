// Disk usage: reading what's typed, naming the kinds of files, and the words and numbers the
// lists show. Kept free of side effects so it can be tested anywhere.
import { posix, win32 } from 'node:path';

/** @typedef {'darwin' | 'win32' | 'linux'} Platform */

/** @param {string} platform */
const pathsOf = (platform) => (platform === 'win32' ? win32 : posix);

/** Lower case, without accents, so "cafe" finds "Café". @param {string} text */
export function fold(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * The words to filter by: the text split on spaces, folded, without the quotes people paste
 * names in.
 * @param {string} text
 */
export function wordsOf(text) {
  return fold(text.replace(/["“”]/g, ' ')).split(/\s+/).filter(Boolean);
}

/**
 * What a search asks for. A folder typed into it, starting with `/`, `~` or a drive (`C:\`),
 * says where to look, and `trailing` whether it ends in a slash; anything else filters what's
 * shown.
 * @param {string} query
 * @param {{ home: string, platform: string }} options
 * @returns {{ path?: string, trailing: boolean, words: string[] }}
 */
export function parseQuery(query, { home, platform }) {
  const text = query.trim();
  const paths = pathsOf(platform);
  const windows = platform === 'win32';
  const tilde = windows ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
  const absolute = windows ? /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/ : /^\//;
  if (!tilde.test(text) && !absolute.test(text)) return { trailing: false, words: wordsOf(text) };
  const trailing = windows ? /[\\/]$/.test(text) : text.endsWith('/');
  const expanded = tilde.test(text) ? paths.join(home, text.slice(1)) : text;
  let path = paths.normalize(expanded);
  // Without the slash at the end, except for the top of a disk, which is all slash.
  while (path.length > paths.parse(path).root.length && /[\\/]$/.test(path)) path = path.slice(0, -1);
  return { path, trailing, words: [] };
}

/**
 * A path as it's shown: `~` for your home folder and what's in it, the rest as it is.
 * @param {string} path
 * @param {string} home
 * @param {string} platform
 */
export function displayPath(path, home, platform) {
  const { sep } = pathsOf(platform);
  // Windows paths are the same whatever their case.
  /** @param {string} a @param {string} b */
  const same = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(path, home)) return '~';
  return same(path.slice(0, home.length + 1), home + sep) ? `~${path.slice(home.length)}` : path;
}

/**
 * The folder something is in, as it's shown.
 * @param {string} path
 * @param {string} home
 * @param {string} platform
 */
export function whereIs(path, home, platform) {
  return displayPath(pathsOf(platform).dirname(path), home, platform);
}

/**
 * What to type to look in a folder: its path as shown, ending in a slash so what's typed next
 * filters it.
 * @param {string} path
 * @param {string} home
 * @param {string} platform
 */
export function queryFor(path, home, platform) {
  const { sep } = pathsOf(platform);
  const shown = displayPath(path, home, platform);
  return /[\\/]$/.test(shown) ? shown : shown + sep;
}

/**
 * "980 B", "12 KB", "1.4 GB". Decimal units, as Finder and most disk makers count.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "1,234,567". @param {number} count */
export function formatCount(count) {
  return count.toLocaleString('en-US');
}

/**
 * "1 file", "12,345 files".
 * @param {number} count
 * @param {string} word
 */
export function plural(count, word) {
  return `${formatCount(count)} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * How much of a whole a part is: "35%", or "<1%" for a sliver.
 * @param {number} part
 * @param {number} whole
 */
export function formatShare(part, whole) {
  if (whole <= 0 || part <= 0) return '0%';
  const percent = (part / whole) * 100;
  return percent < 1 ? '<1%' : `${Math.min(100, Math.round(percent))}%`;
}

/**
 * "under a second", "4.2s", "12s", "2m 05s", "1h 03m".
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 1) return 'under a second';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", or the date.
 * @param {number} ms
 * @param {number} now
 */
export function timeAgo(ms, now) {
  const seconds = Math.max(0, (now - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(seconds / 86_400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** @typedef {'archive' | 'disk image' | 'installer' | 'video' | 'audio' | 'image' | 'model'} Category */

/** Each kind of file: what it's called, and the group it's in. @type {Record<string, [string, Category?]>} */
const KINDS = {
  zip: ['ZIP archive', 'archive'],
  rar: ['RAR archive', 'archive'],
  '7z': ['7-Zip archive', 'archive'],
  tar: ['Tar archive', 'archive'],
  gz: ['Gzip archive', 'archive'],
  tgz: ['Gzip archive', 'archive'],
  bz2: ['Bzip2 archive', 'archive'],
  tbz2: ['Bzip2 archive', 'archive'],
  xz: ['XZ archive', 'archive'],
  txz: ['XZ archive', 'archive'],
  zst: ['Zstandard archive', 'archive'],
  lz4: ['LZ4 archive', 'archive'],
  cab: ['Cabinet archive', 'archive'],
  dmg: ['Disk image', 'disk image'],
  iso: ['Disk image', 'disk image'],
  img: ['Disk image', 'disk image'],
  sparseimage: ['Disk image', 'disk image'],
  vmdk: ['Virtual disk', 'disk image'],
  vhd: ['Virtual disk', 'disk image'],
  vhdx: ['Virtual disk', 'disk image'],
  vdi: ['Virtual disk', 'disk image'],
  qcow2: ['Virtual disk', 'disk image'],
  wim: ['Windows image', 'disk image'],
  pkg: ['Installer package', 'installer'],
  mpkg: ['Installer package', 'installer'],
  msi: ['Windows installer', 'installer'],
  msix: ['Windows installer', 'installer'],
  appx: ['Windows installer', 'installer'],
  exe: ['Windows program'],
  deb: ['Debian package', 'installer'],
  rpm: ['RPM package', 'installer'],
  appimage: ['AppImage', 'installer'],
  snap: ['Snap package', 'installer'],
  flatpak: ['Flatpak bundle', 'installer'],
  xip: ['XIP archive', 'installer'],
  apk: ['Android app', 'installer'],
  ipa: ['iOS app', 'installer'],
  mp4: ['MPEG-4 video', 'video'],
  m4v: ['MPEG-4 video', 'video'],
  mov: ['QuickTime movie', 'video'],
  mkv: ['Matroska video', 'video'],
  avi: ['AVI video', 'video'],
  webm: ['WebM video', 'video'],
  wmv: ['Windows Media video', 'video'],
  mts: ['AVCHD video', 'video'],
  mp3: ['MP3 audio', 'audio'],
  m4a: ['MPEG-4 audio', 'audio'],
  wav: ['WAV audio', 'audio'],
  aif: ['AIFF audio', 'audio'],
  aiff: ['AIFF audio', 'audio'],
  flac: ['FLAC audio', 'audio'],
  ogg: ['Ogg audio', 'audio'],
  png: ['PNG image', 'image'],
  jpg: ['JPEG image', 'image'],
  jpeg: ['JPEG image', 'image'],
  heic: ['HEIC image', 'image'],
  gif: ['GIF image', 'image'],
  webp: ['WebP image', 'image'],
  tif: ['TIFF image', 'image'],
  tiff: ['TIFF image', 'image'],
  psd: ['Photoshop document', 'image'],
  dng: ['Raw photo', 'image'],
  cr2: ['Raw photo', 'image'],
  cr3: ['Raw photo', 'image'],
  nef: ['Raw photo', 'image'],
  arw: ['Raw photo', 'image'],
  gguf: ['GGUF model', 'model'],
  safetensors: ['Safetensors model', 'model'],
  ckpt: ['Model checkpoint', 'model'],
  onnx: ['ONNX model', 'model'],
  pdf: ['PDF document'],
  sqlite: ['SQLite database'],
  db: ['Database'],
  log: ['Log file'],
  csv: ['CSV table'],
  json: ['JSON'],
  ipsw: ['iOS firmware'],
  key: ['Keynote presentation'],
  pptx: ['PowerPoint presentation'],
  docx: ['Word document'],
  xlsx: ['Excel spreadsheet'],
};

/** Files known by their whole name, often the biggest on a developer's disk. @type {Record<string, string>} */
const NAMED = {
  'docker.raw': "Docker's virtual disk",
  'docker.qcow2': "Docker's virtual disk",
  'ext4.vhdx': "WSL's virtual disk",
  'pagefile.sys': 'Windows page file',
  'hiberfil.sys': 'Windows hibernation file',
  swapfile: 'Swap file',
};

/** Folders that are things of their own on macOS. @type {Record<string, string>} */
const PACKAGES = {
  app: 'Application',
  photoslibrary: 'Photos library',
  musiclibrary: 'Music library',
  fcpbundle: 'Final Cut Pro library',
  logicx: 'Logic Pro project',
  sparsebundle: 'Disk image',
  xcarchive: 'Xcode archive',
  utm: 'Virtual machine',
  pvm: 'Virtual machine',
};

/** @param {string} name */
function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * What a file or folder is: "ZIP archive", "Folder", "Application".
 * @param {string} name
 * @param {boolean} isFolder
 */
export function kindOf(name, isFolder) {
  const extension = extensionOf(name);
  if (isFolder) return PACKAGES[extension] ?? 'Folder';
  const named = NAMED[name.toLowerCase()];
  if (named) return named;
  if (/\.tar\.(gz|bz2|xz|zst)$/i.test(name)) return 'Tar archive';
  return KINDS[extension]?.[0] ?? (extension ? `${extension.toUpperCase()} file` : 'File');
}

/**
 * The group a file is in, for filtering: "archive", "video"…
 * @param {string} name
 * @returns {Category | undefined}
 */
export function categoryOf(name) {
  return KINDS[extensionOf(name)]?.[1];
}

/**
 * Whether a file is something you may not need once it's done its job: an archive, a disk
 * image or an installer. A program is only counted in your downloads, or when its name says
 * it sets something up, as programs on Windows are mostly apps you use.
 * @param {string} name
 * @param {{ inDownloads: boolean }} options
 */
export function isLeftover(name, { inDownloads }) {
  const category = categoryOf(name);
  if (category === 'archive' || category === 'disk image' || category === 'installer') return true;
  return extensionOf(name) === 'exe' && (inDownloads || /setup|install/i.test(name));
}

/**
 * The folder an archive unpacks into, by the name it's usually given: "photos.zip" and
 * "photos.tar.gz" both make "photos". Nothing for what isn't an archive.
 * @param {string} name
 */
export function unpackedName(name) {
  if (categoryOf(name) !== 'archive') return undefined;
  const stem = name.replace(/(\.tar)?\.[^.]+$/i, '');
  return stem && stem !== name ? stem : undefined;
}

/**
 * Whether every word is somewhere in the text.
 * @param {string[]} words Folded, as `wordsOf` makes them.
 * @param {string} text
 */
export function matches(words, text) {
  if (words.length === 0) return true;
  // Plain ASCII has no accents to take off, and long lists match fastest without folding it.
  const folded = /[^ -~]/.test(text) ? fold(text) : text.toLowerCase();
  return words.every((word) => folded.includes(word));
}

/**
 * PowerShell, with its output in UTF-8 so file names in any language arrive intact.
 * @param {string} script
 * @returns {string[]}
 */
export function powershellArgs(script) {
  const utf8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(utf8 + script, 'utf16le').toString('base64'),
  ];
}

/**
 * Moves the file or folder in WAYPOINT_FILE to the Recycle Bin the way Explorer's Delete does.
 * What can't be recycled (on a network share, or bigger than the bin holds) would be deleted for
 * good instead: Windows asks first, and it's left alone unless that's allowed.
 */
export const WINDOWS_RECYCLE = `$ErrorActionPreference = 'Stop'
Add-Type -Namespace Waypoint -Name Shell -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct FileOperation {
  public IntPtr Window;
  public uint Function;
  public string From;
  public string To;
  public ushort Flags;
  public bool Aborted;
  public IntPtr NameMappings;
  public string ProgressTitle;
}
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern int SHFileOperation(ref FileOperation operation);
'@
$operation = New-Object Waypoint.Shell+FileOperation
# FO_DELETE, of a list of paths that ends in two NULs.
$operation.Function = 3
$operation.From = $env:WAYPOINT_FILE + [char]0
# FOF_ALLOWUNDO (the Recycle Bin), FOF_SILENT, FOF_NOCONFIRMATION and FOF_NOERRORUI, but
# FOF_WANTNUKEWARNING: ask before deleting anything for good.
$operation.Flags = 0x4454
$result = [Waypoint.Shell]::SHFileOperation([ref]$operation)
if ($operation.Aborted) { [Console]::Error.WriteLine("It can't go in the Recycle Bin, so it was left where it is."); exit 1 }
if ($result -ne 0) { [Console]::Error.WriteLine(('Windows answered 0x{0:X}.' -f $result)); exit 1 }`;

/**
 * Moves a file or folder to the Trash (the Recycle Bin on Windows), where it can be put back.
 * @param {string} platform
 * @param {string} path
 * @param {Record<string, string | undefined>} programs Where the Linux helpers are, if installed.
 * @returns {{ file: string, args: string[], env?: Record<string, string> } | undefined}
 */
export function trashCommand(platform, path, programs) {
  if (platform === 'darwin') {
    // Through Finder, so Put Back works.
    return {
      file: 'osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
        '-e',
        'end run',
        path,
      ],
    };
  }
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: powershellArgs(WINDOWS_RECYCLE), env: { WAYPOINT_FILE: path } };
  }
  if (programs.gio) return { file: programs.gio, args: ['trash', '--', path] };
  if (programs.kioclient5) return { file: programs.kioclient5, args: ['move', path, 'trash:/'] };
  if (programs['trash-put']) return { file: programs['trash-put'], args: ['--', path] };
  return undefined;
}

/**
 * Why moving to the Trash failed, and what to do about it. The first time on macOS, Finder
 * asks whether Waypoint may control it, and waits for an answer.
 * @param {unknown} error
 * @param {string} platform
 */
export function explainTrash(error, platform) {
  const reason = error instanceof Error ? error.message : String(error);
  if (/-1743|not authori[sz]ed to send apple events/i.test(reason)) {
    return 'Allow Waypoint to control Finder in System Settings → Privacy & Security → Automation.';
  }
  if (platform === 'darwin' && /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ETIMEDOUT') {
    return 'If macOS asked whether Waypoint may control Finder, allow it, then try again.';
  }
  return reason;
}
