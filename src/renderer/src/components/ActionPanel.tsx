import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { rankItems } from '../../../shared/search';
import type { Action, Platform } from '../../../shared/types';
import { acceleratorKeys } from '../accelerator';
import { isModKey, shortcutKeys } from '../keys';
import { actionTitle, type DisplayItem } from '../model';
import { Keycaps } from './Keycaps';

interface ActionPanelProps {
  item: DisplayItem;
  platform: Platform;
  /** The keys shown beside each action, when they aren't a list's (↵ for the first, ⌘↵ for the second). */
  keysFor?(action: Action, index: number): string[] | undefined;
  onRun(action: Action): void;
  onClose(): void;
}

/**
 * Keys shown next to an action: ↵ for the first, mod+↵ for the second (unless it's `panelOnly`),
 * else its own shortcut.
 */
export function keysForAction(action: Action, index: number, platform: Platform): string[] | undefined {
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl';
  const enter = platform === 'darwin' ? '↵' : 'Enter';
  if (index === 0) return [enter];
  if (index === 1 && !action.panelOnly) return [mod, enter];
  return action.shortcut ? shortcutKeys(action.shortcut, platform) : undefined;
}

export function ActionPanel({ item, platform, keysFor, onRun, onClose }: ActionPanelProps) {
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const actions = useMemo(() => {
    const entries = item.actions.map((action, position) => ({ action, position, title: actionTitle(action) }));
    return rankItems(entries, filter).map((ranked) => ranked.item);
  }, [item, filter]);

  useEffect(() => input.current?.focus(), []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, actions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // A held ↵ repeats; only the first press runs the action.
      if (event.repeat) return;
      const entry = actions[index];
      if (entry) onRun(entry.action);
    } else if (event.key === 'Escape' || (isModKey(event, platform) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <div className="action-panel__scrim" onClick={onClose} aria-hidden="true" />
      <div className="action-panel" role="dialog" aria-label={`Actions for ${item.title}`} onKeyDown={onKeyDown}>
        <div className="action-panel__heading">
          <span className="action-panel__title">{item.title}</span>
          {item.alias && (
            <span className="action-panel__alias" title="Its alias">
              {item.alias}
            </span>
          )}
          {item.hotkey && (
            <span className="action-panel__hotkey" title="Runs it from anywhere">
              <Keycaps keys={acceleratorKeys(item.hotkey, platform)} />
            </span>
          )}
        </div>
        <ul className="action-panel__list" role="listbox" aria-label="Actions">
          {actions.map(({ action, position, title }, i) => {
            const keys = keysFor ? keysFor(action, position) : keysForAction(action, position, platform);
            return (
              <li
                key={`${position}:${title}`}
                role="option"
                aria-selected={i === index}
                className="action-panel__item"
                data-destructive={action.type === 'callback' && action.style === 'destructive' ? '' : undefined}
                onMouseMove={() => setIndex(i)}
                onClick={() => onRun(action)}
              >
                <span>{title}</span>
                {keys && <Keycaps keys={keys} />}
              </li>
            );
          })}
          {actions.length === 0 && <li className="action-panel__none">No matching actions</li>}
        </ul>
        <input
          ref={input}
          className="action-panel__filter"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setIndex(0);
          }}
          placeholder="Search actions…"
          aria-label="Search actions"
          spellCheck={false}
        />
      </div>
    </>
  );
}
