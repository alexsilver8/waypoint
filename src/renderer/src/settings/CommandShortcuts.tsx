import { X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandShortcutInfo } from '../../../shared/command-hotkeys';
import type { SettingsState } from '../../../shared/settings-ipc';
import { HotkeyRecorder, type ShortcutRecorder } from '../components/HotkeyRecorder';
import { ItemIcon } from '../components/ItemIcon';

const api = window.settings;

/**
 * A command Settings was opened to give a shortcut (Set Shortcut… in the launcher), or an alias
 * with `alias` (Set Alias…). `request` is a new object each time it's asked, so asking again for
 * the same command records or focuses again.
 */
export interface RevealedCommand {
  key: string;
  request: object;
  alias?: boolean;
}

interface AliasFieldProps {
  command: CommandShortcutInfo;
  setState(state: SettingsState): void;
  /** Focuses the field whenever this becomes a new object. */
  focusRequest?: object;
}

/** A command's alias, saved on ↵ or when the field loses focus; Esc puts back the saved one. */
function AliasField({ command, setState, focusRequest }: AliasFieldProps) {
  const { key, title } = command;
  const saved = command.alias ?? '';
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLInputElement>(null);

  // Changed elsewhere (settings.json, the launcher): show it, unless it's being typed over.
  useEffect(() => {
    if (document.activeElement !== field.current) setDraft(saved);
  }, [saved]);

  useEffect(() => {
    if (focusRequest !== undefined) field.current?.focus();
  }, [focusRequest]);

  const save = async (value: string | null) => {
    if ((value ?? '').trim().toLowerCase() === saved) {
      setDraft(saved);
      setError(undefined);
      return;
    }
    const result = await api.setCommandAlias(key, value);
    setState(result.state);
    setError(result.error);
    if (!result.error) setDraft(value === null ? '' : value.trim().toLowerCase());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save(draft);
    } else if (event.key === 'Escape' && draft !== saved) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(saved);
      setError(undefined);
    }
  };

  return (
    <div className="alias">
      <span className="hotkey__row">
        <input
          ref={field}
          className="alias__field"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void save(draft)}
          placeholder="Add Alias"
          aria-label={`Alias for ${title}`}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
        {saved && (
          <button
            type="button"
            className="hotkey__clear"
            onClick={() => void save(null)}
            aria-label={`Remove the alias for ${title}`}
            title="Remove"
          >
            <X size={13} strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
      </span>
      {error && (
        <span className="hotkey__message" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface CommandRowProps {
  command: CommandShortcutInfo;
  platform: SettingsState['info']['platform'];
  setState(state: SettingsState): void;
  recordRequest?: object;
  aliasRequest?: object;
}

function CommandRow({ command, platform, setState, recordRequest, aliasRequest }: CommandRowProps) {
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

  const revealed = recordRequest ?? aliasRequest;
  useEffect(() => {
    if (revealed !== undefined) row.current?.scrollIntoView({ block: 'center' });
  }, [revealed]);

  return (
    <li ref={row} className="command-shortcut" data-revealed={revealed !== undefined || undefined}>
      <ItemIcon icon={command.icon ?? { builtin: 'extension', tint: 'purple' }} />
      <span className="command-shortcut__text">
        <span className="command-shortcut__title">{title}</span>
        <span className="command-shortcut__key">{key}</span>
      </span>
      <AliasField command={command} setState={setState} focusRequest={aliasRequest} />
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

/** Whether every word typed is somewhere in the command's title, extension, name or alias. */
function matches(command: CommandShortcutInfo, query: string): boolean {
  const haystack = `${command.title} ${command.extension.title} ${command.key} ${command.alias ?? ''}`.toLowerCase();
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

/** Settings → Extensions: every command, by extension, each with its own alias and global shortcut. */
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
        the rest just run. An alias is a word to type in the launcher that puts its command first.
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
                      recordRequest={revealed?.key === command.key && !revealed.alias ? revealed.request : undefined}
                      aliasRequest={revealed?.key === command.key && revealed.alias ? revealed.request : undefined}
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
