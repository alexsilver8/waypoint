import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { app, shell } from 'electron';
import type { ListItem, View } from '../../shared/types';
import type { ExtensionInstaller } from '../extensions/installer';
import type { CommandRegistry } from '../registry';
import {
  extensionInstalls,
  INSTALL_COMMAND,
  installExtensionCommand,
  installedActions,
  installedLabel,
} from './extension-install';
import type { BuiltinExtension } from './types';

interface PaletteCommandOptions {
  /** Opens Settings; with a command's key, at that command's shortcut (Set Shortcut… in the launcher). */
  openSettings: (command?: string) => void;
  /** Opens first-launch setup again. */
  openOnboarding: () => void;
  extensionsDir: string;
  registry: () => CommandRegistry;
  /** Installs extensions from npm and git. */
  installer: ExtensionInstaller;
}

/** Commands for managing Waypoint itself. */
export function paletteExtension({
  openSettings,
  openOnboarding,
  extensionsDir,
  registry,
  installer,
}: PaletteCommandOptions): BuiltinExtension {
  const installs = extensionInstalls({ installer, registry });

  const openExtensionsFolder = async () => {
    mkdirSync(extensionsDir, { recursive: true });
    const error = await shell.openPath(extensionsDir);
    return error ? { toast: error, toastStyle: 'failure' as const } : { hide: true };
  };

  const reload = async () => {
    const { loaded, failed } = await registry().loadUserExtensions();
    const summary = `Loaded ${loaded} extension${loaded === 1 ? '' : 's'}`;
    return failed > 0
      ? { toast: `${summary}, ${failed} failed`, toastStyle: 'failure' as const }
      : { toast: summary, toastStyle: 'success' as const };
  };

  const extensionsView = (): View => {
    const user: ListItem[] = [];
    const builtin: ListItem[] = [];
    // The ones installed from npm or git can be updated and uninstalled here too.
    const installed = new Map(installer.list().map((extension) => [resolve(extension.dir), extension]));
    for (const info of registry().listExtensions()) {
      const fromInstall = info.dir ? installed.get(resolve(info.dir)) : undefined;
      const name = info.manifest?.name ?? info.dir ?? 'unknown';
      const commandCount = info.manifest?.commands.length ?? 0;
      const item: ListItem = {
        id: `${info.source}:${name}:${info.dir ?? ''}`,
        title: info.manifest?.title ?? info.dir ?? name,
        subtitle: info.error ?? `${commandCount} command${commandCount === 1 ? '' : 's'}`,
        icon: info.error
          ? { builtin: 'alert', tint: 'red' }
          : (info.manifest?.icon ?? { builtin: 'extension', tint: 'purple' }),
        accessory: info.error ? 'Failed to load' : info.source === 'user' ? name : 'Built-in',
        actions: [],
      };
      if (fromInstall && !info.error) item.subtitle = `${item.subtitle} · ${installedLabel(fromInstall)}`;
      if (info.dir) item.actions.push({ type: 'open-path', path: info.dir, title: 'Open Extension Folder' });
      if (fromInstall) item.actions.push(...installedActions(fromInstall));
      if (info.error) item.actions.push({ type: 'copy', text: info.error, title: 'Copy Error' });
      item.actions.push({ type: 'callback', id: 'reload', title: 'Reload Extensions' });
      (info.source === 'user' ? user : builtin).push(item);
    }
    return {
      type: 'list',
      title: 'Extensions',
      searchPlaceholder: 'Search extensions…',
      sections: [
        {
          items: [
            {
              id: 'install',
              title: 'Install Extension…',
              subtitle: 'From npm or a git repository',
              icon: { builtin: 'extension', tint: 'green' },
              actions: [{ type: 'open-command', ref: INSTALL_COMMAND, title: 'Install Extension' }],
            },
          ],
        },
        { title: 'Installed', items: user },
        { title: 'Built-in', items: builtin },
      ],
    };
  };

  return {
    manifest: {
      name: 'waypoint',
      title: 'Waypoint',
      icon: { builtin: 'sparkles', tint: 'pink' },
      commands: [
        {
          name: 'settings',
          title: 'Open Settings',
          mode: 'no-view',
          icon: { builtin: 'settings', tint: 'gray' },
          keywords: ['preferences', 'hotkey', 'config'],
        },
        {
          name: 'onboarding',
          title: 'Set Up Waypoint',
          mode: 'no-view',
          icon: { builtin: 'sparkles', tint: 'blue' },
          keywords: ['onboarding', 'welcome', 'setup', 'tour', 'tutorial', 'getting started', 'walkthrough'],
        },
        {
          name: 'extensions',
          title: 'Manage Extensions',
          mode: 'view',
          icon: { builtin: 'extension', tint: 'purple' },
        },
        {
          name: 'install-extension',
          title: 'Install Extension',
          mode: 'view',
          icon: { builtin: 'extension', tint: 'green' },
          keywords: ['npm', 'github', 'git', 'add extension', 'plugin'],
        },
        {
          name: 'reload-extensions',
          title: 'Reload Extensions',
          mode: 'no-view',
          icon: { builtin: 'refresh', tint: 'green' },
        },
        {
          name: 'open-extensions-folder',
          title: 'Open Extensions Folder',
          mode: 'no-view',
          icon: { builtin: 'folder', tint: 'blue' },
        },
        {
          name: 'quit',
          title: 'Quit Waypoint',
          mode: 'no-view',
          icon: { builtin: 'power', tint: 'red' },
          keywords: ['exit'],
        },
      ],
    },
    commands: {
      settings: {
        run(ctx) {
          openSettings(ctx.argument || undefined);
          return { hide: true };
        },
      },
      onboarding: {
        run() {
          openOnboarding();
          return { hide: true };
        },
      },
      extensions: {
        view: extensionsView,
        async onAction(id, payload) {
          if (id !== 'reload') return installs.onAction(id, payload, extensionsView);
          return { ...(await reload()), replace: extensionsView() };
        },
      },
      'install-extension': installExtensionCommand({ installer, registry }),
      'reload-extensions': { run: reload },
      'open-extensions-folder': { run: openExtensionsFolder },
      quit: {
        run() {
          app.quit();
          return { hide: true };
        },
      },
    },
  };
}
