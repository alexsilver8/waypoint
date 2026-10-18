/** Pieces shared by the Quicklinks and Snippets sections: the editor's fields, and the list. */
import { type ReactNode, type RefObject, useId } from 'react';
import { flushSync } from 'react-dom';
import type { PlaceholderName } from '../../../shared/placeholders';
import type { Icon } from '../../../shared/types';
import { ItemIcon } from '../components/ItemIcon';
import { Button, ConfirmButton } from './controls';
import './entries.css';

/** A labelled field of the editor. `children` gets the id to put on its control. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children(id: string, hintId: string | undefined): ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="entry-field">
      <label className="entry-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="entry-field__control">
        {children(id, hintId)}
        {hint && (
          <p id={hintId} className="entry-field__hint">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;

/** Puts `text` where the caret is in a field, through its `onChange` so React keeps the value. */
function insertAt(field: TextControl, text: string, onChange: (value: string) => void) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  // Rendered now, so the caret goes after the text straight away. Waiting a frame for it would
  // take the keyboard back from a field clicked in the meantime, and type into this one.
  flushSync(() => onChange(field.value.slice(0, start) + text + field.value.slice(end)));
  field.focus();
  field.setSelectionRange(start + text.length, start + text.length);
}

/** Buttons that type a placeholder into a field, under it. */
export function PlaceholderButtons({
  names,
  field,
  onChange,
}: {
  names: readonly PlaceholderName[];
  field: RefObject<TextControl | null>;
  onChange(value: string): void;
}) {
  return (
    <fieldset className="placeholder-buttons" aria-label="Insert a placeholder">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className="placeholder-buttons__button"
          // Keeps the caret where it is in the field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (field.current) insertAt(field.current, `{${name}}`, onChange);
          }}
        >
          {`{${name}}`}
        </button>
      ))}
    </fieldset>
  );
}

const PLACEHOLDER_HELP: Record<PlaceholderName, ReactNode> = {
  argument: (
    <>
      What you type after its name: “gh waypoint” opens it with “waypoint”. Add <code>default="…"</code> for when
      nothing is typed.
    </>
  ),
  clipboard: 'The text you copied last.',
  date: (
    <>
      Today’s date. Add <code>format="yyyy-MM-dd"</code> for another format, or <code>offset="+1d"</code> for another
      day.
    </>
  ),
  time: 'The time now. Takes a format and an offset too.',
  datetime: 'The date and time together.',
  uuid: 'A new random ID each time.',
};

/** What each placeholder puts in, as a card of rows. */
export function PlaceholderGuide({ names }: { names: readonly PlaceholderName[] }) {
  return (
    <dl className="placeholder-guide">
      {names.map((name) => (
        <div key={name} className="placeholder-guide__row">
          <dt>
            <code>{`{${name}}`}</code>
          </dt>
          <dd>{PLACEHOLDER_HELP[name]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One quicklink or snippet in the list, with buttons to edit and delete it. */
export function EntryRow({
  icon,
  title,
  subtitle,
  onEdit,
  onDelete,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <li className="entry">
      <ItemIcon icon={icon} />
      <div className="entry__text">
        <span className="entry__title">{title}</span>
        <span className="entry__subtitle" title={subtitle}>
          {subtitle}
        </span>
      </div>
      <div className="button-row">
        <Button onClick={onEdit}>Edit</Button>
        <ConfirmButton confirm="Click again to delete" onConfirm={onDelete}>
          Delete
        </ConfirmButton>
      </div>
    </li>
  );
}

/** Save and Cancel, and why it couldn't be saved. */
export function EditorButtons({ error, onCancel }: { error: string | null; onCancel(): void }) {
  return (
    <div className="entry-editor__footer">
      {error && (
        <p className="entry-editor__error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button onClick={onCancel}>Cancel</Button>
        <button type="submit" className="button" data-tone="primary">
          Save
        </button>
      </div>
    </div>
  );
}
