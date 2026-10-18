// Media Controls: play, pause and skip whatever is playing, and see what it is. On macOS,
// Spotify and Music are asked directly and anything else gets the media keys; Linux uses
// MPRIS (through playerctl, or gdbus without it); Windows uses its media controls.
import { execFile } from 'node:child_process';
import {
  formatTime,
  MAC_MEDIA_KEY_SCRIPT,
  MAC_MEDIA_KEYS,
  MAC_STATUS_SCRIPT,
  MPRIS_METHODS,
  macControlArgs,
  PLAYERCTL_FORMAT,
  parseBusNames,
  parseMacStatus,
  parseMprisGvariant,
  parsePlayerctl,
  parseWindowsSessions,
  sortPlayers,
  windowsMediaKeyScript,
  windowsSessionsScript,
} from './media.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('./media.js').Player} Player */
/** @typedef {import('./media.js').MediaAction} MediaAction */

/**
 * @param {string} file
 * @param {string[]} args
 * @param {number} [timeout]
 * @returns {Promise<string>}
 */
function run(file, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        if (stderr?.trim()) error.message = `${error.message}\n${stderr.trim()}`;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Runs a PowerShell script, with its output in UTF-8 (rather than the console's code page) so
 * track names in any language arrive intact.
 * @param {string} script
 */
function powershell(script, timeout = 8000) {
  const utf8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
  return run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(utf8 + script, 'utf16le').toString('base64'),
    ],
    timeout,
  );
}

/** @param {unknown} error */
const isMissing = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT';

/** @param {unknown} error */
function reasonOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .split('\n')
      .filter((line) => line.trim())
      .pop() ?? message
  );
}

/** What to do about a failure, in words. @param {unknown} error @param {string} [app] */
function explain(error, app) {
  const reason = reasonOf(error);
  if (/-1743|not authori[sz]ed to send apple events/i.test(reason)) {
    return `Allow Waypoint to control ${app ?? 'that app'} in System Settings → Privacy & Security → Automation.`;
  }
  return reason;
}

/**
 * What to say once it's done.
 * @param {MediaAction} action
 * @param {Player} player
 */
function done(action, player) {
  if (action === 'next') return 'Skipped to the next track';
  if (action === 'previous') return 'Went back a track';
  return player.state === 'playing' ? `Paused ${player.app}` : `Playing in ${player.app}`;
}

// ── Reading what's playing ───────────────────────────────────────────────────

/**
 * @param {Context['platform']} platform
 * @returns {Promise<Player[]>}
 */
export async function listPlayers(platform) {
  switch (platform) {
    case 'darwin':
      return parseMacStatus(await run('osascript', ['-l', 'JavaScript', '-e', MAC_STATUS_SCRIPT]));
    case 'win32':
      return parseWindowsSessions(await powershell(windowsSessionsScript()));
    default:
      return linuxPlayers();
  }
}

/** @returns {Promise<Player[]>} */
async function linuxPlayers() {
  try {
    return parsePlayerctl(await run('playerctl', ['-a', 'metadata', '--format', PLAYERCTL_FORMAT]));
  } catch (error) {
    // playerctl also fails when no player is open.
    if (!isMissing(error)) return /No players found/i.test(reasonOf(error)) ? [] : Promise.reject(error);
  }
  const names = parseBusNames(
    await run('gdbus', [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.ListNames',
    ]),
  );
  /** @param {string} name @param {string} property */
  const get = (name, property) =>
    run('gdbus', [
      'call',
      '--session',
      '--dest',
      name,
      '--object-path',
      '/org/mpris/MediaPlayer2',
      '--method',
      'org.freedesktop.DBus.Properties.Get',
      'org.mpris.MediaPlayer2.Player',
      property,
    ]).catch(() => '');
  return Promise.all(
    names.map(async (name) => parseMprisGvariant(name, await get(name, 'PlaybackStatus'), await get(name, 'Metadata'))),
  );
}

// ── Controlling it ───────────────────────────────────────────────────────────

/**
 * Plays, pauses or skips one player.
 * @param {Context['platform']} platform
 * @param {Player} player
 * @param {MediaAction} action
 */
async function controlPlayer(platform, player, action) {
  switch (platform) {
    case 'darwin':
      await run('osascript', macControlArgs(player.id, action));
      return;
    case 'win32':
      await powershell(windowsSessionsScript({ app: player.id, action }));
      return;
    default:
      try {
        await run('playerctl', ['-p', player.id.replace(/^org\.mpris\.MediaPlayer2\./, ''), action]);
      } catch (error) {
        if (!isMissing(error)) throw error;
        await mprisCall(player.id, action);
      }
  }
}

/** @param {string} busName @param {MediaAction} action */
function mprisCall(busName, action) {
  return run('gdbus', [
    'call',
    '--session',
    '--dest',
    busName,
    '--object-path',
    '/org/mpris/MediaPlayer2',
    '--method',
    `org.mpris.MediaPlayer2.Player.${MPRIS_METHODS[action]}`,
  ]);
}

/**
 * Plays, pauses or skips whatever is playing, like the media keys on a keyboard.
 * @param {Context['platform']} platform
 * @param {MediaAction} action
 */
export async function controlAny(platform, action) {
  switch (platform) {
    case 'darwin': {
      // Spotify and Music answer directly; anything else (a browser tab, Podcasts) gets the key.
      const players = await listPlayers('darwin').catch(() => []);
      const playing = players.find((player) => player.state === 'playing');
      if (playing) return controlPlayer('darwin', playing, action);
      await run('osascript', ['-l', 'JavaScript', '-e', MAC_MEDIA_KEY_SCRIPT, String(MAC_MEDIA_KEYS[action])]);
      return;
    }
    case 'win32':
      await powershell(windowsMediaKeyScript(action));
      return;
    default: {
      try {
        await run('playerctl', [action]);
        return;
      } catch (error) {
        if (!isMissing(error)) {
          if (/No players found/i.test(reasonOf(error))) throw new Error('Nothing is playing.');
          throw error;
        }
      }
      const players = sortPlayers(await linuxPlayers());
      const player = players[0];
      if (!player) throw new Error('Nothing is playing.');
      await mprisCall(player.id, action);
    }
  }
}

// ── The views ────────────────────────────────────────────────────────────────

/** @param {Player} player */
function describe(player) {
  return [player.artist, player.album].filter(Boolean).join(' — ');
}

/**
 * @param {string | undefined} song
 * @returns {Action[]}
 */
function copySong(song) {
  return song
    ? [{ type: 'copy', text: song, title: 'Copy Song', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } }]
    : [];
}

/**
 * @param {Player} player
 * @returns {ListItem}
 */
function playerItem(player) {
  const playing = player.state === 'playing';
  const song = player.title ? [player.title, player.artist].filter(Boolean).join(' — ') : undefined;
  const length = formatTime(player.duration);
  const position = formatTime(player.position);
  const time =
    position && length
      ? { label: 'Time', value: `${position} / ${length}` }
      : length
        ? { label: 'Length', value: length }
        : undefined;
  const payload = { id: player.id, app: player.app, state: player.state };
  return {
    id: player.id,
    title: player.title ?? player.app,
    subtitle: player.title ? describe(player) || player.app : undefined,
    accessory: `${player.app} · ${playing ? 'Playing' : player.state === 'paused' ? 'Paused' : 'Stopped'}`,
    icon: { builtin: playing ? 'play' : 'pause', tint: playing ? 'green' : 'gray' },
    keywords: [player.app, ...(player.artist ? [player.artist] : []), ...(player.album ? [player.album] : [])],
    detail: {
      title: player.title ?? player.app,
      body: describe(player) || (playing ? 'Playing' : 'Not playing'),
      metadata: [
        { label: 'App', value: player.app },
        ...(player.artist ? [{ label: 'Artist', value: player.artist }] : []),
        ...(player.album ? [{ label: 'Album', value: player.album }] : []),
        ...(time ? [time] : []),
      ],
    },
    actions: [
      { type: 'callback', id: 'play-pause', title: playing ? 'Pause' : 'Play', payload },
      {
        type: 'callback',
        id: 'next',
        title: 'Next Track',
        payload,
        shortcut: { key: 'ArrowRight', modifiers: ['mod'] },
      },
      {
        type: 'callback',
        id: 'previous',
        title: 'Previous Track',
        payload,
        shortcut: { key: 'ArrowLeft', modifiers: ['mod'] },
      },
      ...copySong(song),
      { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function nowPlayingView(ctx) {
  const base = { type: /** @type {const} */ ('list'), title: 'Now Playing', searchPlaceholder: 'Search players…' };
  /** @type {Player[]} */
  let players;
  try {
    players = sortPlayers(await listPlayers(ctx.platform));
  } catch (error) {
    return { ...base, sections: [], emptyText: `Couldn't see what's playing: ${explain(error, 'Spotify and Music')}` };
  }
  return {
    ...base,
    sections: [{ items: players.map(playerItem) }],
    emptyText:
      ctx.platform === 'darwin'
        ? 'Nothing playing in Spotify or Music. Play or Pause, Next Track and Previous Track work with any app.'
        : ctx.platform === 'linux'
          ? 'Nothing is playing. Apps show up here when they support MPRIS, as most Linux players and browsers do.'
          : 'Nothing is playing.',
  };
}

/** @param {MediaAction} action @returns {import('@waypoint-org/api').CommandImplementation<Context>} */
function keyCommand(action) {
  return {
    async run(ctx) {
      try {
        await controlAny(ctx.platform, action);
        return { hide: true };
      } catch (error) {
        if (isMissing(error) && ctx.platform === 'linux') {
          return { toast: 'Install playerctl to control what’s playing.', toastStyle: 'failure' };
        }
        return { toast: explain(error), toastStyle: 'failure' };
      }
    },
  };
}

/** @param {unknown} payload @returns {Player | undefined} */
function playerOf(payload) {
  const value = /** @type {{ id?: unknown, app?: unknown, state?: unknown } | undefined} */ (payload);
  if (typeof value?.id !== 'string' || typeof value.app !== 'string') return undefined;
  return { id: value.id, app: value.app, state: value.state === 'playing' ? 'playing' : 'paused' };
}

/** @type {Extension} */
export default {
  commands: {
    'play-pause': keyCommand('play-pause'),
    next: keyCommand('next'),
    previous: keyCommand('previous'),
    'now-playing': {
      view: nowPlayingView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') return { replace: await nowPlayingView(ctx) };
        const player = playerOf(payload);
        if (!player || (id !== 'play-pause' && id !== 'next' && id !== 'previous')) return undefined;
        try {
          await controlPlayer(ctx.platform, player, id);
        } catch (error) {
          return { toast: explain(error, player.app), toastStyle: 'failure' };
        }
        // Give the app a moment to change track before asking again.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { replace: await nowPlayingView(ctx), toast: done(id, player) };
      },
    },
  },
};
