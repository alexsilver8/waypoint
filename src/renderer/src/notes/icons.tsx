/**
 * The Notes window's own icons, drawn to match Raycast Notes' toolbar: the same weight as
 * Lucide's, at the sizes Raycast uses.
 */

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** Two cards, one tilted behind the other: Browse Notes. */
export function BrowseIcon({ size = 16, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      // As thick as a Lucide icon's at the same size: their strokes are drawn on a 24-unit grid.
      strokeWidth={(strokeWidth * 18) / 24}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 4.6 3.2 5.5a1.6 1.6 0 0 0-.95 2.06l2.86 7.6a1.6 1.6 0 0 0 2.06.94l5.1-1.92" />
      <rect x="6.2" y="1.4" width="9.2" height="12.2" rx="1.9" transform="rotate(12 10.8 7.5)" />
    </svg>
  );
}

/** ⌘, for the toolbar button that shows actions. */
export function CommandIcon({ size = 18, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </svg>
  );
}

/** A plain +, as wide as the other toolbar icons. */
export function PlusIcon({ size = 16, strokeWidth = 1.5, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.25v13.5M1.25 8h13.5" />
    </svg>
  );
}

/** A filled circle with an ×, for closing a popover. */
export function CloseCircleIcon({ size = 14, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2"
        stroke="var(--notes-close-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
