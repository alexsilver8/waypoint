import { describe, expect, it } from 'vitest';
import { field, formValues } from './fields';
import { Icon } from './icons';

describe('field', () => {
  it('builds text fields with their options', () => {
    expect(field.text('name', 'Name', { placeholder: 'Ada', required: true, info: 'Your name' })).toEqual({
      type: 'text',
      id: 'name',
      title: 'Name',
      placeholder: 'Ada',
      required: true,
      info: 'Your name',
    });
    expect(field.password('token', 'Token')).toEqual({ type: 'password', id: 'token', title: 'Token' });
    expect(field.textarea('notes', 'Notes', { defaultValue: 'Hi' })).toEqual({
      type: 'textarea',
      id: 'notes',
      title: 'Notes',
      defaultValue: 'Hi',
    });
  });

  it('builds a checkbox', () => {
    expect(field.checkbox('private', 'Visibility', { label: 'Private', defaultValue: true })).toEqual({
      type: 'checkbox',
      id: 'private',
      title: 'Visibility',
      label: 'Private',
      defaultValue: true,
    });
  });

  it('builds a dropdown from strings or from choices', () => {
    expect(field.dropdown('unit', 'Unit', ['px', 'rem'], { defaultValue: 'rem' })).toEqual({
      type: 'dropdown',
      id: 'unit',
      title: 'Unit',
      defaultValue: 'rem',
      options: [
        { value: 'px', title: 'px' },
        { value: 'rem', title: 'rem' },
      ],
    });
    const choice = { value: 'de', title: 'German', icon: Icon.emoji('🇩🇪') };
    const dropdown = field.dropdown('lang', 'Language', [choice]);
    expect(dropdown.options).toEqual([choice]);
    expect(dropdown.options[0]).not.toBe(choice);
  });

  it('builds text between fields, and a separator', () => {
    expect(field.description('Saved to your bookmarks.')).toEqual({
      type: 'description',
      text: 'Saved to your bookmarks.',
    });
    expect(field.description('Text', 'About')).toEqual({ type: 'description', title: 'About', text: 'Text' });
    expect(field.separator()).toEqual({ type: 'separator' });
  });

  it('leaves out options that are undefined', () => {
    expect(Object.keys(field.text('a', 'A', { placeholder: undefined }))).toEqual(['type', 'id', 'title']);
  });
});

describe('formValues', () => {
  it('keeps strings and booleans', () => {
    expect(formValues({ name: 'Ada', private: true })).toEqual({ name: 'Ada', private: true });
  });

  it('leaves out anything else', () => {
    expect(formValues({ name: 'Ada', count: 3, list: ['a'], nested: { a: 'b' }, none: null })).toEqual({
      name: 'Ada',
    });
    expect(formValues(undefined)).toEqual({});
    expect(formValues('text')).toEqual({});
    expect(formValues(['a'])).toEqual({});
    expect(formValues(null)).toEqual({});
  });
});
