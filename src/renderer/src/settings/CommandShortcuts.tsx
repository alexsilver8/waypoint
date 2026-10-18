import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandShortcutInfo } from '../../../shared/command-hotkeys';
import type { SettingsState } from '../../../shared/settings-ipc';
import { HotkeyRecorder, type ShortcutRecorder } from '../components/HotkeyRecorder';
import { ItemIcon } from '../components/ItemIcon';

const api = window.settings;

/**
 * A command Settings was opened to give a shortcut (Set Shortcut… in the launcher). `request` is a
 * new object each time it's asked, so asking again for the same command records again.
 */
export interface RevealedCommand {
  key: string;
  request: object;
}

interface CommandRowProps {
  command: CommandShortcutInfo;
  platform: SettingsState['info']['platform'];
  setState(state: SettingsState): void;
  recordRequest?: object;
}

function CommandRow({ command, platform, setState, recordRequest }: CommandRowProps) {
  const { key, title } = command;
  const row = useRef<HTMLLIElement>(null);
  // Kept the same while it records, or a refresh of the page would resume the shortcuts too soon.
  const recorder: ShortcutRecorder = useMemo(
    () => ({
      pause: (paused) => api.pauseHotkey(paused),
      record: async (accelerator) => {
        const { state, error } = await api.setCommandHotkey(key, accelerator);
        setState(state);
        return error;
      },
    }),
    [key, setState],
  );

  useEffect(() => {
    if (recordRequest !== undefined) row.current?.scrollIntoView({ block: 'center' });
  }, [recordRequest]);

  return (
    <li ref={row} className="command-shortcut" data-revealed={recordRequest !== undefined || undefined}>
      <ItemIcon icon={command.icon ?? { builtin: 'extension', tint: 'purple' }} />
      <span className="command-shortcut__text">
        <span className="command-shortcut__title">{title}</span>
        <span className="command-shortcut__key">{key}</span>
      </span>
      <HotkeyRecorder
        value={command.hotkey ?? ''}
        active={command.error ? undefined : command.hotkey}
        problem={command.error}
        platform={platform}
        recorder={recorder}
        label={title}
        onClear={async () => setState((await api.setCommandHotkey(key, null)).state)}
        recordRequest={recordRequest}
      />
    </li>
  );
}

/** Whether every word typed is somewhere in the command's title, extension or name. */
function matches(command: CommandShortcutInfo, query: string): boolean {
  const haystack = `${command.title} ${command.extension.title} ${command.key}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

interface CommandShortcutsProps {
  state: SettingsState;
  setState(state: SettingsState): void;
  revealed?: RevealedCommand;
}

/** Settings → Extensions: every command, by extension, each with its own global shortcut. */
export function CommandShortcuts({ state, setState, revealed }: CommandShortcutsProps) {
  const [query, setQuery] = useState('');
  const { platform } = state.info;

  // Opened for one command: make sure the search doesn't hide it.
  const request = revealed?.request;
  useEffect(() => {
    if (request) setQuery('');
  }, [request]);

  const groups = useMemo(() => {
    const byExtension = new Map<string, { title: string; commands: CommandShortcutInfo[] }>();
    for (const command of state.commands) {
      if (query.trim() && !matches(command, query)) continue;
      const group = byExtension.get(command.extension.name) ?? { title: command.extension.title, commands: [] };
      group.commands.push(command);
      byExtension.set(command.extension.name, group);
    }
    return [...byExtension.entries()];
  }, [state.commands, query]);

  return (
    <section className="group" aria-label="Command shortcuts">
      <h2 className="group__title">Command shortcuts</h2>
      <p className="section__intro">
        Give any command its own shortcut to run it from anywhere. Commands that open a list open the launcher at it;
        the rest just run.
        {platform === 'linux' && (
          <>
            {' '}
            Under Wayland, where they may not arrive, bind <code>waypoint --command</code> and the name under the
            command in your desktop’s keyboard settings instead.
          </>
        )}
      </p>
      <input
        className="command-filter"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search commands…"
        aria-label="Search commands"
        spellCheck={false}
      />
      <div className="group__card">
        {groups.length === 0 ? (
          <p className="group__empty">No commands match “{query.trim()}”.</p>
        ) : (
          <ul className="command-shortcuts">
            {groups.map(([name, group]) => (
              <li key={name} className="command-shortcuts__extension">
                <h3 className="command-shortcuts__heading">{group.title}</h3>
                <ul className="command-shortcuts__list" aria-label={group.title}>
                  {group.commands.map((command) => (
                    <CommandRow
                      key={command.key}
                      command={command}
                      platform={platform}
                      setState={setState}
                      recordRequest={revealed?.key === command.key ? revealed.request : undefined}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
