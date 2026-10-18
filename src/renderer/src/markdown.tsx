/**
 * Draws Markdown from extensions as React elements: CommonMark with GitHub's tables, task lists
 * and strikethrough, parsed by `marked` into tokens and built here element by element. Nothing is
 * ever handed to the page as HTML, so raw HTML in the text shows as the text it is.
 */
import { Lexer, type Token, type Tokens } from 'marked';
import { type MouseEvent, type ReactNode, useMemo } from 'react';
import { isNetworkPath } from '../../shared/paths';

/** Links that would run something in the page, or reach into it, never open. */
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);
const IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

/** The entities people write by hand; any other named one is left as typed. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  para: '¶',
  sect: '§',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  check: '✓',
};

/** Turns `&amp;`, `&#169;` and `&#x1F600;` into the characters they stand for. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#\d{1,7}|#[xX][\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z\d]{1,31});/g, (whole, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    // Like CommonMark, a code point that can't be shown becomes the replacement character.
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return String.fromCodePoint(valid ? code : 0xfffd);
  });
}

/** The URL a link opens, or `undefined` when it isn't one that may open (a relative link, `javascript:`). */
export function linkTarget(href: string): string | undefined {
  try {
    const url = new URL(decodeEntities(href));
    // `C:\…` parses as a URL with the scheme "c:"; it's a path, not a link.
    if (url.protocol.length <= 2 || BLOCKED_SCHEMES.has(url.protocol)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path);
}

/**
 * Where an image is loaded from: https URLs as they are, absolute paths of image files through the
 * icon protocol. Nothing from another computer without `https:`: `//host/x.png` would be a file
 * share on Windows, which it signs in to with your account just to show the picture.
 */
export function imageSource(href: string): string | undefined {
  const source = decodeEntities(href);
  if (isNetworkPath(source)) return undefined;
  if (isAbsolutePath(source)) {
    return IMAGE_PATTERN.test(source) ? `palette-icon://icon?path=${encodeURIComponent(source)}` : undefined;
  }
  try {
    const url = new URL(source);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseMarkdown(source: string): Token[] {
  try {
    return new Lexer({ gfm: true }).lex(source);
  } catch {
    // Should never happen, but a page that shows as written beats one that doesn't show at all.
    return [{ type: 'paragraph', raw: source, text: source, tokens: [{ type: 'text', raw: source, text: source }] }];
  }
}

interface RenderOptions {
  onOpenLink(url: string): void;
}

function TaskBox({ checked }: { checked: boolean }) {
  return (
    <>
      <span className="markdown__box" data-checked={checked || undefined} aria-hidden="true" />
      <span className="visually-hidden">{checked ? 'Done: ' : 'To do: '}</span>
    </>
  );
}

function inline(tokens: Token[] | undefined, options: RenderOptions): ReactNode[] {
  return (tokens ?? []).map((token, index) => renderInline(token, index, options));
}

function renderInline(token: Token, key: number, options: RenderOptions): ReactNode {
  switch (token.type) {
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens ? <span key={key}>{inline(text.tokens, options)}</span> : decodeEntities(text.text);
    }
    case 'escape':
      return (token as Tokens.Escape).text;
    case 'strong':
      return <strong key={key}>{inline((token as Tokens.Strong).tokens, options)}</strong>;
    case 'em':
      return <em key={key}>{inline((token as Tokens.Em).tokens, options)}</em>;
    case 'del':
      return <del key={key}>{inline((token as Tokens.Del).tokens, options)}</del>;
    case 'codespan':
      return <code key={key}>{(token as Tokens.Codespan).text}</code>;
    case 'br':
      return <br key={key} />;
    case 'checkbox':
      return <TaskBox key={key} checked={(token as Tokens.Checkbox).checked} />;
    case 'link': {
      const link = token as Tokens.Link;
      const url = linkTarget(link.href);
      const children = inline(link.tokens, options);
      if (!url) return <span key={key}>{children}</span>;
      const open = (event: MouseEvent) => {
        // The launcher never navigates: the main process opens the link, like an open-url action.
        event.preventDefault();
        options.onOpenLink(url);
      };
      return (
        <a key={key} href={url} title={link.title ? decodeEntities(link.title) : url} draggable={false} onClick={open}>
          {children}
        </a>
      );
    }
    case 'image': {
      const image = token as Tokens.Image;
      const alt = decodeEntities(image.text);
      const src = imageSource(image.href);
      if (!src)
        return alt ? (
          <span key={key} className="markdown__alt">
            {alt}
          </span>
        ) : null;
      return (
        <img
          key={key}
          src={src}
          alt={alt}
          title={image.title ? decodeEntities(image.title) : undefined}
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
        />
      );
    }
    // Inline HTML is shown as the text it is.
    case 'html':
      return (token as Tokens.Tag).text;
    default:
      return 'tokens' in token && token.tokens ? inline(token.tokens, options) : token.raw;
  }
}

function blocks(tokens: Token[], options: RenderOptions): ReactNode[] {
  return tokens.map((token, index) => renderBlock(token, index, options));
}

function renderBlock(token: Token, key: number, options: RenderOptions): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    // A tight task list item's box comes before its text.
    case 'checkbox':
      return <TaskBox key={key} checked={(token as Tokens.Checkbox).checked} />;
    case 'heading': {
      const heading = token as Tokens.Heading;
      const Tag = `h${Math.min(6, Math.max(1, heading.depth))}` as 'h1';
      return <Tag key={key}>{inline(heading.tokens, options)}</Tag>;
    }
    case 'paragraph':
      return <p key={key}>{inline((token as Tokens.Paragraph).tokens, options)}</p>;
    case 'text': {
      // Text straight in a tight list item.
      const text = token as Tokens.Text;
      return <span key={key}>{text.tokens ? inline(text.tokens, options) : decodeEntities(text.text)}</span>;
    }
    case 'code': {
      const code = token as Tokens.Code;
      return (
        <pre key={key} data-lang={code.lang || undefined}>
          <code>{code.text}</code>
        </pre>
      );
    }
    case 'blockquote':
      return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens, options)}</blockquote>;
    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={index} className={item.task ? 'markdown__task' : undefined} data-checked={item.checked || undefined}>
          {blocks(item.tokens, options)}
        </li>
      ));
      if (!list.ordered) return <ul key={key}>{items}</ul>;
      return (
        <ol key={key} start={typeof list.start === 'number' && list.start !== 1 ? list.start : undefined}>
          {items}
        </ol>
      );
    }
    case 'table': {
      const table = token as Tokens.Table;
      const align = (cell: Tokens.TableCell) => (cell.align ? { textAlign: cell.align } : undefined);
      return (
        <div key={key} className="markdown__table">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={index} style={align(cell)}>
                    {inline(cell.tokens, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={align(cell)}>
                      {inline(cell.tokens, options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'hr':
      return <hr key={key} />;
    // A block of HTML is shown as written.
    case 'html':
      return (
        <p key={key} className="markdown__html">
          {(token as Tokens.HTML).text.replace(/\n+$/, '')}
        </p>
      );
    default:
      return 'tokens' in token && token.tokens ? (
        <div key={key}>{blocks(token.tokens, options)}</div>
      ) : (
        <p key={key}>{token.raw}</p>
      );
  }
}

export interface MarkdownProps extends RenderOptions {
  source: string;
  className?: string;
}

/** A block of Markdown. Links call `onOpenLink` instead of navigating. */
export function Markdown({ source, onOpenLink, className }: MarkdownProps) {
  const tokens = useMemo(() => parseMarkdown(source), [source]);
  const content = useMemo(() => blocks(tokens, { onOpenLink }), [tokens, onOpenLink]);
  return <div className={className ? `markdown ${className}` : 'markdown'}>{content}</div>;
}
