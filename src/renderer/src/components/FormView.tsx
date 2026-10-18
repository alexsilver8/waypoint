import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useImperativeHandle, useRef } from 'react';
import type { FormField, FormValues, FormView as FormViewData } from '../../../shared/types';
import { isValueField } from '../form';
import { Dropdown } from './Dropdown';

/** What the launcher asks of an open form. */
export interface FormHandle {
  /** Focuses the field that last had the keyboard, or the first one; `false` when there's none. */
  focus(): boolean;
  focusField(id: string): void;
}

interface FormViewProps {
  ref?: Ref<FormHandle>;
  view: FormViewData;
  values: FormValues;
  /** The ids of the required fields to mark as missing. */
  missing: string[];
  onChange(id: string, value: string | boolean): void;
  onSubmit(): void;
  /** Keys the fields don't use themselves, for the launcher: ⌘↵, ⌘K, Esc and the actions' shortcuts. */
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

const CONTROL = '[data-field-control]';

/**
 * A form drawn with the launcher's own controls: a label beside each field, its hint and what's
 * missing under it. ⇥ and ⇧⇥ go round the fields; ↵ in a one-line field submits, as ⌘↵ does
 * anywhere.
 */
export function FormView({ ref, view, values, missing, onChange, onSubmit, onKeyDown }: FormViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const prefix = useId();
  const domId = (index: number) => `${prefix}-field-${index}`;

  const controls = () => [...(root.current?.querySelectorAll<HTMLElement>(CONTROL) ?? [])];
  const focusControl = (control: HTMLElement | null | undefined): boolean => {
    if (!control) return false;
    control.focus();
    // In a text field, the caret goes after what's there.
    if (
      control instanceof HTMLTextAreaElement ||
      (control instanceof HTMLInputElement && control.type !== 'checkbox')
    ) {
      control.setSelectionRange(control.value.length, control.value.length);
    }
    return true;
  };

  useImperativeHandle(ref, () => ({
    focus() {
      const remembered = last.current ? document.getElementById(last.current) : null;
      return focusControl(remembered && root.current?.contains(remembered) ? remembered : controls()[0]);
    },
    focusField(id) {
      const index = view.fields.findIndex((field) => isValueField(field) && field.id === id);
      if (index >= 0) focusControl(document.getElementById(domId(index)));
    },
  }));

  // The first field has the keyboard when a form opens, or another one takes its place.
  useEffect(() => {
    last.current = null;
    focusControl(controls()[0]);
  }, [view]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Round the fields and nothing else, so the keyboard stays in the form.
      const all = controls();
      if (all.length === 0) return;
      event.preventDefault();
      const at = all.indexOf(target);
      const step = event.shiftKey ? -1 : 1;
      focusControl(all[(at + step + all.length) % all.length]);
    } else if (event.key === 'Enter' && plain && target.dataset.submitOnEnter !== undefined) {
      event.preventDefault();
      if (!event.repeat) onSubmit();
    } else {
      onKeyDown(event);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: handles the keys of the fields inside it
    <div
      ref={root}
      className="form"
      onKeyDown={keyDown}
      onFocus={(event) => {
        if (event.target.matches(CONTROL)) last.current = event.target.id;
      }}
    >
      <div className="form__fields">
        {view.fields.map((field, index) => (
          <Field
            // Fields are told apart by their place: a form's fields don't move.
            key={index}
            field={field}
            domId={domId(index)}
            value={isValueField(field) ? values[field.id] : undefined}
            missing={isValueField(field) && missing.includes(field.id)}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

interface FieldProps {
  field: FormField;
  domId: string;
  value: string | boolean | undefined;
  missing: boolean;
  onChange(id: string, value: string | boolean): void;
}

function Field({ field, domId, value, missing, onChange }: FieldProps) {
  if (field.type === 'separator') return <hr className="form__separator" />;
  if (field.type === 'description') {
    return (
      <div className="form__row form__row--description">
        <span className="form__label">{field.title}</span>
        <p className="form__description">{field.text}</p>
      </div>
    );
  }

  const labelId = `${domId}-label`;
  const infoId = `${domId}-info`;
  const errorId = `${domId}-error`;
  const describedBy = [missing && errorId, field.info && infoId].filter(Boolean).join(' ') || undefined;
  const text = typeof value === 'string' ? value : '';

  let control: ReactNode;
  switch (field.type) {
    case 'text':
    case 'password':
      control = (
        <input
          id={domId}
          className="form__input"
          type={field.type}
          value={text}
          placeholder={field.placeholder}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={missing || undefined}
          aria-required={field.required || undefined}
          spellCheck={false}
          autoComplete="off"
          data-field-control=""
          data-submit-on-enter=""
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      );
      break;
    case 'textarea':
      control = (
        <textarea
          id={domId}
          className="form__input form__input--area"
          value={text}
          rows={4}
          placeholder={field.placeholder}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={missing || undefined}
          aria-required={field.required || undefined}
          spellCheck={false}
          data-field-control=""
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      );
      break;
    case 'checkbox':
      control = (
        <label className="form__check">
          <input
            id={domId}
            className="form__checkbox"
            type="checkbox"
            checked={value === true}
            aria-labelledby={field.label ? `${labelId} ${domId}-text` : labelId}
            aria-describedby={describedBy}
            data-field-control=""
            onChange={(event) => onChange(field.id, event.target.checked)}
          />
          {field.label && <span id={`${domId}-text`}>{field.label}</span>}
        </label>
      );
      break;
    case 'dropdown':
      control = (
        <Dropdown
          id={domId}
          options={field.options}
          value={text}
          labelledBy={labelId}
          describedBy={describedBy}
          onChange={(next) => onChange(field.id, next)}
        />
      );
      break;
  }

  return (
    <div className="form__row" data-type={field.type}>
      <label id={labelId} className="form__label" htmlFor={domId}>
        {field.title}
      </label>
      <div className="form__control">
        {control}
        {missing && (
          <p id={errorId} className="form__error">
            {field.title ? `${field.title} is required` : 'Required'}
          </p>
        )}
        {field.info && (
          <p id={infoId} className="form__info">
            {field.info}
          </p>
        )}
      </div>
    </div>
  );
}
