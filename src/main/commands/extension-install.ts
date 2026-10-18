/**
 * Installing, updating and uninstalling other people's extensions from the launcher: **Install
 * Extension** asks for an npm package or a git address, and both it and **Manage Extensions** show
 * what's about to be installed, and from where, before anything is.
 */
import type {
  Action,
  ActionResult,
  CommandImplementation,
  CommandRef,
  FormView,
  Json,
  ListItem,
  View,
} from '../../shared/types';
import { describeSource, parseInstallSpec, updateSource } from '../extensions/install-spec';
import type { ExtensionInstaller, InstalledExtension, PreparedInstall } from '../extensions/installer';
import type { CommandRegistry } from '../registry';
import { confirmView } from './confirm';

/** **Install Extension**, which Manage Extensions and Settings open too. */
export const INSTALL_COMMAND: CommandRef = { extension: 'waypoint', command: 'install-extension' };

export interface ExtensionInstallOptions {
  installer: ExtensionInstaller;
  registry: () => CommandRegistry;
}

const failure = (error: unknown): ActionResult => ({
  toast: error instanceof Error ? error.message : String(error),
  toastStyle: 'failure',
});

const NOT_INSTALLED: ActionResult = { toast: 'It wasn’t installed from npm or git.', toastStyle: 'failure' };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A field of a callback's payload, or a form's values, if it's a string. */
function payloadField(payload: Json | undefined, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

export function installForm(source = ''): FormView {
  return {
    type: 'form',
    title: 'Install Extension',
    fields: [
      {
        type: 'text',
        id: 'source',
        title: 'Package or address',
        placeholder: 'emoji, emoji@1.2.0, owner/repo or https://…',
        required: true,
        ...(source ? { defaultValue: source } : {}),
      },
      {
        type: 'description',
        text: 'An npm package, a GitHub repository or a folder in one, or any git repository. You’ll see what it is and where it comes from before anything is installed.',
      },
    ],
    submit: { id: 'check', title: 'Continue' },
  };
}

/** The version, or else the commit, it's at. */
function versionOf({ version, commit }: { version?: string; commit?: string }): string | undefined {
  return version ?? commit?.slice(0, 7);
}

/** Shows what's about to be installed, and from where, to be confirmed. */
export function confirmInstall(prepared: PreparedInstall): View {
  const { manifest, replaces, source } = prepared;
  const version = versionOf(prepared);
  const verb = replaces ? 'Update' : 'Install';
  const from = describeSource(source);
  const body = [
    ...(manifest.description ? [manifest.description, ''] : []),
    ...(prepared.deprecated ? [`Its author marked this version deprecated: ${prepared.deprecated}`, ''] : []),
    '# It runs with your access',
    'An extension can do anything you can on this computer: open and change your files, run programs and go online. Install one only if you trust where it comes from.',
    '',
    `# ${plural(manifest.commands.length, 'command')}`,
    ...manifest.commands.map((command) => `- ${command.title}`),
  ];
  const metadata = [
    { label: 'Name', value: manifest.name },
    ...(version ? [{ label: 'Version', value: version }] : []),
    ...(replaces ? [{ label: 'Replaces', value: versionOf(replaces) ?? 'the installed copy' }] : []),
    { label: 'From', value: from },
    { label: 'Downloaded from', value: prepared.from },
    ...(prepared.commit ? [{ label: 'Commit', value: prepared.commit }] : []),
  ];
  return confirmView({
    title: `${verb} ${manifest.title}`,
    confirm: `${verb} ${manifest.title}`,
    detail: version ? `${version}, from ${from}` : `From ${from}`,
    icon: manifest.icon ?? { builtin: 'extension', tint: 'purple' },
    preview: { title: manifest.title, body: body.join('\n'), metadata },
    payload: { install: prepared.id, verb: replaces ? 'update' : 'install' },
  });
}

export function confirmUninstall(installed: InstalledExtension, commands: number): View {
  return confirmView({
    title: `Uninstall ${installed.title}`,
    confirm: `Uninstall ${installed.title}`,
    detail: `Removes it and its ${plural(commands, 'command')}. What it saved in extension-data stays.`,
    icon: { builtin: 'trash', tint: 'red' },
    payload: { uninstall: installed.name },
  });
}

/** For an installed extension's row in Manage Extensions. */
export function installedActions(installed: InstalledExtension): Action[] {
  return [
    { type: 'callback', id: 'update', title: 'Check for Update', payload: { name: installed.name } },
    {
      type: 'callback',
      id: 'uninstall',
      title: 'Uninstall Extension…',
      style: 'destructive',
      payload: { name: installed.name },
      shortcut: { key: 'backspace', modifiers: ['mod'] },
    },
  ];
}

/** Its version and where it came from, in a few words: "1.2.0 from npm (emoji)". */
export function installedLabel(installed: InstalledExtension): string {
  const version = versionOf(installed);
  const from = describeSource(installed.source);
  return version ? `${version} from ${from}` : `from ${from}`;
}

/**
 * The confirmations' callbacks, and Manage Extensions' Update and Uninstall, for whichever command
 * showed them. `after` is the view to go back to once something changed, given what was installed.
 */
export function extensionInstalls({ installer, registry }: ExtensionInstallOptions) {
  /** The commands an extension has once it's loaded, to start using them straight away. */
  const installedView = (installed: InstalledExtension): View => {
    const items: ListItem[] = registry()
      .listCommands()
      .filter((command) => command.extension.name === installed.name)
      .map((command) => ({
        id: command.ref.command,
        title: command.manifest.title,
        ...(command.manifest.subtitle ? { subtitle: command.manifest.subtitle } : {}),
        ...(command.icon ? { icon: command.icon } : {}),
        accessory: 'Command',
        actions: [{ type: 'open-command', ref: command.ref, title: 'Open Command' }],
      }));
    return {
      type: 'list',
      title: installed.title,
      searchPlaceholder: `Search ${installed.title}’s commands…`,
      sections: [{ title: 'Commands', items }],
      emptyText: 'None of its commands run on this system.',
    };
  };

  /** Loads extensions again, and says how the new one did. */
  const reloadWith = async (installed: InstalledExtension, verb: string): Promise<ActionResult> => {
    await registry().loadUserExtensions();
    const problem = registry()
      .listExtensions()
      .find((info) => info.dir === installed.dir && info.error);
    if (problem) {
      return { toast: `${verb} ${installed.title}, but it didn’t load: ${problem.error}`, toastStyle: 'failure' };
    }
    const version = versionOf(installed);
    return { toast: `${verb} ${installed.title}${version ? ` ${version}` : ''}`, toastStyle: 'success' };
  };

  const commandCount = (name: string) =>
    registry()
      .listExtensions()
      .find((info) => info.manifest?.name === name)?.manifest?.commands.length ?? 0;

  const installedFrom = (payload: Json | undefined) => installer.find(payloadField(payload, 'name') ?? '');

  /** Handles `id` if it's one of these, or gives `undefined`. */
  const onAction = async (
    id: string,
    payload: Json | undefined,
    after: (installed?: InstalledExtension) => View,
  ): Promise<ActionResult | undefined> => {
    switch (id) {
      case 'cancel':
        installer.discard();
        return { pop: true };
      case 'confirm': {
        const install = payloadField(payload, 'install');
        if (install) {
          const installed = installer.install(install);
          const verb = payloadField(payload, 'verb') === 'update' ? 'Updated' : 'Installed';
          // Loaded first, so the view after it has the new commands.
          const loaded = await reloadWith(installed, verb);
          return { pop: true, replace: after(installed), ...loaded };
        }
        const name = payloadField(payload, 'uninstall');
        if (!name) return undefined;
        const removed = installer.uninstall(name);
        await registry().loadUserExtensions();
        return { pop: true, replace: after(), toast: `Uninstalled ${removed.title}`, toastStyle: 'success' };
      }
      case 'update': {
        const installed = installedFrom(payload);
        if (!installed) return NOT_INSTALLED;
        const prepared = await installer.prepare(updateSource(installed.source), { updating: installed.name });
        if (prepared.version === installed.version && prepared.commit === installed.commit) {
          installer.discard();
          return { toast: `${installed.title} is up to date`, toastStyle: 'success' };
        }
        return { push: confirmInstall(prepared) };
      }
      case 'uninstall': {
        const installed = installedFrom(payload);
        if (!installed) return NOT_INSTALLED;
        return { push: confirmUninstall(installed, commandCount(installed.name)) };
      }
      default:
        return undefined;
    }
  };

  return {
    installedView,
    async onAction(...args: Parameters<typeof onAction>): Promise<ActionResult | undefined> {
      try {
        return await onAction(...args);
      } catch (error) {
        return failure(error);
      }
    },
  };
}

/** **Install Extension**: a form for what to install, then its confirmation. */
export function installExtensionCommand(options: ExtensionInstallOptions): CommandImplementation {
  const installs = extensionInstalls(options);
  return {
    view: (ctx) => installForm(ctx.argument),
    async onAction(id, payload) {
      // Once it's in, the form makes way for its commands.
      if (id !== 'check') {
        return installs.onAction(id, payload, (installed) =>
          installed ? installs.installedView(installed) : installForm(),
        );
      }
      try {
        const source = payloadField(payload, 'source') ?? '';
        return { push: confirmInstall(await options.installer.prepare(parseInstallSpec(source))) };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
