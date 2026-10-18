// Finding files: the search each system already keeps (Spotlight, Everything or Windows
// Search, locate), the commands that run it, and ranking what they find. Kept free of side
// effects so it can be tested anywhere.
import { basename, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @typedef {object} Backend A way to search, tried in order until one works.
 * @property {string} id
 * @property {string} file
 * @property {string[]} args
 * @property {Record<string, string>} [env] More environment, for what's safer passed that way.
 * @property {string} [exportArg] The program writes its results to a file named after this
 *   option, rather than printing them.
 * @property {string[]} [widerArgs] A second, wider search to run when the first finds little.
 * @property {boolean} [trustEmpty] Finding nothing means there's nothing, rather than that its
 *   index is out of date, so the next way isn't tried.
 */

/**
 * The words to search for: the text split on spaces, without the quotes people paste paths in.
 * @param {string} query
 */
export function wordsOf(query) {
  return query.replace(/["“”]/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Lower case, without accents, so "cafe" finds "Café". @param {string} text */
export function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * A Spotlight query for names holding every word, ignoring case and accents. In a quoted value
 * `*` is a wildcard and a backslash escapes, so both are escaped in the words, as are quotes.
 * @param {string[]} words
 */
export function spotlightQuery(words) {
  return words.map((word) => `kMDItemFSName == "*${word.replace(/[\\"*]/g, (char) => `\\${char}`)}*"cd`).join(' && ');
}

/**
 * Windows Search's SQL wants quotes doubled; `%`, `_` and `[` in a LIKE pattern are bracketed.
 * @param {string} word
 */
export function likePattern(word) {
  return word.replace(/'/g, "''").replace(/[[%_]/g, (char) => `[${char}]`);
}

/**
 * The Windows Search query for files whose names hold every word, newest first.
 * @param {string[]} words
 * @param {number} limit
 */
export function windowsSearchSql(words, limit) {
  const where = words.map((word) => `System.FileName LIKE '%${likePattern(word)}%'`).join(' AND ');
  return `SELECT TOP ${limit} System.ItemPathDisplay FROM SYSTEMINDEX WHERE SCOPE='file:' AND ${where} ORDER BY System.DateModified DESC`;
}

/**
 * Runs the query in WAYPOINT_SQL against the Windows Search index. It comes in through the
 * environment, so nothing typed is ever read as PowerShell.
 */
export const WINDOWS_SEARCH_SCRIPT = [
  '$connection = New-Object -ComObject ADODB.Connection',
  '$records = New-Object -ComObject ADODB.Recordset',
  `$connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")`,
  '$records.Open($env:WAYPOINT_SQL, $connection)',
  'while (-not $records.EOF) {',
  "  [Console]::Out.WriteLine($records.Fields.Item('System.ItemPathDisplay').Value)",
  '  $records.MoveNext()',
  '}',
  '$records.Close()',
  '$connection.Close()',
].join('\n');

/**
 * Everything's search treats `!`, `|`, `<>`, `"` and `:` as operators, and es reads a word
 * starting with `-` or `/` as an option; such words are quoted, so they're searched for as
 * written.
 * @param {string} word
 */
export function everythingWord(word) {
  return /[!|<>":]|^[-/]/.test(word) ? `"${word.replace(/"/g, '')}"` : word;
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
 * The ways to search on this system, best first, given the programs that are installed. Each
 * is given every word, so what it finds holds them all.
 * @param {string} platform
 * @param {string[]} words At least one.
 * @param {{ home: string, programs: Record<string, string | undefined>, limit: number }} options
 *   `programs` maps a program's name to where it is, when it's installed.
 * @returns {Backend[]}
 */
export function searchPlan(platform, words, { home, programs, limit }) {
  /** @type {Backend[]} */
  const plan = [];
  if (platform === 'darwin') {
    // Your own folders first, then everywhere when that finds little. Spotlight holds every
    // file it indexes, so no results means none.
    const query = spotlightQuery(words);
    plan.push({
      id: 'spotlight',
      file: '/usr/bin/mdfind',
      args: ['-onlyin', home, query],
      widerArgs: [query],
      trustEmpty: true,
    });
  } else if (platform === 'win32') {
    const es = programs['es.exe'];
    if (es) {
      // Printed results come in the console's code page, which can't hold every name; an
      // exported list is always UTF-8.
      plan.push({
        id: 'everything',
        file: es,
        args: ['-n', String(limit), ...words.map(everythingWord)],
        exportArg: '-export-txt',
        trustEmpty: true,
      });
    }
    // Windows Search indexes only some folders (your user folder, mostly), so when it finds
    // nothing, the home folder is looked through as well.
    plan.push({
      id: 'windows-search',
      file: 'powershell.exe',
      args: powershellArgs(WINDOWS_SEARCH_SCRIPT),
      env: { WAYPOINT_SQL: windowsSearchSql(words, limit) },
    });
  } else {
    const locate = programs.plocate ?? programs.locate;
    // locate's database is updated once a day, so it may not have today's files yet.
    if (locate)
      plan.push({ id: 'locate', file: locate, args: ['-i', '-b', '-A', '-l', String(limit), '--', ...words] });
    const fd = programs.fd ?? programs.fdfind;
    if (fd) {
      const [first = '', ...rest] = words;
      plan.push({
        id: 'fd',
        file: fd,
        args: [
          '--ignore-case',
          '--fixed-strings',
          '--absolute-path',
          '--color',
          'never',
          '--max-results',
          String(limit),
          ...rest.map((word) => `--and=${word}`),
          '--',
          first,
          home,
        ],
        trustEmpty: true,
      });
    }
  }
  return plan;
}

/** Folders whose files are rarely the ones you're after. */
const NOISE = [
  /[\\/]node_modules[\\/]/,
  /[\\/]\.[^\\/]+[\\/]/,
  /[\\/]Library[\\/]/,
  /[\\/]AppData[\\/]/,
  /^\/(System|private|usr|opt|bin|sbin|var|proc|snap)\//,
  /^[A-Za-z]:\\(Windows|ProgramData|\$Recycle\.Bin)\\/i,
  /[\\/](__pycache__|\.venv|venv|site-packages|DerivedData|Caches?)[\\/]/,
];

/**
 * The paths whose names hold every word, best first: the name being what was typed, then
 * starting with it, then holding it; files in your own folders before system ones, and
 * shallower before deeper.
 * @param {string[]} paths
 * @param {string[]} words
 * @param {string} home
 */
export function rankPaths(paths, words, home) {
  const folded = words.map(fold);
  const whole = folded.join(' ');
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{ path: string, score: number }>} */
  const ranked = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const name = fold(basename(path));
    if (!folded.every((word) => name.includes(word))) continue;
    const stem = name.slice(0, name.length - extname(name).length);
    let score = stem === whole || name === whole ? 0 : name.startsWith(whole) ? 1 : name.includes(whole) ? 2 : 3;
    if (NOISE.some((pattern) => pattern.test(path))) score += 10;
    if (!path.startsWith(home + sep)) score += 4;
    ranked.push({ path, score: score * 100 + path.split(/[\\/]/).length });
  }
  return ranked.sort((a, b) => a.score - b.score || a.path.length - b.path.length).map(({ path }) => path);
}

/**
 * A browser's file that's still downloading: Chrome's `.crdownload`, Firefox's `.part`,
 * Safari's `.download` and the like.
 * @param {string} name
 */
export function isPartialDownload(name) {
  return /\.(crdownload|part|partial|download|opdownload)$/i.test(name) || /^\.com\.google\.Chrome\./.test(name);
}

/**
 * The Downloads folder on Linux, from the XDG user-dirs file when there is one.
 * @param {string | undefined} userDirs The text of ~/.config/user-dirs.dirs.
 * @param {string} home
 */
export function linuxDownloads(userDirs, home) {
  const line = /^\s*XDG_DOWNLOAD_DIR\s*=\s*"([^"]*)"/m.exec(userDirs ?? '');
  const value = line?.[1]?.replace(/^\$HOME/, home);
  return value?.startsWith('/') ? value : `${home}/Downloads`;
}

/**
 * GTK's list of recently used files (~/.local/share/recently-used.xbel), latest first.
 * @param {string} xml
 * @returns {Array<{ path: string, at: number }>}
 */
export function parseRecentlyUsed(xml) {
  /** @type {Array<{ path: string, at: number }>} */
  const found = [];
  for (const match of xml.matchAll(/<bookmark\b([^>]*)>/g)) {
    const attributes = match[1] ?? '';
    const href = /\bhref="([^"]*)"/.exec(attributes)?.[1];
    if (!href?.startsWith('file://')) continue;
    const times = ['visited', 'modified', 'added']
      .map((name) => Date.parse(new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? ''))
      .filter((time) => Number.isFinite(time));
    try {
      found.push({ path: fileURLToPath(xmlText(href)), at: Math.max(0, ...times) });
    } catch {
      // Not a local file.
    }
  }
  return found.sort((a, b) => b.at - a.at);
}

/** @type {Record<string, string>} */
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * An XML attribute's text, its entities decoded in one pass: `&amp;`, `&#39;`, `&#x27;`…
 * @param {string} text
 */
export function xmlText(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)));
    return XML_ENTITIES[lower] ?? whole;
  });
}

/**
 * `mdfind -attr kMDItemLastUsedDate …` prints each path with its date after it.
 * @param {string} line
 * @returns {{ path: string, at?: number }}
 */
export function parseLastUsedLine(line) {
  const match = /^(.*?)\s+kMDItemLastUsedDate\s*=\s*(.*)$/.exec(line);
  if (!match) return { path: line.trim() };
  const path = (match[1] ?? '').trim();
  const at = Date.parse((match[2] ?? '').trim());
  return Number.isFinite(at) ? { path, at } : { path };
}

/**
 * Windows' recent files, through the shortcuts it keeps in the Recent folder.
 * @param {number} limit
 */
export function windowsRecentScript(limit) {
  return [
    '$shell = New-Object -ComObject WScript.Shell',
    `Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'Microsoft\\Windows\\Recent') -Filter *.lnk |`,
    `  Sort-Object LastWriteTime -Descending | Select-Object -First ${limit} |`,
    '  ForEach-Object { [Console]::Out.WriteLine($shell.CreateShortcut($_.FullName).TargetPath) }',
  ].join('\n');
}

/**
 * Copies a file itself to the clipboard, ready to paste into a chat, an email or a folder.
 * @param {string} platform
 * @param {string} path
 * @param {{ wayland: boolean, programs: Record<string, string | undefined> }} options
 * @returns {{ file: string, args: string[], input?: string, env?: Record<string, string> } | undefined}
 */
export function copyFileCommand(platform, path, { wayland, programs }) {
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', path],
    };
  }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: powershellArgs('Set-Clipboard -LiteralPath $env:WAYPOINT_FILE'),
      env: { WAYPOINT_FILE: path },
    };
  }
  const uri = `${pathToFileURL(path).href}\r\n`;
  if (wayland && programs['wl-copy']) {
    return { file: /** @type {string} */ (programs['wl-copy']), args: ['--type', 'text/uri-list'], input: uri };
  }
  if (programs.xclip) {
    return { file: programs.xclip, args: ['-selection', 'clipboard', '-t', 'text/uri-list'], input: uri };
  }
  return undefined;
}

/**
 * Moves a file or folder to the Trash (the Recycle Bin on Windows), where it can be put back.
 * @param {string} platform
 * @param {string} path
 * @param {Record<string, string | undefined>} programs
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
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      '$path = $env:WAYPOINT_FILE',
      "if (Test-Path -LiteralPath $path -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
      "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
    ].join('\n');
    return { file: 'powershell.exe', args: powershellArgs(script), env: { WAYPOINT_FILE: path } };
  }
  if (programs.gio) return { file: programs.gio, args: ['trash', '--', path] };
  if (programs.kioclient5) return { file: programs.kioclient5, args: ['move', path, 'trash:/'] };
  if (programs['trash-put']) return { file: programs['trash-put'], args: ['--', path] };
  return undefined;
}

/**
 * Opens a file with the app it belongs to. On Windows the path goes through the environment,
 * as Explorer splits a path at commas.
 * @param {string} platform
 * @param {string} path
 * @returns {{ file: string, args: string[], env?: Record<string, string> }}
 */
export function openCommand(platform, path) {
  if (platform === 'darwin') return { file: 'open', args: [path] };
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: powershellArgs('Start-Process -FilePath $env:WAYPOINT_FILE'),
      env: { WAYPOINT_FILE: path },
    };
  }
  return { file: 'xdg-open', args: [path] };
}

/** @type {Record<string, string>} */
const KINDS = {
  pdf: 'PDF document',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  heic: 'HEIC image',
  svg: 'SVG image',
  mp4: 'MPEG-4 video',
  mov: 'QuickTime movie',
  mp3: 'MP3 audio',
  wav: 'WAV audio',
  zip: 'ZIP archive',
  dmg: 'Disk image',
  pkg: 'Installer package',
  exe: 'Windows program',
  msi: 'Windows installer',
  deb: 'Debian package',
  appimage: 'AppImage',
  doc: 'Word document',
  docx: 'Word document',
  xls: 'Excel spreadsheet',
  xlsx: 'Excel spreadsheet',
  csv: 'CSV table',
  ppt: 'PowerPoint presentation',
  pptx: 'PowerPoint presentation',
  key: 'Keynote presentation',
  pages: 'Pages document',
  numbers: 'Numbers spreadsheet',
  txt: 'Plain text',
  md: 'Markdown',
  json: 'JSON',
  html: 'HTML page',
  app: 'Application',
};

/**
 * @param {string} name
 * @param {boolean} isFolder
 */
export function kindOf(name, isFolder) {
  const extension = extname(name).slice(1).toLowerCase();
  if (isFolder) return extension === 'app' ? 'Application' : 'Folder';
  return KINDS[extension] ?? (extension ? `${extension.toUpperCase()} file` : 'File');
}

/** Names of text files that have no extension. */
const TEXT_NAMES =
  /^(readme|license|licence|changelog|makefile|dockerfile|procfile|gemfile|rakefile|\.?env.*|\.gitignore|\.npmrc|\.editorconfig)$/i;
const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown mdx rst json jsonc json5 js mjs cjs ts mts cts jsx tsx vue svelte astro py rb go rs java kt kts ' +
    'swift c h cc cpp hpp cs php sh bash zsh fish ps1 bat cmd yml yaml toml ini cfg conf env csv tsv log xml plist ' +
    'html htm css scss sass less sql graphql gql lua r pl dart tf hcl gradle properties srt vtt tex ics vcf'
  ).split(' '),
);

/** @param {string} name */
export function isTextName(name) {
  return TEXT_EXTENSIONS.has(extname(name).slice(1).toLowerCase()) || TEXT_NAMES.test(name);
}

/**
 * The start of a file for the preview pane. Markdown is shown as Markdown; anything else as
 * written, so `#` comments and `-` lines aren't read as headings and bullets.
 * @param {string} text
 * @param {string} name
 * @param {number} [maxLines]
 */
export function previewOf(text, name, maxLines = 60) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').slice(0, maxLines);
  if (/\.(md|markdown|mdx)$/i.test(name)) return lines.join('\n');
  return lines.map((line) => (/^\s*(#{1,6}\s|[-*+]\s)/.test(line) ? `\u200b${line}` : line)).join('\n');
}

/**
 * Whether bytes from a file's start look like text: no NUL bytes, and valid UTF-8.
 * @param {Buffer} bytes
 */
export function looksLikeText(bytes) {
  if (bytes.includes(0)) return false;
  try {
    // Streaming, so a character cut off where the bytes end isn't an error.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * "980 B", "12 KB", "1.4 MB", as Finder and Explorer count them.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
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

/**
 * The folder a path is in, with ~ for your home folder.
 * @param {string} path
 * @param {string} home
 */
export function whereIs(path, home) {
  const dir = dirname(path);
  if (dir === home) return '~';
  return dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir;
}
