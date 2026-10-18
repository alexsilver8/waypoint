/** What the launcher keeps track of for a form: its values, what's missing, and its submit action. */
import type { Action, FormField, FormValues, FormView } from '../../shared/types';

/** A field that has a value, as opposed to a description or a separator. */
export type ValueField = Extract<FormField, { id: string }>;

/** What a form's frame remembers while it's open, so a view opened on top and closed again keeps it. */
export interface FormState {
  values: FormValues;
  /** Submitting was tried with a required field empty: those fields say so until filled in. */
  showMissing: boolean;
}

export function isValueField(field: FormField): field is ValueField {
  return 'id' in field;
}

function initialValue(field: ValueField): string | boolean {
  switch (field.type) {
    case 'checkbox':
      return field.defaultValue ?? false;
    case 'dropdown':
      return field.defaultValue ?? field.options[0]?.value ?? '';
    default:
      return field.defaultValue ?? '';
  }
}

/**
 * Every field's value: what was typed or picked, or its default, of the kind the field submits
 * (a boolean for a checkbox, a string for the rest).
 */
export function formValues(view: FormView, values?: FormValues): FormValues {
  return Object.fromEntries(
    view.fields.filter(isValueField).map((field) => {
      const value = values && Object.hasOwn(values, field.id) ? values[field.id] : undefined;
      const kind = field.type === 'checkbox' ? 'boolean' : 'string';
      return [field.id, typeof value === kind ? (value as string | boolean) : initialValue(field)];
    }),
  );
}

/** The ids of the required fields that are empty, in order. Only spaces counts as empty. */
export function missingFields(view: FormView, values: FormValues): string[] {
  return view.fields
    .filter(isValueField)
    .filter((field) => 'required' in field && field.required)
    .filter((field) => {
      const value = values[field.id];
      return typeof value !== 'string' || value.trim() === '';
    })
    .map((field) => field.id);
}

const submits = new WeakSet<Action>();

/**
 * The action that submits a form, first in its action panel: a callback to the command with the
 * submit id. The values are added when it runs.
 */
export function submitAction(view: FormView): Action {
  const action: Action = { type: 'callback', id: view.submit.id, title: view.submit.title ?? 'Submit' };
  submits.add(action);
  return action;
}

export function isSubmitAction(action: Action): boolean {
  return submits.has(action);
}
