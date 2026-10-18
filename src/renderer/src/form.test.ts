import { describe, expect, it } from 'vitest';
import type { FormView } from '../../shared/types';
import { formValues, isSubmitAction, missingFields, submitAction } from './form';
import { pageItem } from './model';

const view: FormView = {
  type: 'form',
  title: 'New Quicklink',
  submit: { id: 'create', title: 'Create Quicklink' },
  actions: [{ type: 'open-url', url: 'https://example.com', title: 'Help' }],
  fields: [
    { type: 'text', id: 'name', title: 'Name', required: true },
    { type: 'textarea', id: 'notes', title: 'Notes', defaultValue: 'Hi' },
    { type: 'password', id: 'token', title: 'Token', required: true, defaultValue: 'secret' },
    { type: 'separator' },
    { type: 'checkbox', id: 'pinned', title: 'Pinned' },
    { type: 'checkbox', id: 'shared', title: 'Shared', defaultValue: true },
    {
      type: 'dropdown',
      id: 'browser',
      title: 'Browser',
      options: [
        { value: 'default', title: 'Default' },
        { value: 'firefox', title: 'Firefox' },
      ],
    },
    {
      type: 'dropdown',
      id: 'theme',
      title: 'Theme',
      defaultValue: 'dark',
      options: [{ value: 'dark', title: 'Dark' }],
    },
    { type: 'description', text: 'Use {query} for what you type.' },
  ],
};

describe('formValues', () => {
  it('starts from the defaults: empty, unchecked, or the first option', () => {
    expect(formValues(view)).toEqual({
      name: '',
      notes: 'Hi',
      token: 'secret',
      pinned: false,
      shared: true,
      browser: 'default',
      theme: 'dark',
    });
  });

  it('keeps what was typed or picked, of the kind each field submits', () => {
    expect(
      formValues(view, { name: 'GitHub', pinned: true, browser: 'firefox', notes: 7 as never, stray: 'x' }),
    ).toEqual({
      name: 'GitHub',
      notes: 'Hi',
      token: 'secret',
      pinned: true,
      shared: true,
      browser: 'firefox',
      theme: 'dark',
    });
  });

  it('only takes values that belong to the form', () => {
    const tricky: FormView = { ...view, fields: [{ type: 'text', id: 'constructor', title: 'C' }] };
    expect(formValues(tricky, {})).toEqual({ constructor: '' });
  });
});

describe('missingFields', () => {
  it('lists the required fields left empty or only spaces', () => {
    expect(missingFields(view, formValues(view))).toEqual(['name']);
    expect(missingFields(view, formValues(view, { name: '   ', token: '' }))).toEqual(['name', 'token']);
    expect(missingFields(view, formValues(view, { name: 'GitHub' }))).toEqual([]);
  });
});

describe('submitAction', () => {
  it('is a callback with the submit id, told apart from the other actions', () => {
    const submit = submitAction(view);
    expect(submit).toEqual({ type: 'callback', id: 'create', title: 'Create Quicklink' });
    expect(isSubmitAction(submit)).toBe(true);
    expect(isSubmitAction({ type: 'callback', id: 'create', title: 'Create Quicklink' })).toBe(false);
    expect(submitAction({ ...view, submit: { id: 'go' } }).title).toBe('Submit');
  });
});

describe('pageItem', () => {
  it('puts the submit action first for a form', () => {
    const item = pageItem(view, 'New Quicklink');
    expect(item?.actions.map((action) => action.title)).toEqual(['Create Quicklink', 'Help']);
    expect(item && isSubmitAction(item.actions[0] as never)).toBe(true);
  });

  it('has a detail view’s own actions, and nothing for a list', () => {
    expect(pageItem({ type: 'detail', markdown: '' }, 'Readme')).toEqual({
      id: 'detail',
      title: 'Readme',
      actions: [],
    });
    expect(pageItem({ type: 'list', sections: [] }, 'List')).toBeUndefined();
  });
});
