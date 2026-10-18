import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../shared/settings';
import type { SettingsState, SettingsTarget } from '../../../shared/settings-ipc';
import type { BuiltinIconName, Tint } from '../../../shared/types';
import { updateDescription, updateMenuLabel } from '../../../shared/updates';
import { HotkeyRecorder, type ShortcutRecorder } from '../components/HotkeyRecorder';
import { ItemIcon } from '../components/ItemIcon';
import { PaletteMark } from '../components/PaletteMark';
import { ThemePicker } from '../components/ThemePicker';
import { Toggle } from '../components/Toggle';
import { CommandShortcuts } from './CommandShortcuts';
import { Button, ConfirmButton, Group, PathRow, Row } from './controls';
import { QuicklinksSection } from './QuicklinksSection';
import { SnippetsSection } from './SnippetsSection';

const api = window.settings;
const { platform } = api;
const recorder: ShortcutRecorder = {
  pause: (paused) => api.pauseHotkey(paused),
  record: async (accelerator) => (await api.setHotkey(accelerator)).error,
};
const REVEAL = platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in Explorer' : 'Show Folder';
const HISTORY_SIZES = [50, 100, 200, 500, 1000, 5000];

type SectionId = 'general' | 'clipboard' | 'notes' | 'quicklinks' | 'snippets' | 'extensions' | 'about';

const SECTIONS: Array<{ id: SectionId; label: string; icon: BuiltinIconName; tint: Tint }> = [
  { id: 'general', label: 'General', icon: 'settings', tint: 'gray' },
  { id: 'clipboard', label: 'Clipboard', icon: 'clipboard', tint: 'orange' },
  { id: 'notes', label: 'Notes', icon: 'note', tint: 'yellow' },
  { id: 'quicklinks', label: 'Quicklinks', icon: 'link', tint: 'blue' },
  { id: 'snippets', label: 'Snippets', icon: 'text', tint: 'teal' },
  { id: 'extensions', label: 'Extensions', icon: 'extension', tint: 'purple' },
  { id: 'about', label: 'About', icon: 'sparkles', tint: 'pink' },
];

// ── Sections ────────────────────────────────────────────────

interface SectionProps {
  state: SettingsState;
  update(patch: Partial<Settings>): void;
  setState(state: SettingsState): void;
  /**
   * Where the window was asked to go, e.g. a quicklink to edit or a command to give a shortcut;
   * a new object each time.
   */
  target: SettingsTarget | null;
}

function General({ state, update }: SectionProps) {
  const { settings, info } = state;
  return (
    <>
      <Group>
        <Row label="Launcher shortcut" description="Press it anywhere to open Waypoint.">
          <HotkeyRecorder value={settings.hotkey} active={state.activeHotkey} platform={platform} recorder={recorder} />
        </Row>
        <Row label="Close when you click elsewhere" description="Hide the launcher as soon as it loses focus.">
          <Toggle
            label="Close when you click elsewhere"
            checked={settings.hideOnBlur}
            onChange={(hideOnBlur) => update({ hideOnBlur })}
          />
        </Row>
        <Row
          label="Paste into the app you were in"
          description={
            info.platform === 'linux'
              ? 'Emoji, gitmoji and commit messages go straight into the app on ↵ (needs xdotool or wtype). Off, they’re copied.'
              : 'Emoji, gitmoji and commit messages go straight into the app on ↵. Off, they’re copied for you to paste.'
          }
        >
          <Toggle
            label="Paste into the app you were in"
            checked={settings.pasteIntoApps}
            onChange={(pasteIntoApps) => update({ pasteIntoApps })}
          />
        </Row>
        <Row
          label="Open at login"
          description={
            info.canLaunchAtLogin
              ? 'Start Waypoint when you log in.'
              : 'Works in the installed app, not when running from source.'
          }
        >
          <Toggle
            label="Open at login"
            checked={settings.launchAtLogin}
            disabled={!info.canLaunchAtLogin}
            onChange={(launchAtLogin) => update({ launchAtLogin })}
          />
        </Row>
        <Row
          label="Check for updates"
          description={
            info.packaged
              ? 'Look for a new version every few hours.'
              : 'Works in the installed app, not when running from source.'
          }
        >
          <Toggle
            label="Check for updates"
            checked={settings.checkForUpdates}
            disabled={!info.packaged}
            onChange={(checkForUpdates) => update({ checkForUpdates })}
          />
        </Row>
      </Group>
      <Group title="Appearance">
        <ThemePicker value={settings.theme} onChange={(theme) => update({ theme })} />
      </Group>
    </>
  );
}

function Clipboard({ state, update, setState }: SectionProps) {
  const { clipboardHistory } = state.settings;
  const sizes = HISTORY_SIZES.includes(clipboardHistory.maxItems)
    ? HISTORY_SIZES
    : [...HISTORY_SIZES, clipboardHistory.maxItems].sort((a, b) => a - b);
  const entries = state.info.clipboardEntries;
  return (
    <Group>
      <Row
        label="Save clipboard history"
        description="Keep text and images you copy so you can find them again. Anything a password manager marks as private is skipped."
      >
        <Toggle
          label="Save clipboard history"
          checked={clipboardHistory.enabled}
          onChange={(enabled) => update({ clipboardHistory: { ...clipboardHistory, enabled } })}
        />
      </Row>
      <Row label="Save images" description="Screenshots and pictures you copy, kept as files on this computer.">
        <Toggle
          label="Save images"
          checked={clipboardHistory.images}
          disabled={!clipboardHistory.enabled}
          onChange={(images) => update({ clipboardHistory: { ...clipboardHistory, images } })}
        />
      </Row>
      <Row label="Keep" description="Older entries are removed once the history is full.">
        <select
          className="select"
          aria-label="Entries to keep"
          value={clipboardHistory.maxItems}
          onChange={(event) =>
            update({ clipboardHistory: { ...clipboardHistory, maxItems: Number(event.target.value) } })
          }
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size.toLocaleString()} entries
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="Saved entries"
        description={entries === 0 ? 'Nothing saved.' : `${entries.toLocaleString()} saved on this computer.`}
      >
        <ConfirmButton
          confirm="Click again to clear"
          disabled={entries === 0}
          onConfirm={async () => setState(await api.clearClipboard())}
        >
          Clear History
        </ConfirmButton>
      </Row>
    </Group>
  );
}

function Notes({ state, update }: SectionProps) {
  const custom = state.settings.notesDirectory !== '';
  const choose = async () => {
    const folder = await api.chooseFolder('Choose a folder for your notes');
    if (folder) update({ notesDirectory: folder });
  };
  return (
    <>
      <p className="section__intro">
        Each note is a Markdown file in this folder, and there’s no limit on how many you keep. Pick a synced folder
        (iCloud Drive, Dropbox, a git repo) to have them everywhere. Markdown files already in the folder show up as
        notes too.
      </p>
      <Group>
        <Row label="Notes folder" description={<PathRow path={state.info.notesDirectory} />}>
          <div className="button-row">
            <Button onClick={() => api.open('notesDirectory')}>{REVEAL}</Button>
            <Button onClick={() => void choose()}>Change…</Button>
          </div>
        </Row>
        {custom && (
          <Row label="Use the default folder" description="Notes already in your folder stay where they are.">
            <Button onClick={() => update({ notesDirectory: '' })}>Use Default</Button>
          </Row>
        )}
      </Group>
    </>
  );
}

function Extensions({ state, update, setState, target }: SectionProps) {
  const folders = state.settings.extensionDirectories;
  const user = state.extensions.filter((e) => e.source === 'user');
  const builtin = state.extensions.filter((e) => e.source !== 'user');
  const [reloading, setReloading] = useState(false);

  const addFolder = async () => {
    const folder = await api.chooseFolder('Choose an extension folder');
    if (folder && !folders.includes(folder)) update({ extensionDirectories: [...folders, folder] });
  };
  const reload = async () => {
    setReloading(true);
    try {
      setState(await api.reloadExtensions());
    } finally {
      setReloading(false);
    }
  };

  return (
    <>
      <p className="section__intro">
        Extensions add commands to the launcher. They run in a separate process with full access to your computer, so
        only install ones you trust.{' '}
        <button type="button" className="link" onClick={() => api.openLink('extensionDocs')}>
          Write your own
        </button>
      </p>
      <div className="button-row button-row--start">
        <Button onClick={() => api.open('extensionsDirectory')}>Open Extensions Folder</Button>
        <Button onClick={() => void reload()} disabled={reloading}>
          {reloading ? 'Reloading…' : 'Reload Extensions'}
        </Button>
      </div>

      <Group title="Installed">
        {user.length === 0 ? (
          <p className="group__empty">
            No extensions yet. Put an extension’s folder in the extensions folder, then reload.
          </p>
        ) : (
          <ul className="extension-list">
            {user.map((extension) => (
              <li
                key={`${extension.name}:${extension.dir}`}
                className="extension"
                data-failed={extension.error ? '' : undefined}
              >
                <span className="extension__title">{extension.title}</span>
                <span className="extension__meta">
                  {extension.error ??
                    `${extension.commands} command${extension.commands === 1 ? '' : 's'}, from ${extension.dir}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Also load extensions from">
        {folders.length > 0 && (
          <ul className="folder-list">
            {folders.map((folder) => (
              <li key={folder} className="folder">
                <PathRow path={folder} />
                <Button onClick={() => update({ extensionDirectories: folders.filter((f) => f !== folder) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Row
          label={folders.length === 0 ? 'Only the extensions folder' : 'Another folder'}
          description="Add a folder to work on an extension in its own repo."
        >
          <Button onClick={() => void addFolder()}>Add Folder…</Button>
        </Row>
      </Group>

      <Group title="Built in">
        <ul className="extension-list">
          {builtin.map((extension) => (
            <li
              key={`${extension.name}:${extension.dir ?? ''}`}
              className="extension"
              data-failed={extension.error ? '' : undefined}
            >
              <span className="extension__title">{extension.title}</span>
              <span className="extension__meta">
                {extension.error ?? `${extension.commands} command${extension.commands === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ul>
      </Group>

      <CommandShortcuts
        state={state}
        setState={setState}
        revealed={target?.command ? { key: target.command, request: target } : undefined}
      />
    </>
  );
}

function About({ state }: SectionProps) {
  const { info } = state;
  const { mode, status } = info.updates;
  // The tray's wording, without its menu ellipsis.
  const action = updateMenuLabel(status, mode);
  return (
    <>
      <div className="about">
        <PaletteMark size={56} />
        <div>
          <p className="about__name">Waypoint</p>
          <p className="about__version">
            Version {info.version}, on Electron {info.electron} and Node.js {info.node}
          </p>
        </div>
      </div>
      <div className="button-row button-row--start">
        <Button onClick={() => api.openLink('repository')}>View on GitHub</Button>
        <Button onClick={() => api.openLink('issues')}>Report an Issue</Button>
        <Button onClick={() => api.openOnboarding()}>Run Setup Again</Button>
      </div>
      {mode !== 'off' && (
        <Group title="Updates">
          <Row label={`Version ${info.version}`} description={updateDescription(status, mode)}>
            <Button onClick={() => api.updateAction()} disabled={!action.enabled}>
              {action.label.replace(/…$/, '')}
            </Button>
          </Row>
        </Group>
      )}
      <Group title="Your data">
        <Row label="Data folder" description={<PathRow path={info.dataDirectory} />}>
          <Button onClick={() => api.open('dataDirectory')}>{REVEAL}</Button>
        </Row>
        <Row
          label="Settings file"
          description="Everything on these pages, as JSON. Changes you save there apply right away."
        >
          <Button onClick={() => api.open('settingsFile')}>Edit settings.json</Button>
        </Row>
      </Group>
    </>
  );
}

const SECTION_VIEWS: Record<SectionId, (props: SectionProps) => ReactNode> = {
  general: General,
  clipboard: Clipboard,
  notes: Notes,
  quicklinks: QuicklinksSection,
  snippets: SnippetsSection,
  extensions: Extensions,
  about: About,
};

// ── Window ──────────────────────────────────────────────────

export function SettingsApp() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [section, setSection] = useState<SectionId>('general');
  const [target, setTarget] = useState<SettingsTarget | null>(null);

  // Opened to edit something (a quicklink from the launcher, say): go to its section. Asked when
  // the page loads, and again whenever the main process says there's somewhere new to go.
  useEffect(() => {
    const go = (next: SettingsTarget | null) => {
      const known = SECTIONS.find((s) => s.id === next?.section);
      if (!next || !known) return;
      setSection(known.id);
      setTarget({ ...next });
    };
    const take = () => void api.takeTarget().then(go);
    take();
    return api.onNavigate(take);
  }, []);
  const pickSection = (id: SectionId) => {
    setSection(id);
    setTarget(null);
  };

  useEffect(() => {
    const load = () => void api.get().then(setState);
    load();
    const off = api.onChanged(load);
    // Clipboard counts and extension lists change while the window sits in the background.
    window.addEventListener('focus', load);
    return () => {
      off();
      window.removeEventListener('focus', load);
    };
  }, []);

  // Show changes immediately, and only take the answer to the latest change, so quick
  // successive edits (a toggle, then a menu in the same group) never undo each other.
  const lastUpdate = useRef(0);
  const update = useCallback((patch: Partial<Settings>) => {
    setState((previous) => (previous ? { ...previous, settings: { ...previous.settings, ...patch } } : previous));
    const request = ++lastUpdate.current;
    void api.update(patch).then((next) => {
      if (request === lastUpdate.current) setState(next);
    });
  }, []);

  const onNavKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = SECTIONS.findIndex((s) => s.id === section);
    const next = SECTIONS[Math.min(SECTIONS.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      pickSection(next.id);
      document.getElementById(`nav-${next.id}`)?.focus();
    }
  };

  // Start with focus in the page rather than on the first section button, so nothing shows a
  // focus ring until you press Tab.
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    content.current?.focus({ preventScroll: true });
  }, []);

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const View = SECTION_VIEWS[section];

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings sections" onKeyDown={onNavKeyDown}>
        {/* Room for the window buttons on macOS, and somewhere to drag the window by. */}
        <div className="settings__nav-top" />
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            id={`nav-${item.id}`}
            type="button"
            className="settings__nav-item"
            data-tint={item.tint}
            aria-current={item.id === section ? 'page' : undefined}
            tabIndex={item.id === section ? 0 : -1}
            onClick={() => pickSection(item.id)}
          >
            <ItemIcon icon={{ builtin: item.icon, tint: item.tint }} />
            {item.label}
          </button>
        ))}
      </nav>
      <main ref={content} className="settings__content" tabIndex={-1} aria-labelledby="settings-heading">
        <header className="settings__header">
          <h1 id="settings-heading" className="settings__heading">
            {current?.label}
          </h1>
        </header>
        {state ? <View state={state} update={update} setState={setState} target={target} /> : null}
      </main>
    </div>
  );
}
