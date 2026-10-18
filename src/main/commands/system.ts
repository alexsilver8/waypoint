import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActionResult, CommandImplementation, Json, ListItem, Platform, View } from '../../shared/types';
import { exec as defaultExec, type Exec, isMissing, reasonOf } from '../exec';
import { type Disk, ejectDisk, listDisks } from '../system/disks';
import { asksAppsFirst, type PowerAction, type Program, powerPrograms } from '../system/power';
import { emptyTrash } from '../system/trash';
import { setWifiPower, WifiError, wifiPower } from '../system/wifi';
import { type Confirmation, confirmView } from './confirm';
import type { BuiltinExtension } from './types';

const run = promisify(execFile);

type PlatformCommands = Partial<Record<NodeJS.Platform, [file: string, args: string[]]>>;

function shellCommand(commands: PlatformCommands): CommandImplementation {
  return {
    async run() {
      const command = commands[process.platform];
      if (!command) return { toast: 'Not available on this system.', toastStyle: 'failure' };
      await run(command[0], command[1]);
      return { hide: true };
    },
  };
}

const osascript = (script: string): [string, string[]] => ['osascript', ['-e', script]];

/** What to do when macOS won't let Waypoint script an app, or the reason as it came. */
export function explainFailure(error: unknown, app = 'System Events'): string {
  const reason = reasonOf(error);
  if (/-1743|not authori[sz]ed to send apple events/i.test(reason)) {
    return `Allow Waypoint to control ${app} in System Settings → Privacy & Security → Automation.`;
  }
  return reason;
}

const failure = (toast: string): ActionResult => ({ toast, toastStyle: 'failure' });

/**
 * Runs the first of the programs that's installed. A program that runs and fails stops there,
 * unless it's marked to try the next one.
 */
async function runFirst(programs: Program[], exec: Exec): Promise<void> {
  let last: unknown;
  for (const [file, args, options] of programs) {
    try {
      await exec(file, args, 30_000);
      return;
    } catch (error) {
      if (!isMissing(error) && !options?.next) throw error;
      last = error;
    }
  }
  throw last ?? Object.assign(new Error('Not available on this system.'), { code: 'ENOENT' });
}

function confirmed(confirmation: Confirmation, perform: () => Promise<ActionResult>): CommandImplementation {
  return {
    view: () => confirmView(confirmation),
    async onAction(id) {
      if (id !== 'confirm') return { pop: true };
      return perform();
    },
  };
}

const WORDS: Record<Platform, { computer: string; trash: string }> = {
  darwin: { computer: 'Mac', trash: 'Trash' },
  win32: { computer: 'PC', trash: 'Recycle Bin' },
  linux: { computer: 'computer', trash: 'Trash' },
};

function formatBytes(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const DISK_KIND: Record<Disk['kind'], string> = {
  removable: 'Drive',
  image: 'Disk image',
  network: 'Network share',
  optical: 'Disc',
};

/** A disk as an action payload: plain JSON, without the fields it doesn't have. */
function payloadOf(disk: Disk): Json {
  return JSON.parse(JSON.stringify(disk)) as Json;
}

function isDisk(value: unknown): value is Disk {
  const disk = value as Disk | undefined;
  return typeof disk?.id === 'string' && typeof disk.name === 'string' && typeof disk.kind === 'string';
}

interface SystemOptions {
  platform?: Platform;
  exec?: Exec;
}

/** Lock, sleep, restart and the rest, plus disks and Wi-Fi. */
export function systemExtension({
  platform = process.platform as Platform,
  exec = defaultExec,
}: SystemOptions = {}): BuiltinExtension {
  const words = WORDS[platform] ?? WORDS.linux;

  const power = (action: PowerAction) => async (): Promise<ActionResult> => {
    try {
      await runFirst(powerPrograms(action, platform), exec);
      return { hide: true };
    } catch (error) {
      if (isMissing(error)) {
        const doing = { restart: 'restart', 'shut-down': 'shut down', 'log-out': 'log out' }[action];
        return failure(`Waypoint doesn't know how to ${doing} on this desktop yet.`);
      }
      return failure(explainFailure(error));
    }
  };
  // On a Linux desktop whose own way isn't known, systemd closes apps without asking.
  const askApps = asksAppsFirst(platform);
  const quitting = askApps ? 'Open apps are asked to quit first.' : 'Save your work first: open apps are closed.';

  const disksView = async (): Promise<View> => {
    let disks: Disk[];
    try {
      disks = await listDisks(platform, exec);
    } catch (error) {
      return {
        type: 'list',
        title: 'Eject Disks',
        sections: [],
        emptyText: `Couldn't list disks: ${reasonOf(error)}`,
      };
    }
    const items: ListItem[] = disks.map((disk) => {
      const size = formatBytes(disk.size);
      const free = formatBytes(disk.free);
      return {
        id: `disk:${disk.id}`,
        title: disk.name,
        subtitle: DISK_KIND[disk.kind],
        accessory: size ? (free ? `${free} free of ${size}` : size) : undefined,
        icon: { builtin: disk.kind === 'network' ? 'network' : 'eject', tint: 'gray' },
        actions: [
          { type: 'callback', id: 'eject', title: `Eject ${disk.name}`, payload: payloadOf(disk) },
          ...(disk.path ? [{ type: 'open-path' as const, path: disk.path, title: 'Open' }] : []),
          { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } },
        ],
      };
    });
    if (disks.length > 1) {
      items.unshift({
        id: 'eject-all',
        title: 'Eject All',
        subtitle: `${disks.length} disks`,
        icon: { builtin: 'eject', tint: 'blue' },
        actions: [{ type: 'callback', id: 'eject-all', title: 'Eject All', payload: disks.map(payloadOf) }],
      });
    }
    return {
      type: 'list',
      title: 'Eject Disks',
      searchPlaceholder: 'Search disks…',
      emptyText: 'Nothing to eject.',
      sections: [{ items }],
    };
  };

  const ejectAll = async (disks: Disk[]): Promise<ActionResult> => {
    const failed: string[] = [];
    for (const disk of disks) {
      try {
        await ejectDisk(disk, platform, exec);
      } catch (error) {
        failed.push(reasonOf(error));
      }
    }
    if (failed.length > 0) return { replace: await disksView(), ...failure(failed.join(' ')) };
    return {
      replace: await disksView(),
      toast: disks.length === 1 ? `Ejected ${disks[0]?.name}` : 'Ejected all disks',
    };
  };

  return {
    manifest: {
      name: 'system',
      title: 'System',
      icon: { builtin: 'power', tint: 'gray' },
      commands: [
        {
          name: 'lock-screen',
          title: 'Lock Screen',
          mode: 'no-view',
          icon: { builtin: 'lock', tint: 'gray' },
          keywords: ['away'],
        },
        {
          name: 'sleep',
          title: 'Sleep',
          mode: 'no-view',
          icon: { builtin: 'moon', tint: 'purple' },
          keywords: ['suspend'],
          platforms: ['darwin', 'linux'],
        },
        {
          name: 'restart',
          title: 'Restart',
          mode: 'view',
          icon: { builtin: 'restart', tint: 'orange' },
          keywords: ['reboot'],
        },
        {
          name: 'shut-down',
          title: 'Shut Down',
          mode: 'view',
          icon: { builtin: 'power', tint: 'red' },
          keywords: ['shutdown', 'power off', 'turn off'],
        },
        {
          name: 'log-out',
          title: 'Log Out',
          mode: 'view',
          icon: { builtin: 'log-out', tint: 'orange' },
          keywords: ['sign out', 'log off'],
        },
        {
          name: 'empty-trash',
          title: platform === 'win32' ? 'Empty Recycle Bin' : 'Empty Trash',
          mode: 'view',
          icon: { builtin: 'trash', tint: 'red' },
          keywords: ['trash', 'recycle bin', 'bin', 'delete'],
        },
        {
          name: 'eject',
          title: 'Eject Disks',
          mode: 'view',
          icon: { builtin: 'eject', tint: 'gray' },
          keywords: ['usb', 'drive', 'unmount', 'disk image', 'dmg', 'sd card'],
        },
        {
          name: 'toggle-wifi',
          title: 'Toggle Wi-Fi',
          mode: 'no-view',
          icon: { builtin: 'wifi', tint: 'blue' },
          keywords: ['wifi', 'wireless', 'turn wi-fi on', 'turn wi-fi off'],
        },
        {
          name: 'toggle-appearance',
          title: 'Toggle System Appearance',
          mode: 'no-view',
          icon: { builtin: 'moon', tint: 'gray' },
          keywords: ['dark mode', 'light mode', 'theme'],
          platforms: ['darwin'],
        },
      ],
    },
    commands: {
      'lock-screen': shellCommand({
        // Sends ⌃⌘Q; macOS asks once for permission to control System Events.
        darwin: osascript('tell application "System Events" to keystroke "q" using {control down, command down}'),
        win32: ['rundll32.exe', ['user32.dll,LockWorkStation']],
        linux: ['loginctl', ['lock-session']],
      }),
      sleep: shellCommand({
        darwin: ['pmset', ['sleepnow']],
        linux: ['systemctl', ['suspend']],
      }),
      restart: confirmed(
        {
          title: 'Restart',
          confirm: 'Restart Now',
          detail: `Restarts your ${words.computer}. ${quitting}`,
          icon: { builtin: 'restart', tint: 'orange' },
        },
        power('restart'),
      ),
      'shut-down': confirmed(
        {
          title: 'Shut Down',
          confirm: 'Shut Down Now',
          detail: `Turns off your ${words.computer}. ${quitting}`,
          icon: { builtin: 'power', tint: 'red' },
        },
        power('shut-down'),
      ),
      'log-out': confirmed(
        {
          title: 'Log Out',
          confirm: 'Log Out Now',
          detail: 'Ends your session. Open apps are asked to quit first.',
          icon: { builtin: 'log-out', tint: 'orange' },
        },
        power('log-out'),
      ),
      'empty-trash': confirmed(
        {
          title: `Empty ${words.trash}`,
          confirm: `Empty ${words.trash}`,
          detail: `Deletes everything in the ${words.trash} for good.`,
          icon: { builtin: 'trash', tint: 'red' },
        },
        async () => {
          try {
            const result = await emptyTrash(platform, exec);
            return {
              pop: true,
              toast: result === 'empty' ? `The ${words.trash} is already empty` : `Emptied the ${words.trash}`,
            };
          } catch (error) {
            if (/\(-128\)/.test(String(error))) return failure(`Emptying the ${words.trash} was cancelled.`);
            return failure(explainFailure(error, 'Finder'));
          }
        },
      ),
      eject: {
        view: disksView,
        async onAction(id, payload) {
          if (id === 'refresh') return { replace: await disksView() };
          if (id === 'eject-all' && Array.isArray(payload)) return ejectAll((payload as unknown[]).filter(isDisk));
          if (id === 'eject' && isDisk(payload)) return ejectAll([payload]);
          return undefined;
        },
      },
      'toggle-wifi': {
        async run() {
          try {
            const on = !(await wifiPower(platform, exec));
            await setWifiPower(on, platform, exec);
            return { toast: on ? 'Wi-Fi is on' : 'Wi-Fi is off' };
          } catch (error) {
            if (error instanceof WifiError) return failure(error.message);
            if (isMissing(error)) return failure('Install NetworkManager (nmcli) or rfkill to turn Wi-Fi on and off.');
            return failure(`Couldn't change Wi-Fi: ${reasonOf(error)}`);
          }
        },
      },
      'toggle-appearance': shellCommand({
        darwin: osascript(
          'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode',
        ),
      }),
    },
  };
}

/** The System commands for this computer. */
export const system = systemExtension();
