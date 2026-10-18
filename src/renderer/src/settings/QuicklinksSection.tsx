import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { PLACEHOLDER_NAMES } from '../../../shared/placeholders';
import { checkQuicklink, type Quicklink, shortLink } from '../../../shared/quicklinks';
import type { AppChoice, SettingsState, SettingsTarget } from '../../../shared/settings-ipc';
import { Button, Group } from './controls';
import { EditorButtons, EntryRow, Field, PlaceholderButtons, PlaceholderGuide } from './entry-form';

const api = window.settings;
const enter = api.platform === 'darwin' ? '↵' : 'Enter';

interface Draft {
  id?: string;
  name: string;
  link: string;
  openWith: string;
  icon: string;
}

const EMPTY: Draft = { name: '', link: '', openWith: '', icon: '' };

function draftOf(quicklink: Quicklink): Draft {
  return {
    id: quicklink.id,
    name: quicklink.name,
    link: quicklink.link,
    openWith: quicklink.openWith ?? '',
    icon: quicklink.icon ?? '',
  };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The app's name for a path, or what was typed by hand. */
function appName(openWith: string, apps: readonly AppChoice[]): string {
  return apps.find((app) => app.path === openWith)?.name ?? openWith.split(/[\\/]/).pop() ?? openWith;
}

function QuicklinkEditor({
  initial,
  onSaved,
  onCancel,
  setState,
}: {
  initial: Draft;
  onSaved(): void;
  onCancel(): void;
  setState(state: SettingsState): void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<AppChoice[]>([]);
  const link = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    void api.listApps().then(setApps);
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // Checked here first, with the same rules as the file, so mistakes show without a round trip.
    const checked = checkQuicklink(draft);
    if (checked.problem) {
      setError(capitalized(checked.problem));
      return;
    }
    const result = await api.saveQuicklink(draft);
    setState(result.state);
    if (result.error) setError(result.error);
    else onSaved();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };

  const known = apps.some((app) => app.path === draft.openWith);
  return (
    <Group title={draft.id ? 'Edit Quicklink' : 'New Quicklink'}>
      <form
        className="entry-editor"
        aria-label={draft.id ? 'Edit Quicklink' : 'New Quicklink'}
        onSubmit={save}
        onKeyDown={onKeyDown}
      >
        <Field label="Name" hint="What you type in the launcher to find it.">
          {(id, hintId) => (
            <input
              id={id}
              className="entry-field__input"
              aria-describedby={hintId}
              value={draft.name}
              placeholder="GitHub Search"
              autoFocus
              spellCheck={false}
              onChange={(event) => change({ name: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Link"
          hint={
            <>
              A web address, a file or folder, or an app’s link like <code>spotify:</code>. Put{' '}
              <code>{'{argument}'}</code> where what you type after the name goes.
            </>
          }
        >
          {(id, hintId) => (
            <>
              <input
                id={id}
                ref={link}
                className="entry-field__input entry-field__input--code"
                aria-describedby={hintId}
                value={draft.link}
                placeholder="https://github.com/search?q={argument}"
                spellCheck={false}
                onChange={(event) => change({ link: event.target.value })}
              />
              <PlaceholderButtons
                names={PLACEHOLDER_NAMES}
                field={link}
                onChange={(value) => change({ link: value })}
              />
            </>
          )}
        </Field>
        <Field label="Open with">
          {(id) => (
            <select
              id={id}
              className="select entry-field__select"
              value={draft.openWith}
              onChange={(event) => change({ openWith: event.target.value })}
            >
              <option value="">The usual app for it</option>
              {draft.openWith && !known && <option value={draft.openWith}>{appName(draft.openWith, apps)}</option>}
              {apps.map((app) => (
                <option key={app.path} value={app.path}>
                  {app.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Icon" hint="An emoji. Leave it empty for a link.">
          {(id, hintId) => (
            <input
              id={id}
              className="entry-field__input entry-field__input--short"
              aria-describedby={hintId}
              value={draft.icon}
              placeholder="🔗"
              onChange={(event) => change({ icon: event.target.value })}
            />
          )}
        </Field>
        <EditorButtons error={error} onCancel={onCancel} />
      </form>
    </Group>
  );
}

/** Settings → Quicklinks: your quicklinks, with an editor to add or change one. */
export function QuicklinksSection({
  state,
  setState,
  target,
}: {
  state: SettingsState;
  setState(state: SettingsState): void;
  target: SettingsTarget | null;
}) {
  const [editing, setEditing] = useState<Draft | null>(null);
  // A new key for each edit, so the editor starts afresh even when one is open already.
  const [editorKey, setEditorKey] = useState(0);
  const handled = useRef<SettingsTarget | null>(null);

  const edit = (draft: Draft) => {
    setEditing(draft);
    setEditorKey((key) => key + 1);
  };

  // Sent here from the launcher (Create Quicklink, or ⌘E on one): open the editor for it, once.
  useEffect(() => {
    if (target?.section !== 'quicklinks' || handled.current === target) return;
    handled.current = target;
    const quicklink = target.edit ? state.quicklinks.find((q) => q.id === target.edit) : undefined;
    const draft = quicklink ? draftOf(quicklink) : target.create ? EMPTY : null;
    if (!draft) return;
    setEditing(draft);
    setEditorKey((key) => key + 1);
  }, [target, state.quicklinks]);

  // Why the last delete didn't happen, like a quicklinks.json that can't be read.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = async (id: string) => {
    const result = await api.deleteQuicklink(id);
    setState(result.state);
    setDeleteError(result.error ?? null);
    if (!result.error && editing?.id === id) setEditing(null);
  };

  return (
    <>
      <p className="section__intro">
        Quicklinks open a website, a file or folder, or a place in an app with a few keys: type a quicklink’s name in
        the launcher and press {enter}. Put <code>{'{argument}'}</code> in a link to fill it in as you go, so “gh
        waypoint” searches GitHub for “waypoint”. They’re kept in <code>quicklinks.json</code> in the data folder, and
        changes to the file show up right away.
      </p>
      {!editing && (
        <div className="button-row button-row--start">
          <Button onClick={() => edit(EMPTY)}>New Quicklink</Button>
        </div>
      )}
      {editing && (
        <QuicklinkEditor
          key={editorKey}
          initial={editing}
          setState={setState}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}
      <Group title="Your quicklinks">
        {deleteError && (
          <p className="entry-list__error" role="alert">
            {deleteError}
          </p>
        )}
        {state.quicklinks.length === 0 ? (
          <p className="group__empty">No quicklinks yet.</p>
        ) : (
          <ul className="entry-list">
            {state.quicklinks.map((quicklink) => (
              <EntryRow
                key={quicklink.id}
                icon={quicklink.icon ? { emoji: quicklink.icon } : { builtin: 'link', tint: 'blue' }}
                title={quicklink.name}
                subtitle={shortLink(quicklink.link)}
                onEdit={() => edit(draftOf(quicklink))}
                onDelete={() => void remove(quicklink.id)}
              />
            ))}
          </ul>
        )}
      </Group>
      <Group title="Placeholders">
        <PlaceholderGuide names={PLACEHOLDER_NAMES} />
      </Group>
    </>
  );
}
