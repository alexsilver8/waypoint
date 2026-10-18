import type { Settings } from '../../../shared/settings';

const THEMES: Array<{ value: Settings['theme']; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * System, Light and Dark as little launchers (dock, search capsule and sheet), picked like radio
 * buttons. `showLegend` shows the "Appearance" label above them; otherwise only screen readers get it.
 */
export function ThemePicker({
  value,
  showLegend,
  onChange,
}: {
  value: Settings['theme'];
  showLegend?: boolean;
  onChange(value: Settings['theme']): void;
}) {
  return (
    <fieldset className="themes">
      <legend className={showLegend ? 'themes__legend' : 'visually-hidden'}>Appearance</legend>
      {THEMES.map((theme) => (
        <label key={theme.value} className="theme" data-checked={theme.value === value || undefined}>
          <input
            type="radio"
            name="theme"
            value={theme.value}
            checked={theme.value === value}
            onChange={() => onChange(theme.value)}
          />
          <span className="theme__preview" data-theme={theme.value} aria-hidden="true">
            <span className="theme__dock" />
            <span className="theme__main">
              <span className="theme__search" />
              <span className="theme__sheet">
                <span className="theme__line" />
                <span className="theme__line" />
                <span className="theme__line" />
              </span>
            </span>
          </span>
          <span className="theme__label">{theme.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
