// Docker: your containers, running ones first, and your images. Start, stop and restart
// containers, open the ports they publish, copy their logs, and remove what you no longer
// need. Works with Docker Desktop, OrbStack, Colima and Rancher Desktop.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  findDocker,
  hubUrl,
  imageName,
  parseJsonLines,
  problemOf,
  sortContainers,
  toContainer,
  toImage,
} from './docker.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Action} Action */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./docker.js').Container} Container */
/** @typedef {import('./docker.js').Image} Image */

class DockerError extends Error {
  /**
   * @param {string} message
   * @param {'missing' | 'not-running' | 'failed'} kind
   */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Runs docker and returns what it printed.
 * @param {NodeJS.Platform} platform
 * @param {string[]} args
 * @param {number} [timeout]
 * @returns {Promise<string>}
 */
function docker(platform, args, timeout = 8000) {
  const file = findDocker(platform);
  if (!file) return Promise.reject(new DockerError("Docker isn't installed.", 'missing'));
  // Docker's helpers (credential stores, compose) sit next to it.
  const env = {
    ...process.env,
    PATH: [dirname(file), process.env.PATH].filter(Boolean).join(platform === 'win32' ? ';' : ':'),
  };
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const said = `${stderr}`.trim() || error.message;
      if (problemOf(said)) return reject(new DockerError("Docker isn't running.", 'not-running'));
      reject(
        new DockerError(said.split('\n')[0]?.replace(/^Error( response from daemon)?:\s*/i, '') || said, 'failed'),
      );
    });
  });
}

/**
 * The last lines a container logged, from both its output and its errors, roughly in order.
 * @param {NodeJS.Platform} platform
 * @param {string} id
 * @returns {Promise<string>}
 */
function logs(platform, id) {
  const file = findDocker(platform);
  if (!file) return Promise.reject(new DockerError("Docker isn't installed.", 'missing'));
  return new Promise((resolve, reject) => {
    const child = spawn(file, ['logs', '--tail', '200', id], { windowsHide: true });
    /** @type {Buffer[]} */
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill(), 6000);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) resolve(output);
      else
        reject(
          new DockerError(
            problemOf(output) ? "Docker isn't running." : output.trim() || 'docker logs failed',
            'failed',
          ),
        );
    });
  });
}

/**
 * The app that runs docker here, to offer opening it when docker isn't running.
 * @param {NodeJS.Platform} platform
 * @returns {{ name: string, path: string } | undefined}
 */
function dockerApp(platform) {
  if (platform === 'darwin') {
    for (const name of ['Docker', 'OrbStack', 'Rancher Desktop']) {
      for (const path of [join('/Applications', `${name}.app`), join(homedir(), 'Applications', `${name}.app`)]) {
        if (existsSync(path)) return { name: name === 'Docker' ? 'Docker Desktop' : name, path };
      }
    }
  }
  if (platform === 'win32') {
    const path = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
    if (existsSync(path)) return { name: 'Docker Desktop', path };
  }
  return undefined;
}

/**
 * The list to show when docker couldn't be asked.
 * @param {unknown} error
 * @param {Context} ctx
 * @param {string} title
 * @returns {ListView}
 */
function problemView(error, ctx, title) {
  const kind = error instanceof DockerError ? error.kind : 'failed';
  const app = kind === 'not-running' ? dockerApp(ctx.platform) : undefined;
  return {
    type: 'list',
    title,
    emptyText:
      kind === 'missing'
        ? "Docker isn't installed, or isn't where Waypoint looks for it."
        : kind === 'not-running'
          ? "Docker isn't running. Start it and try again."
          : `Couldn't ask Docker: ${error instanceof Error ? error.message : String(error)}`,
    sections: app
      ? [
          {
            items: [
              {
                id: 'start-docker',
                title: `Open ${app.name}`,
                subtitle: "Docker isn't running",
                icon: { path: app.path },
                actions: [
                  { type: 'open-path', path: app.path, title: `Open ${app.name}` },
                  { type: 'callback', id: 'refresh', title: 'Try Again', shortcut: { key: 'r', modifiers: ['mod'] } },
                ],
              },
            ],
          },
        ]
      : [],
  };
}

const REFRESH = /** @type {Action} */ ({
  type: 'callback',
  id: 'refresh',
  title: 'Refresh',
  shortcut: { key: 'r', modifiers: ['mod'] },
});

/** @param {string} state */
function tintOf(state) {
  if (state === 'running') return /** @type {const} */ ('green');
  if (state === 'paused' || state === 'restarting') return /** @type {const} */ ('yellow');
  if (state === 'dead') return /** @type {const} */ ('red');
  return /** @type {const} */ ('gray');
}

/**
 * @param {Container} container
 * @returns {ListItem}
 */
function containerItem(container) {
  const target = { id: container.id, name: container.name };
  const running = container.state === 'running' || container.state === 'restarting';
  /** @type {Action[]} */
  const actions = [];
  if (container.state === 'paused') {
    actions.push({ type: 'callback', id: 'unpause', title: 'Resume Container', payload: target });
  } else if (running) {
    actions.push({ type: 'callback', id: 'stop', title: 'Stop Container', payload: target });
  } else {
    actions.push({ type: 'callback', id: 'start', title: 'Start Container', payload: target });
  }
  if (running) {
    for (const port of container.ports.filter((p) => p.protocol === 'tcp')) {
      actions.push({ type: 'open-url', url: `http://localhost:${port.host}`, title: `Open localhost:${port.host}` });
    }
    actions.push({ type: 'callback', id: 'restart', title: 'Restart Container', payload: target });
  }
  actions.push({
    type: 'callback',
    id: 'logs',
    title: 'Copy Logs',
    payload: target,
    shortcut: { key: 'l', modifiers: ['mod'] },
  });
  if (running) actions.push({ type: 'copy', text: `docker exec -it ${container.name} sh`, title: 'Copy Exec Command' });
  actions.push(
    { type: 'copy', text: container.name, title: 'Copy Name', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    { type: 'copy', text: container.id, title: 'Copy Container ID' },
    REFRESH,
  );
  if (!running && container.state !== 'paused') {
    actions.push({
      type: 'callback',
      id: 'remove',
      title: 'Remove Container',
      payload: target,
      style: 'destructive',
      shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
    });
  }

  const ports = container.ports.map(
    (port) => `${port.host}→${port.container}${port.protocol === 'tcp' ? '' : `/${port.protocol}`}`,
  );
  return {
    id: container.id,
    title: container.name,
    subtitle: container.image,
    accessory: running && ports.length > 0 ? ports.join(', ') : container.status,
    icon: { builtin: 'server', tint: tintOf(container.state) },
    keywords: [container.image, container.id.slice(0, 12), ...(container.project ? [container.project] : [])],
    detail: {
      title: container.name,
      body: container.command ? `$ ${container.command}` : container.image,
      metadata: [
        { label: 'Status', value: container.status || container.state },
        { label: 'Image', value: container.image },
        ...(ports.length > 0 ? [{ label: 'Ports', value: ports.join(', ') }] : []),
        ...(container.project
          ? [
              {
                label: 'Compose project',
                value: container.service ? `${container.project} · ${container.service}` : container.project,
              },
            ]
          : []),
        { label: 'Created', value: container.created },
        { label: 'ID', value: container.id.slice(0, 12) },
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function containersView(ctx) {
  const title = 'Docker Containers';
  /** @type {Container[]} */
  let containers;
  try {
    const output = await docker(ctx.platform, ['ps', '-a', '--no-trunc', '--format', '{{json .}}']);
    containers = sortContainers(parseJsonLines(output).flatMap((row) => toContainer(row) ?? []));
  } catch (error) {
    return problemView(error, ctx, title);
  }
  const running = containers.filter((c) => c.state === 'running' || c.state === 'restarting' || c.state === 'paused');
  const stopped = containers.filter((c) => !running.includes(c));
  return {
    type: 'list',
    title,
    searchPlaceholder: 'Search containers by name, image or project…',
    emptyText: 'No containers yet. Start one with docker run or docker compose up.',
    sections: [
      { title: 'Running', items: running.map(containerItem) },
      { title: 'Stopped', items: stopped.map(containerItem) },
    ].filter((section) => section.items.length > 0),
  };
}

/**
 * @param {Image} image
 * @returns {ListItem}
 */
function imageItem(image) {
  const name = imageName(image);
  const page = hubUrl(image.repository);
  const dangling = image.repository === '<none>';
  /** @type {Action[]} */
  const actions = [
    { type: 'copy', text: dangling ? image.id : name, title: dangling ? 'Copy Image ID' : 'Copy Name' },
    ...(dangling
      ? []
      : [/** @type {Action} */ ({ type: 'copy', text: `docker run --rm -it ${name}`, title: 'Copy Run Command' })]),
    ...(page ? [/** @type {Action} */ ({ type: 'open-url', url: page, title: 'Open on Docker Hub' })] : []),
    ...(dangling ? [] : [/** @type {Action} */ ({ type: 'copy', text: image.id, title: 'Copy Image ID' })]),
    REFRESH,
    {
      type: 'callback',
      id: 'remove-image',
      title: 'Remove Image',
      payload: { id: image.id, name },
      style: 'destructive',
      shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
    },
  ];
  return {
    id: `${image.id}:${name}`,
    title: dangling ? 'Untagged image' : image.repository,
    subtitle: dangling ? image.id.slice(0, 12) : image.tag,
    accessory: image.size,
    icon: { builtin: 'app', tint: dangling ? 'gray' : 'blue' },
    keywords: [name, image.id.slice(0, 12)],
    detail: {
      title: name,
      body: dangling ? 'An image with no name, usually left behind by a rebuild.' : name,
      metadata: [
        { label: 'Size', value: image.size },
        { label: 'Created', value: image.created },
        { label: 'ID', value: image.id.slice(0, 12) },
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function imagesView(ctx) {
  const title = 'Docker Images';
  /** @type {Image[]} */
  let images;
  try {
    const output = await docker(ctx.platform, ['images', '--no-trunc', '--format', '{{json .}}']);
    images = parseJsonLines(output).flatMap((row) => toImage(row) ?? []);
  } catch (error) {
    return problemView(error, ctx, title);
  }
  return {
    type: 'list',
    title,
    searchPlaceholder: 'Search images…',
    emptyText: 'No images yet. Get one with docker pull.',
    sections: [{ items: images.map(imageItem) }],
  };
}

/**
 * @param {unknown} payload
 * @returns {{ id: string, name: string } | undefined}
 */
function targetOf(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const { id, name } = /** @type {Record<string, unknown>} */ (payload);
  return typeof id === 'string' && /^[0-9a-f]{12,64}$/.test(id) && typeof name === 'string' ? { id, name } : undefined;
}

/** @param {unknown} error */
function failure(error) {
  return /** @type {ActionResult} */ ({
    toast: error instanceof Error ? error.message : String(error),
    toastStyle: 'failure',
  });
}

/** @type {Record<string, { args: (id: string) => string[], done: string, failed: string }>} */
const CONTAINER_ACTIONS = {
  start: { args: (id) => ['start', id], done: 'Started', failed: "Couldn't start" },
  stop: { args: (id) => ['stop', '-t', '4', id], done: 'Stopped', failed: "Couldn't stop" },
  restart: { args: (id) => ['restart', '-t', '4', id], done: 'Restarted', failed: "Couldn't restart" },
  unpause: { args: (id) => ['unpause', id], done: 'Resumed', failed: "Couldn't resume" },
  remove: { args: (id) => ['rm', id], done: 'Removed', failed: "Couldn't remove" },
};

/** @type {Extension} */
export default {
  commands: {
    containers: {
      view: containersView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') return { replace: await containersView(ctx) };
        const target = targetOf(payload);
        if (!target) return undefined;
        if (id === 'logs') {
          try {
            const text = await logs(ctx.platform, target.id);
            return text.trim()
              ? { copy: text, toast: `Copied ${target.name}'s logs` }
              : { toast: `${target.name} hasn't logged anything.` };
          } catch (error) {
            return failure(error);
          }
        }
        const action = CONTAINER_ACTIONS[id];
        if (!action) return undefined;
        try {
          await docker(ctx.platform, action.args(target.id), 9000);
        } catch (error) {
          return {
            ...failure(error),
            toast: `${action.failed} ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        return { replace: await containersView(ctx), toast: `${action.done} ${target.name}` };
      },
    },
    images: {
      view: imagesView,
      async onAction(id, payload, ctx) {
        if (id === 'refresh') return { replace: await imagesView(ctx) };
        const target = targetOf(payload);
        if (id !== 'remove-image' || !target) return undefined;
        // By name, so an image with several tags only loses this one.
        const ref = /^\w[\w.\-/:@]*$/.test(target.name) ? target.name : target.id;
        try {
          await docker(ctx.platform, ['rmi', ref]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            toast: /being used|conflict/i.test(message)
              ? `${target.name} is used by a container. Remove the container first.`
              : `Couldn't remove ${target.name}: ${message}`,
            toastStyle: 'failure',
          };
        }
        return { replace: await imagesView(ctx), toast: `Removed ${target.name}` };
      },
    },
  },
};
