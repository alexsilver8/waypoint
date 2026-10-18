import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { COLOR_THEMES, CUSTOM_COLOR_THEME, type ThemeColors } from '../../../shared/themes';

/** How long a colour picker waits for the pointer to settle before the colour is saved. */
const SAVE_AFTER_MS = 150;

/** The default look's accent, as tokens.css has it, for its swatch. */
const WAYPOINT_ACCENT = '#5b74ff';

/**
 * A colour input that shows each change at once but saves it only once dragging settles, so
 * settings.json isn't written for every step of the way.
 */
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  useEffect(() => {
    saved.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (draft === saved.current) return;
    const timer = setTimeout(() => onChange(draft), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft, onChange]);
  return (
    <label className="color-input">
      <input type="color" value={draft} aria-label={label} onChange={(event) => setDraft(event.target.value)} />
      <span className="color-input__value">{draft}</span>
    </label>
  );
}

/**
 * The colour themes as swatches, picked like radio buttons, and your own colours when Custom is
 * picked: an accent, and a tint for the panes that can be turned off.
 */
export function ColorThemePicker({
  value,
  custom,
  onChange,
  onCustomChange,
}: {
  value: string;
  custom: ThemeColors;
  onChange(value: string): void;
  onCustomChange(custom: ThemeColors): void;
}) {
  const choices = [
    ...COLOR_THEMES.map((theme) => ({
      id: theme.id,
      name: theme.name,
      accent: theme.colors?.accent ?? WAYPOINT_ACCENT,
      tint: theme.colors?.tint,
    })),
    { id: CUSTOM_COLOR_THEME, name: 'Custom', accent: custom.accent, tint: custom.tint },
  ];
  // The last tint, kept while it's turned off, to come back when it's turned on again.
  const lastTint = useRef(custom.tint ?? custom.accent);
  if (custom.tint) lastTint.current = custom.tint;

  return (
    <div className="colors">
      <fieldset className="colors__swatches">
        <legend className="visually-hidden">Colours</legend>
        {choices.map((choice) => (
          <label key={choice.id} className="swatch" data-checked={choice.id === value || undefined}>
            <input
              type="radio"
              name="color-theme"
              value={choice.id}
              checked={choice.id === value}
              onChange={() => onChange(choice.id)}
            />
            <span
              className="swatch__chip"
              data-custom={choice.id === CUSTOM_COLOR_THEME || undefined}
              style={
                { '--swatch-accent': choice.accent, '--swatch-tint': choice.tint ?? 'transparent' } as CSSProperties
              }
              aria-hidden="true"
            />
            <span className="swatch__label">{choice.name}</span>
          </label>
        ))}
      </fieldset>
      {value === CUSTOM_COLOR_THEME && (
        <div className="colors__custom">
          <div className="colors__field">
            <span className="colors__label">Accent</span>
            <ColorInput
              label="Accent colour"
              value={custom.accent}
              onChange={(accent) => onCustomChange({ ...custom, accent })}
            />
          </div>
          <div className="colors__field">
            <label className="colors__label colors__label--check">
              <input
                type="checkbox"
                checked={Boolean(custom.tint)}
                onChange={(event) =>
                  onCustomChange(
                    event.target.checked ? { ...custom, tint: lastTint.current } : { accent: custom.accent },
                  )
                }
              />
              Tint the panes
            </label>
            {custom.tint && (
              <ColorInput
                label="Tint colour"
                value={custom.tint}
                onChange={(tint) => onCustomChange({ ...custom, tint })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
