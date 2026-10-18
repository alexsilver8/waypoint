import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { SettingsState, SettingsTarget } from '../../../shared/settings-ipc';
import { checkSnippet, SNIPPET_PLACEHOLDERS, type Snippet, snippetPreview } from '../../../shared/snippets';
import { Button, Group } from './controls';
import { EditorButtons, EntryRow, Field, PlaceholderButtons, PlaceholderGuide } from './entry-form';

const api = window.settings;
const mac = api.platform === 'darwin';
const enter = mac ? '↵' : 'Enter';

interface Draft {
  id?: string;
  name: string;
  keyword: string;
  text: string;
}

const EMPTY: Draft = { name: '', keyword: '', text: '' };

function draftOf(snippet: Snippet): Draft {
  return { id: snippet.id, name: snippet.name, keyword: snippet.keyword ?? '', text: snippet.text };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function SnippetEditor({
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
  const form = useRef<HTMLFormElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const checked = checkSnippet(draft);
    if (checked.problem) {
      setError(capitalized(checked.problem));
      return;
    }
    const result = await api.saveSnippet(draft);
    setState(result.state);
    if (result.error) setError(result.error);
    else onSaved();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (mac ? event.metaKey : event.ctrlKey)) {
      // ↵ starts a new line in the text, so ⌘↵ (Ctrl+Enter) saves from anywhere.
      event.preventDefault();
      form.current?.requestSubmit();
    }
  };

  const title = draft.id ? 'Edit Snippet' : 'New Snippet';
  return (
    <Group title={title}>
      <form ref={form} className="entry-editor" aria-label={title} onSubmit={save} onKeyDown={onKeyDown}>
        <Field label="Name" hint="What you type in the launcher to find it.">
          {(id, hintId) => (
            <input
              id={id}
              className="entry-field__input"
              aria-describedby={hintId}
              value={draft.name}
              placeholder="Email signature"
              autoFocus
              onChange={(event) => change({ name: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Keyword"
          hint={
            <>
              Optional. Type it in the launcher and press {enter} to paste the snippet, like <code>!sig</code>.
            </>
          }
        >
          {(id, hintId) => (
            <input
              id={id}
              className="entry-field__input entry-field__input--code entry-field__input--medium"
              aria-describedby={hintId}
              value={draft.keyword}
              placeholder="!sig"
              spellCheck={false}
              onChange={(event) => change({ keyword: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Text"
          hint={`Pasted just as it is, with the placeholders filled in. ${mac ? '⌘↵' : 'Ctrl+Enter'} saves.`}
        >
          {(id, hintId) => (
            <>
              <textarea
                id={id}
                ref={text}
                className="entry-field__input entry-field__textarea"
                aria-describedby={hintId}
                value={draft.text}
                rows={6}
                placeholder={'Thanks,\nAlex'}
                onChange={(event) => change({ text: event.target.value })}
              />
              <PlaceholderButtons
                names={SNIPPET_PLACEHOLDERS}
                field={text}
                onChange={(value) => change({ text: value })}
              />
            </>
          )}
        </Field>
        <EditorButtons error={error} onCancel={onCancel} />
      </form>
    </Group>
  );
}

/** Settings → Snippets: your snippets, with an editor to add or change one. */
export function SnippetsSection({
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

  // Sent here from the launcher (Create Snippet, or ⌘E on one): open the editor for it, once.
  useEffect(() => {
    if (target?.section !== 'snippets' || handled.current === target) return;
    handled.current = target;
    const snippet = target.edit ? state.snippets.find((s) => s.id === target.edit) : undefined;
    const draft = snippet ? draftOf(snippet) : target.create ? EMPTY : null;
    if (!draft) return;
    setEditing(draft);
    setEditorKey((key) => key + 1);
  }, [target, state.snippets]);

  const remove = async (id: string) => {
    if (editing?.id === id) setEditing(null);
    setState(await api.deleteSnippet(id));
  };

  return (
    <>
      <p className="section__intro">
        Snippets are text you paste often: an address, a reply, a signature. Type a snippet’s name or keyword in the
        launcher and press {enter} to paste it into the app you were in. They’re kept in <code>snippets.json</code> in
        the data folder, and changes to the file show up right away. Waypoint doesn’t expand keywords as you type in
        other apps; type them in the launcher.
      </p>
      {!editing && (
        <div className="button-row button-row--start">
          <Button onClick={() => edit(EMPTY)}>New Snippet</Button>
        </div>
      )}
      {editing && (
        <SnippetEditor
          key={editorKey}
          initial={editing}
          setState={setState}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}
      <Group title="Your snippets">
        {state.snippets.length === 0 ? (
          <p className="group__empty">No snippets yet.</p>
        ) : (
          <ul className="entry-list">
            {state.snippets.map((snippet) => (
              <EntryRow
                key={snippet.id}
                icon={{ builtin: 'text', tint: 'teal' }}
                title={snippet.name}
                subtitle={[snippet.keyword, snippetPreview(snippet.text)].filter(Boolean).join(' · ')}
                onEdit={() => edit(draftOf(snippet))}
                onDelete={() => void remove(snippet.id)}
              />
            ))}
          </ul>
        )}
      </Group>
      <Group title="Placeholders">
        <PlaceholderGuide names={SNIPPET_PLACEHOLDERS} />
      </Group>
    </>
  );
}
