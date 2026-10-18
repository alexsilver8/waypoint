import { describe, expect, it } from 'vitest';
import type { View } from '../../shared/types';
import { filterView, pushedView, secondaryAction } from './model';

describe('secondaryAction', () => {
  it('is the second action, unless that one is only for the action panel', () => {
    const open = { type: 'open-url' as const, url: 'https://example.com' };
    const copy = { type: 'copy' as const, text: 'x' };
    expect(secondaryAction({ id: 'a', title: 'A', actions: [open, copy] })).toBe(copy);
    expect(secondaryAction({ id: 'a', title: 'A', actions: [open, { ...copy, panelOnly: true }] })).toBeUndefined();
    expect(secondaryAction({ id: 'a', title: 'A', actions: [open] })).toBeUndefined();
  });
});

describe('pushedView', () => {
  it('leaves out what would ask the command’s view() for it again', () => {
    expect(pushedView({ type: 'detail', title: 'Working', markdown: 'Working it out…', loading: true })).toEqual({
      type: 'detail',
      title: 'Working',
      markdown: 'Working it out…',
    });
    const list: View = {
      type: 'list',
      title: 'Branches',
      filtering: false,
      loading: true,
      sections: [{ items: [{ id: 'main', title: 'main', actions: [] }] }],
    };
    expect(pushedView(list)).toEqual({ type: 'list', title: 'Branches', sections: list.sections });
  });

  it('has the launcher filter a list that would filter itself', () => {
    const list = pushedView({
      type: 'list',
      filtering: false,
      sections: [
        {
          items: [
            { id: 'a', title: 'Apples', actions: [] },
            { id: 'b', title: 'Pears', actions: [] },
          ],
        },
      ],
    });
    expect(list.type === 'list' && filterView(list, 'pea')[0]?.items.map((item) => item.id)).toEqual(['b']);
  });

  it('keeps a form as it is', () => {
    const form: View = { type: 'form', fields: [], submit: { id: 'save' } };
    expect(pushedView(form)).toBe(form);
  });
});
