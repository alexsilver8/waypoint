// System Info: battery, CPU, memory, disk space, your IP addresses and the system itself, in one
// list. ↵ copies a value; ⌘↵ opens the system's own app or settings for it. The public IP is
// looked up at api.ipify.org when the list opens.
import { execFile } from 'node:child_process';
import { readdir, readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import {
  cpuUsage,
  formatBytes,
  formatMinutes,
  formatUptime,
  linuxBattery,
  linuxMemory,
  linuxName,
  localAddresses,
  macMemoryUsed,
  macOSName,
  parseHardwarePorts,
  parsePmset,
  parseWindowsBattery,
  windowsName,
} from './info.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('@waypoint-org/api').Tint} Tint */
/** @typedef {import('./info.js').Battery} Battery */
/** @typedef {Context['platform']} Platform */

/**
 * @param {string} file
 * @param {string[]} args
 * @param {number} [timeout]
 * @returns {Promise<string>}
 */
function run(file, args, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** How long CPU use is measured over. */
const CPU_SAMPLE_MS = 400;
const PUBLIC_IP_URL = 'https://api.ipify.org?format=json';

// ── Reading ──────────────────────────────────────────────────────────────────

/** @param {Platform} platform @returns {Promise<Battery | undefined>} */
async function battery(platform) {
  if (platform === 'darwin') return parsePmset(await run('pmset', ['-g', 'batt']));
  if (platform === 'win32') {
    return parseWindowsBattery(
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json -Compress',
        ],
        8000,
      ),
    );
  }
  const root = '/sys/class/power_supply';
  for (const name of await readdir(root).catch(() => /** @type {string[]} */ ([]))) {
    /** @param {string} file */
    const read = (file) =>
      readFile(join(root, name, file), 'utf8')
        .then((text) => text.trim())
        .catch(() => undefined);
    if ((await read('type')) !== 'Battery' || (await read('scope')) === 'Device') continue;
    const files = [
      'capacity',
      'status',
      'energy_now',
      'energy_full',
      'power_now',
      'charge_now',
      'charge_full',
      'current_now',
    ];
    const values = await Promise.all(files.map(read));
    return linuxBattery(Object.fromEntries(files.map((file, i) => [file, values[i]])));
  }
  return undefined;
}

/** @returns {Promise<number>} From 0 to 1. */
async function cpu() {
  const before = os.cpus();
  await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_MS));
  return cpuUsage(before, os.cpus());
}

/** @param {Platform} platform @returns {Promise<{ total: number, used: number }>} */
async function memory(platform) {
  const total = os.totalmem();
  if (platform === 'darwin') {
    const used = macMemoryUsed(await run('vm_stat', []).catch(() => ''));
    if (used !== undefined) return { total, used: Math.min(used, total) };
  }
  if (platform === 'linux') {
    const fromProc = linuxMemory(await readFile('/proc/meminfo', 'utf8').catch(() => ''));
    if (fromProc) return fromProc;
  }
  return { total, used: total - os.freemem() };
}

/** The disk your home folder is on. @returns {Promise<{ total: number, free: number }>} */
async function disk() {
  const stats = await statfs(os.homedir());
  return { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
}

/** @param {Platform} platform */
async function systemName(platform) {
  if (platform === 'darwin') return macOSName(await run('sw_vers', ['-productVersion']).catch(() => os.release()));
  if (platform === 'win32') return windowsName(os.version(), os.release());
  return linuxName(await readFile('/etc/os-release', 'utf8').catch(() => ''));
}

/** @param {Platform} platform */
async function interfaceNames(platform) {
  if (platform !== 'darwin') return {};
  return parseHardwarePorts(await run('networksetup', ['-listallhardwareports']).catch(() => ''));
}

/** @returns {Promise<string>} */
async function publicIp() {
  const response = await fetch(PUBLIC_IP_URL, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`api.ipify.org answered ${response.status}`);
  const { ip } = /** @type {{ ip?: unknown }} */ (await response.json());
  if (typeof ip !== 'string' || !/^[0-9a-f.:]+$/i.test(ip)) throw new Error('api.ipify.org sent something unexpected');
  return ip;
}

/**
 * Waits for every reading, keeping the ones that worked.
 * @template T
 * @param {Promise<T>} promise
 * @returns {Promise<{ value?: T, error?: string }>}
 */
async function settle(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Showing ──────────────────────────────────────────────────────────────────

/** Where each system keeps its own view of these things. */
/** @type {Record<Platform, Partial<Record<'activity' | 'battery' | 'storage' | 'network', Action>>>} */
const OPEN = {
  darwin: {
    activity: {
      type: 'open-path',
      path: '/System/Applications/Utilities/Activity Monitor.app',
      title: 'Open Activity Monitor',
    },
    battery: {
      type: 'open-url',
      url: 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
      title: 'Open Battery Settings',
    },
    storage: {
      type: 'open-url',
      url: 'x-apple.systempreferences:com.apple.settings.Storage',
      title: 'Open Storage Settings',
    },
    network: {
      type: 'open-url',
      url: 'x-apple.systempreferences:com.apple.Network-Settings.extension',
      title: 'Open Network Settings',
    },
  },
  win32: {
    activity: {
      type: 'open-path',
      path: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'Taskmgr.exe'),
      title: 'Open Task Manager',
    },
    battery: { type: 'open-url', url: 'ms-settings:batterysaver', title: 'Open Battery Settings' },
    storage: { type: 'open-url', url: 'ms-settings:storagesense', title: 'Open Storage Settings' },
    network: { type: 'open-url', url: 'ms-settings:network-status', title: 'Open Network Settings' },
  },
  linux: {},
};

/** @type {Action} */
const REFRESH = { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } };

/**
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.title
 * @param {string} options.value What's shown, and copied with ↵.
 * @param {ListItem['icon']} options.icon
 * @param {string} [options.accessory]
 * @param {Array<{ label: string, value: string }>} [options.metadata]
 * @param {Action} [options.open]
 * @param {string[]} [options.keywords]
 * @returns {ListItem}
 */
function item({ id, title, value, icon, accessory, metadata = [], open, keywords }) {
  return {
    id,
    title,
    subtitle: value,
    accessory,
    icon,
    keywords,
    detail: { title, body: value, metadata },
    actions: [{ type: 'copy', text: value, title: `Copy ${title}` }, ...(open ? [open] : []), REFRESH],
  };
}

/** @param {number} share @returns {Tint} */
function loadTint(share) {
  return share >= 0.9 ? 'red' : share >= 0.7 ? 'orange' : 'green';
}

/** @param {number} share */
const percent = (share) => `${Math.round(share * 100)}%`;

/** @type {Record<Battery['state'], string>} */
const BATTERY_STATE = {
  charging: 'Charging',
  discharging: 'On battery',
  charged: 'Charged',
  'not-charging': 'Plugged in, not charging',
};

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function infoView(ctx) {
  const platform = ctx.platform;
  const open = OPEN[platform] ?? {};
  const [power, load, mem, space, name, names, ip] = await Promise.all([
    settle(battery(platform)),
    settle(cpu()),
    settle(memory(platform)),
    settle(disk()),
    settle(systemName(platform)),
    settle(interfaceNames(platform)),
    settle(publicIp()),
  ]);

  /** @type {ListItem[]} */
  const hardware = [];
  if (power.value) {
    const b = power.value;
    const left = b.minutesLeft
      ? `${formatMinutes(b.minutesLeft)} ${b.state === 'charging' ? 'until full' : 'left'}`
      : undefined;
    hardware.push(
      item({
        id: 'battery',
        title: 'Battery',
        value: `${b.percent}% · ${BATTERY_STATE[b.state]}`,
        accessory: left,
        icon: { builtin: 'battery', tint: b.percent <= 10 ? 'red' : b.percent <= 25 ? 'orange' : 'green' },
        metadata: [
          { label: 'Charge', value: `${b.percent}%` },
          { label: 'State', value: BATTERY_STATE[b.state] },
          ...(left
            ? [{ label: b.state === 'charging' ? 'Until full' : 'Time left', value: formatMinutes(b.minutesLeft ?? 0) }]
            : []),
        ],
        open: open.battery,
        keywords: ['power', 'charge'],
      }),
    );
  }
  if (load.value !== undefined) {
    const cpus = os.cpus();
    const model = cpus[0]?.model.trim();
    const average =
      platform === 'win32'
        ? undefined
        : os
            .loadavg()
            .map((n) => n.toFixed(2))
            .join(', ');
    hardware.push(
      item({
        id: 'cpu',
        title: 'CPU',
        value: `${percent(load.value)} in use`,
        accessory: `${cpus.length} cores`,
        icon: { builtin: 'cpu', tint: loadTint(load.value) },
        metadata: [
          ...(model ? [{ label: 'Processor', value: model }] : []),
          { label: 'Cores', value: String(cpus.length) },
          ...(average ? [{ label: 'Load average', value: average }] : []),
        ],
        open: open.activity,
        keywords: ['processor', 'load', 'usage'],
      }),
    );
  }
  if (mem.value) {
    const { total, used } = mem.value;
    hardware.push(
      item({
        id: 'memory',
        title: 'Memory',
        value: `${formatBytes(used)} of ${formatBytes(total)} used`,
        accessory: percent(used / total),
        icon: { builtin: 'memory', tint: loadTint(used / total) },
        metadata: [
          { label: 'Used', value: formatBytes(used) },
          { label: 'Available', value: formatBytes(total - used) },
          { label: 'Total', value: formatBytes(total) },
        ],
        open: open.activity,
        keywords: ['ram'],
      }),
    );
  }
  if (space.value) {
    const { total, free } = space.value;
    hardware.push(
      item({
        id: 'disk',
        title: 'Disk',
        value: `${formatBytes(free)} free of ${formatBytes(total)}`,
        accessory: `${percent((total - free) / total)} used`,
        icon: { builtin: 'hard-drive', tint: loadTint((total - free) / total) },
        metadata: [
          { label: 'Free', value: formatBytes(free) },
          { label: 'Used', value: formatBytes(total - free) },
          { label: 'Total', value: formatBytes(total) },
        ],
        open: open.storage,
        keywords: ['storage', 'space', 'ssd'],
      }),
    );
  }

  /** @type {ListItem[]} */
  const network = localAddresses(os.networkInterfaces(), names.value).map((address) =>
    item({
      id: `ip:${address.device}:${address.address}`,
      title: `${address.name} ${address.family === 'IPv4' ? 'IP' : 'IPv6'}`,
      value: address.address,
      accessory: 'Local',
      icon: { builtin: address.name === 'Wi-Fi' ? 'wifi' : 'network', tint: 'blue' },
      metadata: [
        { label: 'Interface', value: address.device },
        { label: 'Family', value: address.family },
      ],
      open: open.network,
      keywords: ['ip address', 'local ip', 'lan'],
    }),
  );
  network.push(
    ip.value
      ? item({
          id: 'public-ip',
          title: 'Public IP',
          value: ip.value,
          accessory: 'Internet',
          icon: { builtin: 'globe', tint: 'blue' },
          metadata: [{ label: 'Looked up at', value: 'api.ipify.org' }],
          keywords: ['ip address', 'external ip', 'wan'],
        })
      : {
          id: 'public-ip',
          title: 'Public IP',
          subtitle: "Couldn't reach api.ipify.org",
          icon: { builtin: 'globe', tint: 'gray' },
          keywords: ['ip address', 'external ip', 'wan'],
          actions: [REFRESH],
        },
  );

  /** @type {ListItem[]} */
  const system = [
    ...(name.value
      ? [
          item({
            id: 'os',
            title: 'System',
            value: name.value,
            icon: { builtin: 'info', tint: 'gray' },
            metadata: [
              { label: 'Kernel', value: `${os.type()} ${os.release()}` },
              { label: 'Architecture', value: os.arch() },
            ],
            keywords: ['os', 'version', 'macos', 'windows', 'linux'],
          }),
        ]
      : []),
    item({
      id: 'uptime',
      title: 'Uptime',
      value: formatUptime(os.uptime()),
      icon: { builtin: 'power', tint: 'gray' },
      metadata: [{ label: 'Started', value: new Date(Date.now() - os.uptime() * 1000).toLocaleString() }],
      keywords: ['boot', 'restart'],
    }),
    item({
      id: 'hostname',
      title: 'Computer Name',
      value: os.hostname(),
      icon: { builtin: 'monitor', tint: 'gray' },
      keywords: ['hostname', 'name'],
    }),
  ];

  return {
    type: 'list',
    title: 'System Info',
    searchPlaceholder: 'Search battery, memory, IP…',
    sections: [
      { title: 'Hardware', items: hardware },
      { title: 'Network', items: network },
      { title: 'System', items: system },
    ].filter((section) => section.items.length > 0),
  };
}

/** @type {Extension} */
export default {
  commands: {
    info: {
      view: infoView,
      async onAction(id, _payload, ctx) {
        if (id === 'refresh') return { replace: await infoView(ctx) };
        return undefined;
      },
    },
  },
};
