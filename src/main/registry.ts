import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { commandItemId, commandKey } from '../shared/command-hotkeys';
import type { HostExtension } from '../shared/extension-protocol';
import type {
  Action,
  ActionContext,
  ActionResult,
  CommandContext,
  CommandImplementation,
  CommandManifest,
  CommandRef,
  ExtensionManifest,
  ExtensionSource,
  Icon,
  Platform,
  RootItem,
  View,
} from '../shared/types';
import { ActionError, performSystemAction } from './actions';
import type { AppIndex } from './apps/app-index';
import type { BuiltinExtension } from './commands/types';
import { discoverExtensions } from './extensions/discovery';
import type { ExtensionHostClient } from './extensions/host-client';
import { sanitizeActionResult, sanitizeView } from './extensions/validate';
import type { UsageTracker } from './usage';

export interface ExtensionInfo {
  manifest?: ExtensionManifest;
  source: ExtensionSource;
  /** Folder of an extension that isn't compiled in. */
  dir?: string;
  /** Why an extension failed to load. */
  error?: string;
}

interface RegisteredExtension {
  manifest: ExtensionManifest;
  source: ExtensionSource;
  dir?: string;
  /** Only for built-ins; the others run in the extension host. */
  commands?: Record<string, CommandImplementation>;
  /** Built-in commands left out of the root search; see `BuiltinExtension.unlisted`. */
  unlisted?: ReadonlySet<string>;
}

export interface RegistryOptions {
  platform: Platform;
  builtins: BuiltinExtension[];
  host: ExtensionHostClient;
  apps: AppIndex;
  usage: UsageTracker;
  /** Folders to load user extensions from. */
  extensionRoots: () => string[];
  /** Folders of the extensions shipped with the app. */
  bundledRoots?: () => string[];
  /** Where extensions get their own writable folder. */
  supportRoot: string;
  /** More things the root search finds, like notes and clipboard entries. */
  rootSources?: Array<() => RootItem[] | Promise<RootItem[]>>;
  /** The global shortcut that runs a command, by `"<extension>/<command>"`, shown beside it. */
  commandHotkey?: (key: string) => string | undefined;
  /** The alias that finds a command first, by `"<extension>/<command>"`, shown beside it. */
  commandAlias?: (key: string) => string | undefined;
}

/** A command that's available on this computer. */
export interface CommandInfo {
  ref: CommandRef;
  manifest: CommandManifest;
  /** The command's icon, or its extension's. */
  icon?: Icon;
  extension: { name: string; title: string; source: ExtensionSource };
}

/** Opens Settings at a command's shortcut; its argument is the command's key. */
const SET_SHORTCUT_REF: CommandRef = { extension: 'waypoint', command: 'settings' };
/** Opens Settings at a command's alias; its argument is the command's key. */
const SET_ALIAS_REF: CommandRef = { extension: 'waypoint', command: 'alias' };

const REVEAL_LABEL: Record<Platform, string> = {
  darwin: 'Show in Finder',
  win32: 'Show in File Explorer',
  linux: 'Show in Folder',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Knows every command (built-in and from extensions) and every application, builds the
 * root search list, and routes actions to whoever handles them.
 */
export class CommandRegistry extends EventEmitter<{ change: [] }> {
  private readonly extensions = new Map<string, RegisteredExtension>();
  private failures: ExtensionInfo[] = [];
  private reloading: Promise<unknown> = Promise.resolve();
  private markLoaded: () => void = () => {};
  /** Settles once user extensions have been loaded the first time. */
  readonly firstLoad = new Promise<void>((resolve) => {
    this.markLoaded = resolve;
  });

  constructor(private readonly options: RegistryOptions) {
    super();
    for (const builtin of options.builtins) {
      this.extensions.set(builtin.manifest.name, {
        manifest: builtin.manifest,
        source: 'builtin',
        commands: builtin.commands,
        ...(builtin.unlisted ? { unlisted: new Set(builtin.unlisted) } : {}),
      });
    }
    options.apps.on('change', () => this.emit('change'));
  }

  /**
   * (Re)discovers user extensions and loads them into a fresh extension host. Calls are
   * queued, so reloads triggered close together never interleave.
   */
  loadUserExtensions(): Promise<{ loaded: number; failed: number }> {
    const run = this.reloading.then(() => this.reloadNow());
    this.reloading = run.catch(() => undefined);
    return run;
  }

  private async reloadNow(): Promise<{ loaded: number; failed: number }> {
    const builtinNames = new Set(
      [...this.extensions.values()].filter((e) => e.source === 'builtin').map((e) => e.manifest.name),
    );
    const failures: ExtensionInfo[] = [];
    const toLoad: Array<{ host: HostExtension; manifest: ExtensionManifest; source: ExtensionSource }> = [];
    // The ones shipped with the app first, so their names win over a copy in your folder.
    const discovered = [
      ...discoverExtensions(this.options.bundledRoots?.() ?? []).map((found) => ({
        ...found,
        source: 'bundled' as const,
      })),
      ...discoverExtensions(this.options.extensionRoots()).map((found) => ({ ...found, source: 'user' as const })),
    ];

    for (const found of discovered) {
      const { source } = found;
      if (!found.parsed) {
        failures.push({ source, dir: found.dir, error: found.error });
        continue;
      }
      const { manifest, entry } = found.parsed;
      if (builtinNames.has(manifest.name) || toLoad.some((e) => e.manifest.name === manifest.name)) {
        failures.push({
          manifest,
          source,
          dir: found.dir,
          error: `Another extension is already called "${manifest.name}".`,
        });
        continue;
      }
      toLoad.push({
        manifest,
        source,
        host: {
          name: manifest.name,
          entry,
          dir: found.dir,
          supportPath: join(this.options.supportRoot, manifest.name),
        },
      });
    }

    const report = await this.options.host.load(toLoad.map((e) => e.host)).catch((error: unknown) => ({
      loaded: [] as string[],
      failed: toLoad.map((e) => ({ name: e.manifest.name, error: errorMessage(error) })),
    }));

    // Swap the new set in all at once.
    for (const [name, extension] of this.extensions) {
      if (extension.source !== 'builtin') this.extensions.delete(name);
    }
    for (const { manifest, host, source } of toLoad) {
      const failure = report.failed.find((f) => f.name === manifest.name);
      if (failure) failures.push({ manifest, source, dir: host.dir, error: failure.error });
      else this.extensions.set(manifest.name, { manifest, source, dir: host.dir });
    }
    this.failures = failures;
    for (const failure of failures) {
      console.warn(`[extensions] ${failure.manifest?.name ?? failure.dir}: ${failure.error}`);
    }
    this.emit('change');
    this.markLoaded();
    return { loaded: report.loaded.length, failed: failures.length };
  }

  /** Every command you can run yourself on this platform (not the unlisted ones), built-in or from an extension. */
  listCommands(): CommandInfo[] {
    const commands: CommandInfo[] = [];
    for (const { manifest, source, unlisted } of this.extensions.values()) {
      for (const command of manifest.commands) {
        if (command.platforms && !command.platforms.includes(this.options.platform)) continue;
        if (unlisted?.has(command.name)) continue;
        const icon = command.icon ?? manifest.icon;
        commands.push({
          ref: { extension: manifest.name, command: command.name },
          manifest: command,
          ...(icon ? { icon } : {}),
          extension: { name: manifest.name, title: manifest.title, source },
        });
      }
    }
    return commands;
  }

  /** The command `ref` names, if it's available on this platform. */
  findCommand(ref: CommandRef): CommandInfo | undefined {
    return this.listCommands().find((c) => c.ref.extension === ref.extension && c.ref.command === ref.command);
  }

  /** Every extension, with the commands you can run yourself (not the unlisted ones). */
  listExtensions(): ExtensionInfo[] {
    const loaded = [...this.extensions.values()].map(({ manifest, source, dir, unlisted }) => ({
      manifest: unlisted
        ? { ...manifest, commands: manifest.commands.filter((command) => !unlisted.has(command.name)) }
        : manifest,
      source,
      dir,
    }));
    return [...loaded, ...this.failures];
  }

  /** Commands, apps and whatever the root sources add. A failing source is left out, not fatal. */
  async getRootItems(): Promise<RootItem[]> {
    const extra = await Promise.all(
      (this.options.rootSources ?? []).map(async (source) => {
        try {
          return await source();
        } catch (error) {
          console.error('[root search] A source failed:', error);
          return [];
        }
      }),
    );
    return [...this.commandAndAppItems(), ...extra.flat()];
  }

  private commandAndAppItems(): RootItem[] {
    const { platform, usage, apps } = this.options;
    const items: RootItem[] = [];

    for (const extension of this.extensions.values()) {
      for (const command of extension.manifest.commands) {
        if (command.platforms && !command.platforms.includes(platform)) continue;
        if (extension.unlisted?.has(command.name)) continue;
        const ref = { extension: extension.manifest.name, command: command.name };
        const id = commandItemId(ref);
        const hotkey = this.options.commandHotkey?.(commandKey(ref));
        const alias = this.options.commandAlias?.(commandKey(ref));
        const item: RootItem = {
          id,
          kind: 'command',
          title: command.title,
          subtitle: command.subtitle ?? extension.manifest.title,
          accessory: 'Command',
          frecency: usage.score(id),
          actions: [
            { type: 'open-command', ref, title: command.mode === 'view' ? 'Open Command' : 'Run Command' },
            {
              type: 'open-command',
              ref: SET_SHORTCUT_REF,
              argument: commandKey(ref),
              title: hotkey ? 'Change Shortcut…' : 'Set Shortcut…',
              // Not ⌘↵, which did nothing on a command, and not a use of the command.
              panelOnly: true,
            },
            {
              type: 'open-command',
              ref: SET_ALIAS_REF,
              argument: commandKey(ref),
              title: alias ? 'Change Alias…' : 'Set Alias…',
              panelOnly: true,
            },
          ],
        };
        if (hotkey) item.hotkey = hotkey;
        if (alias) item.alias = alias;
        const icon = command.icon ?? extension.manifest.icon;
        if (icon) item.icon = icon;
        if (command.keywords) item.keywords = command.keywords;
        if (command.fallback) item.fallback = ref;
        item.extension = { name: extension.manifest.name, title: extension.manifest.title, source: extension.source };
        items.push(item);
      }
    }

    for (const app of apps.list()) {
      const id = `app:${app.path}`;
      const item: RootItem = {
        id,
        kind: 'application',
        title: app.name,
        icon: { path: app.iconPath ?? app.path },
        accessory: 'Application',
        frecency: usage.score(id),
        actions: [
          { type: 'open-path', path: app.path, title: 'Open Application' },
          { type: 'reveal-path', path: app.path, title: REVEAL_LABEL[platform] },
          { type: 'copy', text: app.path, title: 'Copy Path' },
        ],
      };
      if (app.keywords) item.keywords = app.keywords;
      items.push(item);
    }
    return items;
  }

  /** Performs an action from the launcher. Failures come back as a toast, never as a throw. */
  async runAction(action: Action, context: ActionContext): Promise<ActionResult> {
    // Changing something about an item, like its shortcut, isn't using it.
    if (context.rootItemId && !action.panelOnly) this.options.usage.record(context.rootItemId);
    const ctx: CommandContext = { query: context.query ?? '', platform: this.options.platform };
    try {
      switch (action.type) {
        case 'open-command':
          return await this.openCommand(action.ref, { ...ctx, query: '', argument: action.argument });
        case 'callback': {
          if (!context.ref) throw new ActionError('This action does not belong to a command.');
          const result = await this.invoke(context.ref, 'action', ctx, action.id, action.payload);
          return (result as ActionResult | undefined) ?? {};
        }
        default:
          return await performSystemAction(action);
      }
    } catch (error) {
      console.error('[actions]', error);
      return { toast: errorMessage(error), toastStyle: 'failure' };
    }
  }

  /** Renders a `filtering: false` view again for a new query. */
  async searchView(ref: CommandRef, query: string): Promise<View> {
    return (await this.invoke(ref, 'view', { query, platform: this.options.platform })) as View;
  }

  private async openCommand(ref: CommandRef, ctx: CommandContext): Promise<ActionResult> {
    const { command } = this.lookup(ref);
    if (command.mode === 'view') {
      return { push: (await this.invoke(ref, 'view', ctx)) as View };
    }
    const result = (await this.invoke(ref, 'run', ctx)) as ActionResult | undefined;
    return result ?? { hide: true };
  }

  private lookup(ref: CommandRef): { extension: RegisteredExtension; command: CommandManifest } {
    const extension = this.extensions.get(ref.extension);
    const command = extension?.manifest.commands.find((c) => c.name === ref.command);
    if (!extension || !command) throw new ActionError(`Unknown command ${ref.extension}/${ref.command}.`);
    return { extension, command };
  }

  /**
   * Calls a command method in-process for built-ins or through the extension host, and
   * validates what comes back from third-party code.
   */
  private async invoke(
    ref: CommandRef,
    method: 'view' | 'run' | 'action',
    ctx: CommandContext,
    actionId?: string,
    payload?: unknown,
  ): Promise<View | ActionResult | undefined> {
    const { extension } = this.lookup(ref);

    if (extension.commands) {
      const implementation = extension.commands[ref.command];
      if (!implementation) throw new ActionError(`${ref.extension}/${ref.command} is not implemented.`);
      if (method === 'view') {
        if (!implementation.view) throw new ActionError('This command has no view.');
        return implementation.view(ctx);
      }
      if (method === 'run') return (await implementation.run?.(ctx)) ?? undefined;
      return (await implementation.onAction?.(actionId ?? '', payload as never, ctx)) ?? undefined;
    }

    const call = { extension: ref.extension, command: ref.command, ctx };
    const raw =
      method === 'action'
        ? await this.options.host.call('action', { ...call, actionId: actionId ?? '', payload: payload as never })
        : await this.options.host.call(method, call);
    return method === 'view' ? sanitizeView(raw, extension.dir) : sanitizeActionResult(raw, extension.dir);
  }
}
