import { describe, expect, it } from 'vitest';
import {
  asPlainPreview,
  batchArgument,
  fileNameFor,
  fillArguments,
  firstLine,
  interpreterFor,
  LANGUAGES,
  lastLine,
  matchScripts,
  mightBeScript,
  parseArgument,
  parseInvocation,
  parseRefreshTime,
  parseScript,
  readHeaders,
  shownForm,
  spawnArgs,
  splitArguments,
  stripAnsi,
  template,
  typedForm,
  usage,
} from './scripts.js';

const RAYCAST_SCRIPT = `#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Search Repos
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.icon images/github.png
# @raycast.packageName Developer Utils
# @raycast.argument1 { "type": "text", "placeholder": "Query", "percentEncoded": true }
# @raycast.argument2 { "type": "dropdown", "placeholder": "Sort", "optional": true, "data": [{ "title": "Stars", "value": "stars" }, { "title": "Updated", "value": "updated" }] }

# Documentation:
# @raycast.description Searches GitHub.
# @raycast.author Alex
# @raycast.authorURL https://github.com/alex

echo "$1"
`;

describe('readHeaders', () => {
  it('reads Raycast and Waypoint headers in any comment style, Waypoint winning', () => {
    const text = ['// @raycast.title From Raycast', '-- @raycast.mode silent', '# @waypoint.title From Waypoint'].join(
      '\n',
    );
    expect(readHeaders(text)).toEqual({ title: 'From Waypoint', mode: 'silent' });
  });

  it('ignores headers that are only mentioned', () => {
    expect(readHeaders('# Add a line like @raycast.title Hello')).toEqual({});
  });
});

describe('parseScript', () => {
  it('reads a script written for Raycast', () => {
    const script = parseScript('/home/alex/scripts/search-repos.sh', RAYCAST_SCRIPT, '/home/alex');
    expect(script).toMatchObject({
      path: '/home/alex/scripts/search-repos.sh',
      title: 'Search Repos',
      mode: 'fullOutput',
      packageName: 'Developer Utils',
      icon: '/home/alex/scripts/images/github.png',
      description: 'Searches GitHub.',
      author: 'Alex',
      authorUrl: 'https://github.com/alex',
      needsConfirmation: false,
    });
    expect(script?.arguments).toEqual([
      { type: 'text', placeholder: 'Query', optional: false, percentEncoded: true },
      {
        type: 'dropdown',
        placeholder: 'Sort',
        optional: true,
        percentEncoded: false,
        options: [
          { title: 'Stars', value: 'stars' },
          { title: 'Updated', value: 'updated' },
        ],
      },
    ]);
  });

  it('fills in what a script leaves out', () => {
    const script = parseScript('/s/x.sh', '# @waypoint.title X\n# @waypoint.icon 🤖\n# @waypoint.mode nonsense', '/h');
    expect(script).toEqual({
      path: '/s/x.sh',
      title: 'X',
      mode: 'compact',
      icon: '🤖',
      needsConfirmation: false,
      arguments: [],
    });
  });

  it('reads where to run, asking first, and how often inline scripts refresh', () => {
    const text = [
      '# @raycast.title Status',
      '# @raycast.mode inline',
      '# @raycast.refreshTime 5m',
      '# @raycast.needsConfirmation true',
      '# @raycast.currentDirectoryPath ~/code',
    ].join('\n');
    expect(parseScript('/s/status.sh', text, '/home/alex')).toMatchObject({
      mode: 'inline',
      refreshSeconds: 300,
      needsConfirmation: true,
      cwd: '/home/alex/code',
    });
  });

  it("skips files that aren't script commands", () => {
    expect(parseScript('/s/notes.sh', 'echo hi', '/h')).toBeUndefined();
    expect(mightBeScript('/s/README.md')).toBe(false);
    expect(mightBeScript('/s/.hidden.sh')).toBe(false);
    expect(mightBeScript('/s/run.sh')).toBe(true);
  });
});

describe('parseArgument', () => {
  it('reads the three kinds, and turns down broken ones', () => {
    expect(parseArgument('{ "type": "password", "placeholder": "Token" }')).toEqual({
      type: 'password',
      placeholder: 'Token',
      optional: false,
      percentEncoded: false,
    });
    expect(parseArgument('{ "placeholder": "" }')?.placeholder).toBe('Value');
    expect(parseArgument('{ "type": "dropdown", "data": [] }')).toBeUndefined();
    expect(parseArgument('not json')).toBeUndefined();
  });
});

describe('parseRefreshTime', () => {
  it('reads Raycast’s refresh times, never under ten seconds', () => {
    expect(parseRefreshTime('1h')).toBe(3600);
    expect(parseRefreshTime('10m')).toBe(600);
    expect(parseRefreshTime('2s')).toBe(10);
    expect(parseRefreshTime('1d')).toBe(86_400);
    expect(parseRefreshTime('soon')).toBeUndefined();
    expect(parseRefreshTime(undefined)).toBeUndefined();
  });
});

describe('interpreterFor', () => {
  it('follows the shebang line', () => {
    expect(interpreterFor('/s/a.py', '#!/usr/bin/env python3 -u\nprint(1)', 'darwin')).toEqual({
      file: '/usr/bin/env',
      args: ['python3', '-u', '/s/a.py'],
    });
  });

  it('goes by the extension without one', () => {
    expect(interpreterFor('/s/a.sh', 'echo 1', 'linux')).toEqual({ file: '/bin/bash', args: ['/s/a.sh'] });
    expect(interpreterFor('/s/a.applescript', 'say "hi"', 'darwin')).toEqual({
      file: 'osascript',
      args: ['/s/a.applescript'],
    });
    expect(interpreterFor('C:\\s\\a.ps1', '#!/usr/bin/env pwsh', 'win32').file).toBe('powershell.exe');
    expect(interpreterFor('C:\\s\\a.cmd', 'echo 1', 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['C:\\s\\a.cmd'],
      batch: true,
    });
  });

  it('runs anything else as it is', () => {
    expect(interpreterFor('/s/tool', '\u007fELF', 'linux')).toEqual({ file: '/s/tool', args: [] });
  });
});

describe('spawnArgs', () => {
  it('adds the arguments after the script', () => {
    expect(spawnArgs({ file: '/bin/bash', args: ['/s/a.sh'] }, ['x y'])).toEqual({
      file: '/bin/bash',
      args: ['/s/a.sh', 'x y'],
      verbatim: false,
    });
  });

  it('builds one escaped command line for a batch file, so cmd.exe runs nothing typed', () => {
    const { file, args, verbatim } = spawnArgs({ file: 'cmd.exe', args: ['C:\\My Scripts\\go.cmd'], batch: true }, [
      'https://x.test/?a=1&b=2',
      'say "hi"',
    ]);
    expect(file).toBe('cmd.exe');
    expect(verbatim).toBe(true);
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(args[3]).toBe(
      '"C:\\My^ Scripts\\go.cmd ^^^"https://x.test/^^^?a=1^^^&b=2^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^""',
    );
  });

  it('quotes batch arguments with backslashes the way programs read them', () => {
    expect(batchArgument('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"');
    // Three backslashes before a quote: six, then the escaped quote.
    expect(batchArgument('a\\\\\\"b')).toBe('^^^"a\\\\\\\\\\\\\\^^^"b^^^"');
  });
});

describe('splitArguments', () => {
  it('splits like a shell, keeping quoted words together', () => {
    expect(splitArguments('100 "US dollars" eur')).toEqual(['100', 'US dollars', 'eur']);
    expect(splitArguments(`it's ''`)).toEqual(['its ']);
    expect(splitArguments('  a   b ')).toEqual(['a', 'b']);
    expect(splitArguments('"" x')).toEqual(['', 'x']);
  });
});

describe('arguments typed after the title', () => {
  const script = /** @type {import('./scripts.js').Script} */ (parseScript('/s/search.sh', RAYCAST_SCRIPT, '/h'));
  const greet = /** @type {import('./scripts.js').Script} */ (
    parseScript('/s/greet.sh', '# @waypoint.title Greet\n# @waypoint.argument1 { "placeholder": "Name" }', '/h')
  );

  it('finds the script being given arguments, the longest title first', () => {
    const search = { ...script, title: 'Search' };
    expect(parseInvocation('Search Repos: waypoint', [search, script])).toEqual({ script, rest: 'waypoint' });
    expect(parseInvocation('search repos', [script])).toBeUndefined();
    expect(parseInvocation('Greet: x', [{ ...greet, arguments: [] }])).toBeUndefined();
  });

  it('takes everything typed as the only argument', () => {
    expect(fillArguments(greet, ' Alex Silver ')).toEqual({
      values: ['Alex Silver'],
      next: 1,
      partial: '',
      complete: true,
    });
    expect(fillArguments(greet, '"quoted name"').values).toEqual(['quoted name']);
    expect(fillArguments(greet, '')).toEqual({ values: [], next: 0, partial: '', complete: false });
  });

  it('splits several, encoding where asked, and waits on a dropdown still being typed', () => {
    expect(fillArguments(script, 'electron apps')).toEqual({
      values: ['electron'],
      next: 1,
      partial: 'apps',
      complete: false,
    });
    expect(fillArguments(script, 'electron apps ').problem).toBe("“apps” isn't one of the choices for Sort.");
    expect(fillArguments(script, '"electron apps" stars')).toEqual({
      values: ['electron%20apps', 'stars'],
      next: 2,
      partial: '',
      complete: true,
    });
    expect(fillArguments(script, 'electron ')).toEqual({ values: ['electron'], next: 1, partial: '', complete: true });
    expect(fillArguments(script, 'electron Updated').values).toEqual(['electron', 'updated']);
  });

  it('shows how to type them, and types them again', () => {
    expect(usage(script)).toBe('Search Repos: <Query> [Sort]');
    expect(typedForm(script, ['electron%20apps', 'stars'])).toBe('"electron apps" stars');
  });

  it('hides passwords when showing arguments', () => {
    const login = /** @type {import('./scripts.js').Script} */ (
      parseScript(
        '/s/login.sh',
        '# @waypoint.title Log In\n# @waypoint.argument1 { "placeholder": "User" }\n# @waypoint.argument2 { "type": "password", "placeholder": "Password" }',
        '/h',
      )
    );
    expect(shownForm(login, ['alex', 'hunter2'])).toBe('alex ••••••');
    expect(typedForm(login, ['alex', 'hunter2'])).toBe('alex hunter2');
  });
});

describe('output', () => {
  it('reads the first and last lines, without colours', () => {
    const output = '\u001b[32mStarting\u001b[0m\n\n  Done: 3 files  \n\n';
    expect(stripAnsi(output)).toBe('Starting\n\n  Done: 3 files  \n\n');
    expect(firstLine(output)).toBe('Starting');
    expect(lastLine(output)).toBe('Done: 3 files');
    expect(lastLine('')).toBe('');
  });

  it('keeps output looking as printed in the preview', () => {
    expect(asPlainPreview('# not a heading\n- not a bullet\ntext')).toBe(
      '\u200b# not a heading\n\u200b- not a bullet\ntext',
    );
    expect(asPlainPreview('abcdef', 4)).toBe('…def');
  });
});

describe('new scripts', () => {
  it('names the file after the title', () => {
    expect(fileNameFor('Open Jira Ticket!', '.sh')).toBe('open-jira-ticket.sh');
    expect(fileNameFor('Café ☕', '.py')).toBe('cafe.py');
    expect(fileNameFor('!!!', '.sh')).toBe('script.sh');
  });

  it('writes a template its own reader understands', () => {
    for (const language of LANGUAGES) {
      const text = template(language, 'Say "Hi"');
      const script = parseScript(`/s/new${language.extension}`, text, '/h');
      expect(script?.title).toBe('Say "Hi"');
      expect(script?.mode).toBe('compact');
      expect(script?.arguments).toEqual([]);
      // The example argument works once one comment character is taken off.
      const marker = `${language.comment}${language.comment[0]} @waypoint`;
      const withArgument = parseScript('/s/x', text.replace(marker, `${language.comment} @waypoint`), '/h');
      expect(withArgument?.arguments.map((argument) => argument.placeholder)).toEqual(['Name']);
    }
  });
});

describe('matchScripts', () => {
  const scripts = [
    { title: 'Toggle Wi-Fi', packageName: 'System', description: 'Turns Wi-Fi on or off' },
    { title: 'Open Wiki', packageName: 'Work', description: '' },
    { title: 'Weather', packageName: 'Info', description: 'Shows the wind' },
  ].map(
    (each, index) =>
      /** @type {import('./scripts.js').Script} */ ({
        ...each,
        path: `/s/${index}`,
        mode: 'compact',
        needsConfirmation: false,
        arguments: [],
      }),
  );

  it('matches titles first, then packages and descriptions', () => {
    expect(matchScripts(scripts, 'wi').map((script) => script.title)).toEqual(['Toggle Wi-Fi', 'Open Wiki', 'Weather']);
    expect(matchScripts(scripts, 'open wiki').map((script) => script.title)).toEqual(['Open Wiki']);
    expect(matchScripts(scripts, 'work').map((script) => script.title)).toEqual(['Open Wiki']);
    expect(matchScripts(scripts, '')).toHaveLength(3);
  });
});
