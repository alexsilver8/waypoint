import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { decodeEntities, imageSource, linkTarget, Markdown } from './markdown';

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source, onOpenLink: () => {} }));

describe('Markdown', () => {
  it('draws headings, emphasis, code and quotes', () => {
    expect(html('# Title\n\n## Part *one*\n\n**bold**, _em_, ~~gone~~ and `a < b`')).toBe(
      '<div class="markdown"><h1>Title</h1><h2>Part <em>one</em></h2>' +
        '<p><strong>bold</strong>, <em>em</em>, <del>gone</del> and <code>a &lt; b</code></p></div>',
    );
    expect(html('> quoted\n\n---')).toBe('<div class="markdown"><blockquote><p>quoted</p></blockquote><hr/></div>');
  });

  it('keeps a fenced code block as written, with its language', () => {
    expect(html('```js\nconst x = 1 < 2;\n  indented\n```')).toBe(
      '<div class="markdown"><pre data-lang="js"><code>const x = 1 &lt; 2;\n  indented</code></pre></div>',
    );
  });

  it('draws lists, numbered lists from where they start, and task lists', () => {
    expect(html('- one\n- two\n  - nested')).toBe(
      '<div class="markdown"><ul><li><span>one</span></li><li><span>two</span><ul><li><span>nested</span></li></ul></li></ul></div>',
    );
    expect(html('3. three\n4. four')).toContain('<ol start="3">');
    expect(html('1. one')).toContain('<ol><li>');
    const tasks = html('- [ ] to do\n- [x] done');
    expect(tasks).toContain('<li class="markdown__task"><span class="markdown__box" aria-hidden="true"></span>');
    expect(tasks).toContain('<span class="visually-hidden">To do: </span>');
    expect(tasks).toContain(
      '<li class="markdown__task" data-checked="true"><span class="markdown__box" data-checked="true"',
    );
    expect(tasks).toContain('<span class="visually-hidden">Done: </span><span>done</span>');
  });

  it('draws tables with their alignment', () => {
    expect(html('| Name | Size |\n| :--- | ---: |\n| a.txt | 2 KB |')).toBe(
      '<div class="markdown"><div class="markdown__table"><table><thead><tr>' +
        '<th style="text-align:left">Name</th><th style="text-align:right">Size</th></tr></thead>' +
        '<tbody><tr><td style="text-align:left">a.txt</td><td style="text-align:right">2 KB</td></tr></tbody>' +
        '</table></div></div>',
    );
  });

  it('shows raw HTML as text', () => {
    const page = html(
      '<script>alert(1)</script>\n\nSome <b onclick="x()">bold</b> text\n\n<img src=x onerror=alert(1)>',
    );
    expect(page).not.toContain('<script');
    expect(page).not.toContain('<b ');
    expect(page).not.toContain('<img');
    expect(page).toContain('<p class="markdown__html">&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(page).toContain('Some &lt;b onclick=&quot;x()&quot;&gt;bold&lt;/b&gt; text');
  });

  it('makes links of URLs only', () => {
    expect(html('[Docs](https://example.com/docs "The docs")')).toBe(
      '<div class="markdown"><p><a href="https://example.com/docs" title="The docs" draggable="false">Docs</a></p></div>',
    );
    expect(html('<https://auto.link>')).toContain('<a href="https://auto.link/"');
    expect(html('[run](javascript:alert(1))')).toBe('<div class="markdown"><p><span>run</span></p></div>');
    expect(html('[here](docs/readme.md) [top](#top)')).not.toContain('<a');
  });

  it('shows images from https and absolute paths, and the alt text for others', () => {
    expect(html('![Logo](https://example.com/logo.png)')).toContain(
      '<img src="https://example.com/logo.png" alt="Logo" loading="lazy" draggable="false" referrerPolicy="no-referrer"/>',
    );
    expect(html('![Shot](/Users/me/shot.png)')).toContain(
      `src="palette-icon://icon?path=${encodeURIComponent('/Users/me/shot.png')}"`,
    );
    expect(html('![Tracker](http://example.com/pixel.gif)')).toBe(
      '<div class="markdown"><p><span class="markdown__alt">Tracker</span></p></div>',
    );
  });

  it('turns entities into characters and keeps escapes', () => {
    expect(html('Fish &amp; chips &copy; 2026 &#x1F600; \\*not em\\*')).toBe(
      '<div class="markdown"><p>Fish &amp; chips © 2026 😀 *not em*</p></div>',
    );
  });

  it('leaves out link definitions and uses them', () => {
    expect(html('See [the site][site].\n\n[site]: https://example.com')).toBe(
      '<div class="markdown"><p>See <a href="https://example.com/" title="https://example.com/" draggable="false">the site</a>.</p></div>',
    );
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &lt;b&gt; &quot;c&quot; &#169; &#X41;')).toBe('a <b> "c" © A');
  });

  it('leaves unknown names, and replaces code points that cannot be shown', () => {
    expect(decodeEntities('&bogus; &#0; &#xD800; &')).toBe('&bogus; \ufffd \ufffd &');
  });
});

describe('linkTarget', () => {
  it('accepts web pages and email, as a note does', () => {
    expect(linkTarget('https://example.com')).toBe('https://example.com/');
    expect(linkTarget('http://example.com/a b')).toBe('http://example.com/a%20b');
    expect(linkTarget('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(linkTarget('HTTPS://Example.com')).toBe('https://example.com/');
    expect(linkTarget('https://example.com/?a=1&amp;b=2')).toBe('https://example.com/?a=1&b=2');
  });

  it('refuses every other kind of link, which could run something with one click', () => {
    for (const href of [
      'search-ms:query=invoice&crumb=location:\\\\attacker\\share',
      'smb://attacker/share',
      'ms-settings:privacy',
      'ms-msdt:/id PCWDiagnostic',
      'waypoint://commands/system/restart',
      'x-apple.systempreferences:com.apple.preference.security',
      'vscode://file/x',
      'tel:+41000000',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      expect(linkTarget(href), href).toBeUndefined();
    }
    expect(html('[Open](search-ms:query=x) [Run](waypoint://commands/system/restart)')).toBe(
      '<div class="markdown"><p><span>Open</span> <span>Run</span></p></div>',
    );
  });

  it('refuses scripts, files, paths and relative links', () => {
    expect(linkTarget('javascript:alert(1)')).toBeUndefined();
    expect(linkTarget('data:text/html,hi')).toBeUndefined();
    expect(linkTarget('file:///etc/passwd')).toBeUndefined();
    expect(linkTarget('C:\\Windows')).toBeUndefined();
    expect(linkTarget('./readme.md')).toBeUndefined();
    expect(linkTarget('#top')).toBeUndefined();
  });
});

describe('imageSource', () => {
  it('loads absolute image paths through the icon protocol', () => {
    expect(imageSource('C:\\Pictures\\cat.JPG')).toBe(
      `palette-icon://icon?path=${encodeURIComponent('C:\\Pictures\\cat.JPG')}`,
    );
    expect(imageSource('/etc/passwd')).toBeUndefined();
  });

  it('never loads from a file share, which Windows would sign in to', () => {
    for (const href of [
      '//upload.wikimedia.org/x.png',
      '\\\\server\\share\\x.png',
      '/\\server\\share\\x.png',
      '\\\\?\\UNC\\server\\share\\x.png',
      '&#47;/server/share/x.png',
    ]) {
      expect(imageSource(href), href).toBeUndefined();
    }
    // Markdown's escaped backslashes and angle brackets make the same paths.
    expect(html('![Share](\\\\\\\\server\\\\share\\\\x.png) ![Host](<//host/x.png>)')).toBe(
      '<div class="markdown"><p><span class="markdown__alt">Share</span> <span class="markdown__alt">Host</span></p></div>',
    );
  });

  it('loads https images only', () => {
    expect(imageSource('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(imageSource('http://example.com/a.png')).toBeUndefined();
    expect(imageSource('data:image/png;base64,AAAA')).toBeUndefined();
    expect(imageSource('images/a.png')).toBeUndefined();
  });
});
