import { compact } from './internal';
import type { FormField, FormValues, Json } from './types';

/** The members of the union `U` whose `type` can be `T`. */
type MemberOfType<U, T> = U extends { type: infer K } ? (T extends K ? U : never) : never;
/** `Omit` for each member of a union on its own, so every member keeps its own fields. */
type OmitEach<U, K extends PropertyKey> = U extends unknown ? Omit<U, K> : never;

/** A form field whose `type` is `T`, e.g. `FieldOf<'checkbox'>`. */
export type FieldOf<T extends FormField['type']> = MemberOfType<FormField, T>;

/** What a field takes besides its id and title: `info`, and that field's own options. */
export type FieldOptions<T extends FormField['type']> = OmitEach<FieldOf<T>, 'type' | 'id' | 'title'>;

/** One of a dropdown's choices: `{ value, title, icon? }`, or just a string for both. */
export type DropdownChoice = FieldOf<'dropdown'>['options'][number] | string;

/**
 * Builds form fields. Each returns the plain object, so `field.text('url', 'URL')` and
 * `{ type: 'text', id: 'url', title: 'URL' }` are the same. A field's `id` is the key of its
 * value in what the form submits.
 */
export const field: {
  /** A line of text: `field.text('name', 'Name', { placeholder: 'Ada', required: true })`. */
  text(id: string, title: string, options?: FieldOptions<'text'>): FieldOf<'text'>;
  /** A line of text that's hidden as it's typed. */
  password(id: string, title: string, options?: FieldOptions<'password'>): FieldOf<'password'>;
  /** Several lines of text. */
  textarea(id: string, title: string, options?: FieldOptions<'textarea'>): FieldOf<'textarea'>;
  /** A checkbox, submitted as `true` or `false`; `options.label` is shown beside the box. */
  checkbox(id: string, title: string, options?: FieldOptions<'checkbox'>): FieldOf<'checkbox'>;
  /**
   * A choice of one: `field.dropdown('unit', 'Unit', ['px', 'rem'])`, or choices with a title
   * and icon of their own. The first one is picked unless `options.defaultValue` says otherwise.
   */
  dropdown(
    id: string,
    title: string,
    choices: ReadonlyArray<DropdownChoice>,
    options?: Omit<FieldOptions<'dropdown'>, 'options'>,
  ): FieldOf<'dropdown'>;
  /** Text between fields, e.g. what the form is for. It has no value. */
  description(text: string, title?: string): FieldOf<'description'>;
  /** A line between groups of fields. */
  separator(): FieldOf<'separator'>;
} = {
  text: (id, title, options) => compact({ type: 'text', id, title, ...options }),
  password: (id, title, options) => compact({ type: 'password', id, title, ...options }),
  textarea: (id, title, options) => compact({ type: 'textarea', id, title, ...options }),
  checkbox: (id, title, options) => compact({ type: 'checkbox', id, title, ...options }),
  dropdown: (id, title, choices, options) =>
    compact({
      type: 'dropdown',
      id,
      title,
      ...options,
      options: choices.map((choice) => (typeof choice === 'string' ? { value: choice, title: choice } : { ...choice })),
    }),
  description: (text, title) => compact({ type: 'description', title, text }),
  separator: () => ({ type: 'separator' }),
};

/**
 * The values a form submitted, from the `payload` its `onAction` gets: each field's id to a
 * string, or a boolean for a checkbox. Anything else in the payload is left out, so this is
 * safe to call with whatever arrived.
 */
export function formValues(payload: Json | undefined): FormValues {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  const values: FormValues = {};
  for (const [id, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'boolean') values[id] = value;
  }
  return values;
}
