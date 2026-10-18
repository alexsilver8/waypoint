import type { ReactNode } from 'react';
import { Markdown } from '../markdown';
import type { DisplayItem } from '../model';
import { ItemIcon } from './ItemIcon';

/** Draws a detail body: headings, bullets and checkboxes from their Markdown-ish markers. */
function Body({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  lines.forEach((line, index) => {
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    const check = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <p key={index} className="detail__heading">
          {heading[1]}
        </p>,
      );
    } else if (check) {
      const done = check[1] !== ' ';
      out.push(
        <p key={index} className="detail__check" data-done={done || undefined}>
          <span className="detail__box" aria-hidden="true" />
          <span>
            <span className="visually-hidden">{done ? 'Done: ' : 'To do: '}</span>
            {check[2]}
          </span>
        </p>,
      );
    } else if (bullet) {
      out.push(
        <p key={index} className="detail__bullet">
          {bullet[1]}
        </p>,
      );
    } else if (line.trim() === '') {
      out.push(<div key={index} className="detail__gap" aria-hidden="true" />);
    } else {
      out.push(
        <p key={index} className="detail__line">
          {line}
        </p>,
      );
    }
  });
  return <div className="detail__body">{out}</div>;
}

/**
 * The preview beside the list: the selected item's detail, or what little we know about it. Links
 * in a Markdown detail open through `onOpenLink`.
 */
export function DetailPane({ item, onOpenLink }: { item: DisplayItem | undefined; onOpenLink(url: string): void }) {
  if (!item) return <aside className="detail" aria-label="Preview" />;
  const { detail } = item;
  return (
    <aside className="detail" aria-label={`Preview of ${item.title}`}>
      {detail ? (
        <>
          {detail.title && (
            <header className="detail__header">
              <h2 className="detail__title">{detail.title}</h2>
            </header>
          )}
          {detail.markdown !== undefined ? (
            <Markdown className="detail__markdown" source={detail.markdown} onOpenLink={onOpenLink} />
          ) : (
            <Body text={detail.body ?? ''} />
          )}
          {detail.metadata && detail.metadata.length > 0 && (
            <dl className="detail__meta">
              {detail.metadata.map((entry, index) => (
                // Labels needn't be unique, so the position is the key.
                <div key={index} className="detail__meta-row">
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <div className="detail__summary">
          <span className="detail__summary-icon">
            <ItemIcon icon={item.icon} />
          </span>
          <p className="detail__title">{item.title}</p>
          {item.subtitle && <p className="detail__summary-subtitle">{item.subtitle}</p>}
        </div>
      )}
    </aside>
  );
}
