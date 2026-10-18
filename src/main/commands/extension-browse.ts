/**
 * **Browse Extensions**: extensions people published to npm, to search and install from the
 * launcher. Installing one shows the same confirmation as Install Extension, with what it is and
 * where it comes from, before anything is installed.
 */
import type {
  Action,
  ActionResult,
  CommandImplementation,
  CommandRef,
  ListItem,
  ListSection,
  View,
} from '../../shared/types';
import { CATALOG_KEYWORD, type CatalogEntry, type ExtensionCatalog } from '../extensions/catalog';
import type { InstalledExtension } from '../extensions/installer';
import {
  confirmInstall,
  type ExtensionInstallOptions,
  extensionInstalls,
  INSTALL_COMMAND,
  installedActions,
  payloadField,
} from './extension-install';

export const BROWSE_COMMAND: CommandRef = { extension: 'waypoint', command: 'browse-extensions' };

/** Where an author reads how to get their extension listed. */
export const SHARING_DOCS =
  'https://github.com/alexsilver8/waypoint/blob/main/docs/extensions.md#sharing-your-extension';

export interface BrowseExtensionsOptions extends ExtensionInstallOptions {
  catalog: ExtensionCatalog;
}

const count = new Intl.NumberFormat('en');

function published(date: string | undefined): string | undefined {
  const time = date ? Date.parse(date) : Number.NaN;
  return Number.isNaN(time)
    ? undefined
    : new Date(time).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** One extension found on npm, installed or not. */
export function catalogItem(entry: CatalogEntry, installed: InstalledExtension | undefined): ListItem {
  const links: Action[] = [
    { type: 'open-url', url: entry.npmUrl, title: 'Open on npm' },
    ...(entry.homepage ? [{ type: 'open-url' as const, url: entry.homepage, title: 'Open Repository' }] : []),
    { type: 'copy', text: entry.name, title: 'Copy Package Name' },
  ];
  const metadata = [
    { label: 'Latest version', value: entry.version },
    ...(installed?.version ? [{ label: 'Installed', value: installed.version }] : []),
    ...(entry.publisher ? [{ label: 'Published by', value: entry.publisher }] : []),
    ...(published(entry.date) ? [{ label: 'Published', value: published(entry.date) as string }] : []),
    ...(entry.weeklyDownloads !== undefined
      ? [{ label: 'Downloads a week', value: count.format(entry.weeklyDownloads) }]
      : []),
    ...(entry.license ? [{ label: 'License', value: entry.license }] : []),
  ];
  return {
    id: entry.name,
    title: entry.name,
    ...(entry.description ? { subtitle: entry.description } : {}),
    icon: { builtin: 'extension', tint: installed ? 'green' : 'purple' },
    accessory: installed ? 'Installed' : entry.version,
    detail: {
      title: entry.name,
      body: [
        entry.description ?? 'No description.',
        '',
        installed
          ? '- [x] Installed'
          : 'Install it to see its commands. It runs with your access, so install only what you trust.',
      ].join('\n'),
      metadata,
    },
    actions: installed
      ? [...installedActions(installed), ...links]
      : [{ type: 'callback', id: 'install', title: 'Install Extension…', payload: { name: entry.name } }, ...links],
  };
}

/** The extensions found for a search, or why there are none. */
export function catalogView(
  entries: CatalogEntry[],
  installed: InstalledExtension[],
  options: { query?: string; error?: string } = {},
): View {
  const fromNpm = new Map(
    installed.flatMap((extension) => (extension.source.kind === 'npm' ? [[extension.source.name, extension]] : [])),
  );
  const query = options.query?.trim() ?? '';
  const sections: ListSection[] = [];
  if (options.error) {
    sections.push({
      items: [
        {
          id: 'error',
          title: options.error,
          icon: { builtin: 'alert', tint: 'red' },
          actions: [{ type: 'callback', id: 'retry', title: 'Try Again' }],
        },
      ],
    });
  } else if (entries.length > 0) {
    sections.push({
      title: query ? 'Results' : 'Most installed',
      items: entries.map((entry) => catalogItem(entry, fromNpm.get(entry.name))),
    });
  } else {
    sections.push({
      items: [
        query
          ? {
              id: 'none',
              title: `No extensions on npm match “${query}”`,
              subtitle: 'Try other words, or install one from its address',
              icon: { builtin: 'search', tint: 'gray' },
              actions: [{ type: 'open-command', ref: INSTALL_COMMAND, title: 'Install Extension', argument: query }],
            }
          : {
              id: 'none',
              title: 'No extensions are listed yet',
              subtitle: `Publish yours to npm with the “${CATALOG_KEYWORD}” keyword`,
              icon: { builtin: 'sparkles', tint: 'yellow' },
              actions: [{ type: 'open-url', url: SHARING_DOCS, title: 'How to Share an Extension' }],
            },
      ],
    });
  }
  sections.push({
    items: [
      {
        id: 'install-other',
        title: 'Install from an Address…',
        subtitle: 'Any npm package, GitHub repository or git address',
        icon: { builtin: 'link', tint: 'blue' },
        actions: [{ type: 'open-command', ref: INSTALL_COMMAND, title: 'Install Extension' }],
      },
    ],
  });
  return {
    type: 'list',
    title: 'Browse Extensions',
    searchPlaceholder: 'Search extensions on npm…',
    // npm does the searching.
    filtering: false,
    sections,
  };
}

export function browseExtensionsCommand(options: BrowseExtensionsOptions): CommandImplementation {
  const { catalog, installer } = options;
  const installs = extensionInstalls(options);
  /** What the list last showed, to show again after an uninstall without asking npm. */
  let last: { query: string; entries: CatalogEntry[] } = { query: '', entries: [] };

  const view = async (query: string): Promise<View> => {
    try {
      const entries = await catalog.search(query);
      last = { query, entries };
      return catalogView(entries, installer.list(), { query });
    } catch (error) {
      return catalogView([], [], { query, error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    view: (ctx) => view(ctx.query),
    async onAction(id, payload, ctx): Promise<ActionResult | undefined> {
      if (id === 'retry') return { replace: await view(ctx.query) };
      if (id === 'install') {
        const name = payloadField(payload, 'name');
        if (!name) return undefined;
        try {
          return { push: confirmInstall(await installer.prepare({ kind: 'npm', name })) };
        } catch (error) {
          return { toast: error instanceof Error ? error.message : String(error), toastStyle: 'failure' };
        }
      }
      // Once one is in, its commands show; after an uninstall, the list as it was, without it.
      return installs.onAction(id, payload, (installed) =>
        installed
          ? installs.installedView(installed)
          : catalogView(last.entries, installer.list(), { query: last.query }),
      );
    },
  };
}
