// What the builders make is what the launcher takes: its validation keeps all of it, as is.
import { describe, expect, it } from 'vitest';
import { sanitizeAction, sanitizeIcon, sanitizeView } from '../../../src/main/extensions/validate';
import { Action } from './actions';
import { Icon } from './icons';
import { item, list, metadata } from './views';

describe("the launcher's validation", () => {
  it('keeps every action as built', () => {
    for (const action of [
      Action.copy('a', { title: 'Copy', shortcut: 'mod+shift+c' }),
      Action.paste('a'),
      Action.openUrl('https://example.com', { shortcut: 'mod+o' }),
      Action.openPath('/tmp'),
      Action.revealPath('/tmp'),
      Action.openCommand({ extension: 'disk-usage', command: 'usage' }, { argument: '~' }),
      Action.callback('stop', 'Stop', { payload: { pid: 42 }, style: 'destructive', shortcut: 'mod+Backspace' }),
    ]) {
      expect(sanitizeAction(action)).toEqual(action);
    }
  });

  it('keeps every icon as built', () => {
    for (const icon of [Icon.builtin('globe', 'blue'), Icon.builtin('plug'), Icon.emoji('🎲'), Icon.path('/tmp')]) {
      expect(sanitizeIcon(icon)).toEqual(icon);
    }
  });

  it('keeps a list as built', () => {
    const view = list({
      title: 'Ports',
      searchPlaceholder: 'Search ports…',
      filtering: false,
      sections: [
        {
          title: 'Listening',
          items: [
            item({
              id: '3000',
              title: 'Port 3000',
              subtitle: 'node',
              accessory: 'PID 42',
              icon: Icon.builtin('plug', 'teal'),
              keywords: ['3000', ':3000'],
              detail: { title: 'node on port 3000', body: 'node server.js', metadata: metadata({ Port: 3000 }) },
              actions: [Action.openUrl('http://localhost:3000'), Action.copy('3000')],
            }),
          ],
        },
      ],
    });
    expect(sanitizeView(view)).toEqual(view);
  });
});
