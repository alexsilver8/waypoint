// Script commands: scripts that say in comments near the top what they're called and how they
// run. Both Raycast's `@raycast.title` headers and Waypoint's own `@waypoint.title` are read,
// so scripts written for Raycast work as they are. Kept free of side effects so it can be
// tested anywhere.
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

/**
 * @typedef {'silent' | 'compact' | 'fullOutput' | 'inline'} Mode `silent` closes the launcher
 *   and runs; `compact` shows the last line it printed; `fullOutput` shows everything it printed;
 *   `inline` also shows its first line beside it in the list, run again every `refreshTime`.
 *
 * @typedef {object} Argument
 * @property {'text' | 'password' | 'dropdown'} type
 * @property {string} placeholder
 * @property {boolean} optional
 * @property {boolean} percentEncoded Pass it URL-encoded.
 * @property {Array<{ title: string, value: string }>} [options] For dropdowns.
 *
 * @typedef {object} Script
 * @property {string} path
 * @property {string} title
 * @property {Mode} mode
 * @property {string} [packageName]
 * @property {string} [icon] An emoji, or an absolute path to an image.
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [authorUrl]
 * @property {boolean} needsConfirmation
 * @property {string} [cwd] Where to run it; the script's folder when not given.
 * @property {number} [refreshSeconds] For `inline` scripts.
 * @property {Argument[]} arguments
 */

/** Read this much of each file to find its headers. */
export const HEADER_BYTES = 8192;

const MODES = new Set(['silent', 'compact', 'fullOutput', 'inline']);

/** Comment starts in the languages scripts are written in: shell, JavaScript, AppleScript, batch. */
const HEADER = /^\s*(?:#|\/\/|--|;|::|REM\s)\s*@(raycast|waypoint)\.([A-Za-z0-9]+)\s+(.*?)\s*$/i;

/** Files that only talk about headers, like a README, rather than being scripts. */
const NOT_SCRIPTS = /\.(md|markdown|txt|json|ya?ml|toml|png|jpe?g|gif|svg|ico|icns|webp|pdf|html?|css|lock)$/i;

/** @param {string} path */
export function mightBeScript(path) {
  return !NOT_SCRIPTS.test(path) && !basename(path).startsWith('.');
}

/**
 * Reads `@raycast.*` and `@waypoint.*` headers; Waypoint's win where both are given.
 * @param {string} text The start of the file.
 * @returns {Record<string, string>}
 */
export function readHeaders(text) {
  /** @type {Record<string, string>} */
  const raycast = {};
  /** @type {Record<string, string>} */
  const waypoint = {};
  for (const line of text.split(/\r?\n/)) {
    const match = HEADER.exec(line);
    if (!match) continue;
    const [, prefix = '', key = '', value = ''] = match;
    (prefix.toLowerCase() === 'waypoint' ? waypoint : raycast)[key] = value;
  }
  return { ...raycast, ...waypoint };
}

/**
 * `@raycast.argument1 { "type": "text", "placeholder": "Name", "optional": true }`.
 * @param {string} json
 * @returns {Argument | undefined}
 */
export function parseArgument(json) {
  /** @type {any} */
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const type = raw.type === 'password' || raw.type === 'dropdown' ? raw.type : 'text';
  /** @type {Argument} */
  const argument = {
    type,
    placeholder: typeof raw.placeholder === 'string' && raw.placeholder.trim() ? raw.placeholder.trim() : 'Value',
    optional: raw.optional === true,
    percentEncoded: raw.percentEncoded === true,
  };
  if (type === 'dropdown') {
    const options = (Array.isArray(raw.data) ? raw.data : []).flatMap((/** @type {any} */ option) => {
      const value = typeof option?.value === 'string' ? option.value : undefined;
      if (value === undefined) return [];
      return [{ title: typeof option.title === 'string' && option.title ? option.title : value, value }];
    });
    if (options.length === 0) return undefined;
    argument.options = options;
  }
  return argument;
}

/**
 * `1h`, `10m`, `30s` or `1d`, as Raycast writes an inline script's refresh time. Never more
 * often than every ten seconds.
 * @param {string | undefined} text
 */
export function parseRefreshTime(text) {
  const match = /^(\d+)\s*([smhd])$/i.exec(text?.trim() ?? '');
  if (!match) return undefined;
  /** @type {Record<string, number>} */
  const sizes = { s: 1, m: 60, h: 3600, d: 86_400 };
  return Math.max(10, Number(match[1]) * (sizes[(match[2] ?? '').toLowerCase()] ?? 1));
}

/**
 * @param {string} path
 * @param {string} home
 */
export function expandHome(path, home) {
  const trimmed = path.trim();
  if (trimmed === '~') return home;
  if (/^~[\\/]/.test(trimmed)) return join(home, trimmed.slice(2));
  return trimmed;
}

/**
 * A script from its file's start, or nothing when it has no title.
 * @param {string} path
 * @param {string} text
 * @param {string} home
 * @returns {Script | undefined}
 */
export function parseScript(path, text, home) {
  const headers = readHeaders(text);
  const title = headers.title?.trim();
  if (!title) return undefined;
  const dir = resolve(path, '..');
  const mode = /** @type {Mode} */ (MODES.has(headers.mode ?? '') ? headers.mode : 'compact');

  /** @type {Argument[]} */
  const args = [];
  for (const key of ['argument1', 'argument2', 'argument3']) {
    const json = headers[key];
    if (!json) break;
    const argument = parseArgument(json);
    if (argument) args.push(argument);
  }

  /** @type {Script} */
  const script = { path, title, mode, needsConfirmation: headers.needsConfirmation === 'true', arguments: args };
  if (headers.packageName) script.packageName = headers.packageName;
  if (headers.description) script.description = headers.description;
  if (headers.author) script.author = headers.author;
  if (headers.authorURL) script.authorUrl = headers.authorURL;
  const icon = headers.icon?.trim();
  if (icon && !/^https?:/i.test(icon)) {
    script.icon = /\.(png|jpe?g|gif|webp|svg|ico|icns)$/i.test(icon)
      ? isAbsolute(expandHome(icon, home))
        ? expandHome(icon, home)
        : resolve(dir, icon)
      : icon;
  }
  if (headers.currentDirectoryPath) {
    const cwd = expandHome(headers.currentDirectoryPath, home);
    script.cwd = isAbsolute(cwd) ? cwd : resolve(dir, cwd);
  }
  if (mode === 'inline') {
    const seconds = parseRefreshTime(headers.refreshTime);
    if (seconds) script.refreshSeconds = seconds;
  }
  return script;
}

/**
 * The program that runs a script: its shebang line on macOS and Linux, else what its
 * extension says. Run directly when it's neither but can be run.
 * @param {string} path
 * @param {string} text The start of the file.
 * @param {string} platform
 * @returns {{ file: string, args: string[], batch?: boolean }} `batch` for a Windows batch file,
 *   which cmd.exe runs: see `spawnArgs`.
 */
export function interpreterFor(path, text, platform) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (platform !== 'win32' && firstLine.startsWith('#!')) {
    const [file = '', ...args] = firstLine.slice(2).trim().split(/\s+/);
    if (file) return { file, args: [...args, path] };
  }
  const extension = extname(path).toLowerCase();
  /** @type {Record<string, { file: string, args: string[], batch?: boolean }>} */
  const byExtension =
    platform === 'win32'
      ? {
          '.ps1': { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path] },
          '.cmd': { file: 'cmd.exe', args: [path], batch: true },
          '.bat': { file: 'cmd.exe', args: [path], batch: true },
          '.py': { file: 'python', args: [path] },
          '.js': { file: 'node', args: [path] },
          '.mjs': { file: 'node', args: [path] },
          '.rb': { file: 'ruby', args: [path] },
          '.sh': { file: 'bash', args: [path] },
        }
      : {
          '.sh': { file: '/bin/bash', args: [path] },
          '.bash': { file: '/bin/bash', args: [path] },
          '.zsh': { file: '/bin/zsh', args: [path] },
          '.py': { file: 'python3', args: [path] },
          '.js': { file: 'node', args: [path] },
          '.mjs': { file: 'node', args: [path] },
          '.rb': { file: 'ruby', args: [path] },
          '.pl': { file: 'perl', args: [path] },
          '.php': { file: 'php', args: [path] },
          '.swift': { file: 'swift', args: [path] },
          '.applescript': { file: 'osascript', args: [path] },
          '.scpt': { file: 'osascript', args: [path] },
          '.ps1': { file: 'pwsh', args: ['-NoProfile', '-File', path] },
        };
  return byExtension[extension] ?? { file: path, args: [] };
}

/** What cmd.exe reads as more than text. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * An argument for a batch file, quoted the way cmd.exe and then the batch file read it: the
 * quoting Windows programs expect (backslashes doubled before a quote, which is escaped), then
 * a ^ before each character cmd.exe would act on, twice, as a batch file's command line is
 * read twice. As cross-spawn does it, in one pass over the text.
 * @param {string} arg
 */
export function batchArgument(arg) {
  let quoted = '';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes++;
      continue;
    }
    quoted += char === '"' ? `${'\\'.repeat(backslashes * 2 + 1)}"` : `${'\\'.repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  quoted = `"${quoted}${'\\'.repeat(backslashes * 2)}"`;
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/**
 * What to start for a script and its arguments. A batch file runs in cmd.exe, which reads one
 * command line rather than separate arguments, so that line is built here, every argument
 * escaped, and handed over as it is (`verbatim`).
 * @param {{ file: string, args: string[], batch?: boolean }} command
 * @param {string[]} args
 * @returns {{ file: string, args: string[], verbatim: boolean }}
 */
export function spawnArgs(command, args) {
  if (!command.batch) return { file: command.file, args: [...command.args, ...args], verbatim: false };
  const path = command.args[0] ?? '';
  const line = [path.replace(CMD_META, '^$1'), ...args.map(batchArgument)].join(' ');
  return { file: command.file, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

/**
 * Splits typed arguments like a shell: by spaces, keeping quoted parts together.
 * @param {string} text
 * @returns {string[]}
 */
export function splitArguments(text) {
  /** @type {string[]} */
  const parts = [];
  let current = '';
  let quote = '';
  let started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) parts.push(current);
      current = '';
      started = false;
    } else {
      current += char;
    }
  }
  if (started || current) parts.push(current);
  return parts;
}

/**
 * "Title: rest" typed after picking a script with arguments: the script, and what follows.
 * The longest title wins, so "Search" and "Search Docs" can both have arguments.
 * @param {string} query
 * @param {Script[]} scripts
 * @returns {{ script: Script, rest: string } | undefined}
 */
export function parseInvocation(query, scripts) {
  const lower = query.toLowerCase();
  let best;
  for (const script of scripts) {
    if (script.arguments.length === 0) continue;
    const prefix = `${script.title.toLowerCase()}:`;
    if (lower.startsWith(prefix) && (!best || script.title.length > best.script.title.length)) {
      best = { script, rest: query.slice(prefix.length).replace(/^\s+/, '') };
    }
  }
  return best;
}

/**
 * @typedef {object} Filled
 * @property {string[]} values What to pass, URL-encoded where the script asked.
 * @property {number} next The first argument still to type; `arguments.length` when done.
 * @property {string} partial What's typed so far of that argument.
 * @property {boolean} complete Every argument it needs is there, so it can run.
 * @property {string} [problem] Why what's typed won't do, like a value not in a dropdown.
 */

/**
 * Matches what was typed to a script's arguments. With one argument, everything typed is it;
 * with more, they're split like a shell would, the last taking what's left over.
 * @param {Script} script
 * @param {string} rest
 * @returns {Filled}
 */
export function fillArguments(script, rest) {
  const specs = script.arguments;
  const endsInSpace = /\s$/.test(rest);
  /** @type {string[]} */
  let typed =
    specs.length === 1 ? (rest.trim() ? [rest.trim().replace(/^(["'])(.*)\1$/, '$2')] : []) : splitArguments(rest);
  if (specs.length > 1 && typed.length > specs.length) {
    typed = [...typed.slice(0, specs.length - 1), typed.slice(specs.length - 1).join(' ')];
  }
  /** @type {string[]} */
  const values = [];
  for (const [index, spec] of specs.entries()) {
    const value = typed[index];
    if (value === undefined) {
      return { values, next: index, partial: '', complete: specs.slice(index).every((each) => each.optional) };
    }
    if (spec.type === 'dropdown') {
      const option = findOption(spec, value);
      if (!option) {
        // Still being typed while it's the last word with no space after it.
        const typing = index === typed.length - 1 && !endsInSpace;
        return {
          values,
          next: index,
          partial: value,
          complete: false,
          ...(typing ? {} : { problem: `“${value}” isn't one of the choices for ${spec.placeholder}.` }),
        };
      }
      values.push(spec.percentEncoded ? encodeURIComponent(option.value) : option.value);
      continue;
    }
    if (!value && !spec.optional) return { values, next: index, partial: '', complete: false };
    values.push(spec.percentEncoded ? encodeURIComponent(value) : value);
  }
  return { values, next: specs.length, partial: '', complete: true };
}

/**
 * The dropdown choice typed, by its value or its title.
 * @param {Argument} spec
 * @param {string} typed
 */
export function findOption(spec, typed) {
  const lower = typed.toLowerCase();
  return spec.options?.find((each) => each.value.toLowerCase() === lower || each.title.toLowerCase() === lower);
}

/**
 * Arguments to show: as typed, with passwords hidden.
 * @param {Script} script
 * @param {string[]} values
 */
export function shownForm(script, values) {
  return typedForm(
    script,
    values.map((value, index) => (script.arguments[index]?.type === 'password' && value ? '••••••' : value)),
  );
}

/**
 * Arguments as they'd be typed again: quoted when they hold a space, and decoded when the
 * script asked for them URL-encoded.
 * @param {Script} script
 * @param {string[]} values
 */
export function typedForm(script, values) {
  return values
    .map((value, index) => {
      let plain = value;
      if (script.arguments[index]?.percentEncoded) {
        try {
          plain = decodeURIComponent(value);
        } catch {
          // Leave it as it is.
        }
      }
      return /\s/.test(plain) ? `"${plain.replace(/"/g, '')}"` : plain;
    })
    .join(' ');
}

/**
 * How to type a script's arguments: `Title: <Name> [Surname]`.
 * @param {Script} script
 */
export function usage(script) {
  const parts = script.arguments.map((argument) =>
    argument.optional ? `[${argument.placeholder}]` : `<${argument.placeholder}>`,
  );
  return `${script.title}: ${parts.join(' ')}`;
}

/** @param {string} text */
export function stripAnsi(text) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal colour codes is the point
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[\]P^_][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '');
}

/**
 * The last line a script printed, for a toast.
 * @param {string} output
 */
export function lastLine(output) {
  return (
    stripAnsi(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ''
  );
}

/**
 * The first line a script printed, for beside it in the list.
 * @param {string} output
 */
export function firstLine(output) {
  return (
    stripAnsi(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

/**
 * Output for the preview pane, which reads `# ` as a heading and `- ` as a bullet: those lines
 * are kept as written. The end is kept when there's more than fits.
 * @param {string} output
 * @param {number} [max]
 */
export function asPlainPreview(output, max = 20_000) {
  const text = stripAnsi(output).replace(/\r\n/g, '\n');
  const kept = text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
  return kept
    .split('\n')
    .map((line) => (/^\s*(#{1,6}\s|[-*+]\s)/.test(line) ? `​${line}` : line))
    .join('\n');
}

/**
 * A file name for a new script: "Open Jira Ticket" → "open-jira-ticket.sh".
 * @param {string} title
 * @param {string} extension
 */
export function fileNameFor(title, extension) {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'script';
  return `${slug}${extension}`;
}

/**
 * @typedef {object} Language
 * @property {string} id
 * @property {string} name
 * @property {string} extension
 * @property {string} comment
 * @property {string} [shebang]
 * @property {(title: string) => string} body
 * @property {string[]} platforms
 */

/** @type {Language[]} */
export const LANGUAGES = [
  {
    id: 'bash',
    name: 'Bash',
    extension: '.sh',
    comment: '#',
    shebang: '#!/bin/bash',
    body: (title) => `echo "Hello from ${title.replace(/["$`\\]/g, '')}"`,
    platforms: ['darwin', 'linux'],
  },
  {
    id: 'python',
    name: 'Python',
    extension: '.py',
    comment: '#',
    shebang: '#!/usr/bin/env python3',
    body: (title) => `print(${JSON.stringify(`Hello from ${title}`)})`,
    platforms: ['darwin', 'linux', 'win32'],
  },
  {
    id: 'node',
    name: 'Node.js',
    extension: '.js',
    comment: '//',
    shebang: '#!/usr/bin/env node',
    body: (title) => `console.log(${JSON.stringify(`Hello from ${title}`)});`,
    platforms: ['darwin', 'linux', 'win32'],
  },
  {
    id: 'applescript',
    name: 'AppleScript',
    extension: '.applescript',
    comment: '#',
    shebang: '#!/usr/bin/osascript',
    body: (title) => `log ${JSON.stringify(`Hello from ${title}`)}`,
    platforms: ['darwin'],
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    extension: '.ps1',
    comment: '#',
    body: (title) => `Write-Output '${`Hello from ${title}`.replace(/'/g, "''")}'`,
    platforms: ['win32'],
  },
];

/**
 * A new script, ready to edit: its headers, and a line that shows it works.
 * @param {Language} language
 * @param {string} title
 */
export function template(language, title) {
  const c = language.comment;
  const clean = title.replace(/[\r\n]+/g, ' ').trim();
  return [
    ...(language.shebang ? [language.shebang, ''] : []),
    `${c} @waypoint.title ${clean}`,
    `${c} @waypoint.mode compact`,
    `${c} @waypoint.icon 🤖`,
    `${c} @waypoint.description What this script does.`,
    '',
    `${c} Modes: silent closes the launcher, compact shows the last line printed, fullOutput shows`,
    `${c} everything printed. To ask for an argument when it runs, take one ${c[0]} off the next line.`,
    `${c}${c[0]} @waypoint.argument1 { "type": "text", "placeholder": "Name" }`,
    '',
    language.body(clean),
    '',
  ].join('\n');
}

/**
 * Scripts matching every word typed, in their title, package or description; titles that
 * start with what's typed first.
 * @param {Script[]} scripts
 * @param {string} query
 */
export function matchScripts(scripts, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return scripts;
  const whole = words.join(' ');
  /** @param {Script} script */
  const rank = (script) => {
    const title = script.title.toLowerCase();
    if (title === whole) return 0;
    if (title.startsWith(whole)) return 1;
    if (title.includes(whole)) return 2;
    return words.every((word) => title.includes(word)) ? 3 : 4;
  };
  return scripts
    .filter((script) => {
      const text = `${script.title} ${script.packageName ?? ''} ${script.description ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .map((script, index) => ({ script, index, rank: rank(script) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ script }) => script);
}
