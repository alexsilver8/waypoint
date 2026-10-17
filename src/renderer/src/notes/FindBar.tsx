import { type Editor, useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { findNext, findState, replaceAll, replaceMatch, setFindQuery } from './find';

/**
 * Find in Note (⌘F): ↵ goes to the next match and ⇧↵ to the previous one; replace swaps the
 * match you're on, or all of them. Esc closes it and goes back to the note.
 */
export function FindBar({
  editor,
  focusRequest,
  onClose,
}: {
  editor: Editor;
  /** Bump to put the cursor back in the find field, as ⌘F does while it's open. */
  focusRequest: number;
  onClose(): void;
}) {
  const [query, setQuery] = useState(() => {
    // What's selected is what you want to find, if it's a short piece of one line.
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
    return selected && !selected.includes('\n') && selected.length <= 100 ? selected : '';
  });
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const { count, index } = useEditorState({ editor, selector: ({ editor: e }) => findState(e) });

  useEffect(() => {
    setFindQuery(editor, query);
  }, [editor, query]);
  // Closing clears the highlights.
  useEffect(() => () => setFindQuery(editor, ''), [editor]);

  // Every ⌘F, including the first, puts the cursor in the field.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [focusRequest]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, replaceField: boolean) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (replaceField) replaceMatch(editor, replacement);
      else findNext(editor, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <search className="find" aria-label="Find in Note">
      <div className="find__row">
        <Search className="find__icon" size={14} aria-hidden="true" />
        <input
          ref={field}
          className="find__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => onKeyDown(event, false)}
          placeholder="Find in note..."
          aria-label="Find in note"
          spellCheck={false}
        />
        <span className="find__count" aria-live="polite">
          {query ? (count ? `${index + 1} of ${count}` : 'No results') : ''}
        </span>
        <button
          type="button"
          className="find__button"
          aria-label="Previous match"
          title="Previous match (⇧↵)"
          disabled={count === 0}
          onClick={() => findNext(editor, -1)}
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          className="find__button"
          aria-label="Next match"
          title="Next match (↵)"
          disabled={count === 0}
          onClick={() => findNext(editor, 1)}
        >
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          className="find__button"
          aria-label="Replace"
          title="Replace"
          aria-pressed={replacing}
          onClick={() => setReplacing(!replacing)}
        >
          <Replace size={15} />
        </button>
        <button type="button" className="find__button" aria-label="Done" title="Done (esc)" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {replacing && (
        <div className="find__row">
          <span className="find__icon" aria-hidden="true" />
          <input
            className="find__input"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => onKeyDown(event, true)}
            placeholder="Replace with..."
            aria-label="Replace with"
            spellCheck={false}
          />
          <button
            type="button"
            className="find__text-button"
            disabled={count === 0 || !editor.isEditable}
            onClick={() => replaceMatch(editor, replacement)}
          >
            Replace
          </button>
          <button
            type="button"
            className="find__text-button"
            disabled={count === 0 || !editor.isEditable}
            onClick={() => replaceAll(editor, replacement)}
          >
            All
          </button>
        </div>
      )}
    </search>
  );
}
