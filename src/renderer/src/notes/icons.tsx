/**
 * The Notes window's own icons, drawn to match Raycast Notes' toolbar: the same weight as
 * Lucide's, at the sizes Raycast uses.
 */

import type { ReactNode } from 'react';

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

/** A filled circle with an ×, for closing a popover or the format bar. */
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

/**
 * The format bar's icons are drawn on a 16pt grid with 1.5pt lines, measured from Raycast's
 * (2× screenshots): 14pt across, a little heavier than Lucide's at that size.
 */
function FormatIcon({ size = 16, strokeWidth = 1.5, className, children }: IconProps & { children: ReactNode }) {
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
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A bold H: the Heading menu. One shape, so the grey it's drawn in doesn't darken where parts overlap. */
export function HeadingIcon({ size = 16, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.5 1.5h1a.5.5 0 0 1 .5.5v5h6V2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5V9H5v5a.5.5 0 0 1-.5.5h-1A.5.5 0 0 1 3 14V2a.5.5 0 0 1 .5-.5z" />
    </svg>
  );
}

/** A text cursor: the menu of text styles (bold, italic, strikethrough). */
export function TextStyleIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M5.75 1.75h.75a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-.75M10.25 1.75h-.75A1.5 1.5 0 0 0 8 3.25M10.25 14.25h-.75A1.5 1.5 0 0 1 8 12.75" />
    </FormatIcon>
  );
}

/** Two halves of a chain on the diagonal, a bar between them. */
export function LinkIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path
        transform="translate(8 8) rotate(-45)"
        d="M2.5-2.75H5a2.75 2.75 0 0 1 0 5.5H2.5M-2.5 2.75H-5a2.75 2.75 0 0 1 0-5.5h2.5M-1.75 0h3.5"
      />
    </FormatIcon>
  );
}

/** ‹ ›: inline code. */
export function InlineCodeIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M5 4.8 1.8 8 5 11.2M11 4.8 14.2 8 11 11.2" />
    </FormatIcon>
  );
}

/** A rounded square with ‹ › in its open top-left corner: a code block. */
export function CodeBlockIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M11.75 1.75H12a2.25 2.25 0 0 1 2.25 2.25v8A2.25 2.25 0 0 1 12 14.25H4A2.25 2.25 0 0 1 1.75 12V8.75" />
      <path d="M3.4 2.6 1.75 4l1.65 1.4M6.6 2.6 8.25 4 6.6 5.4" strokeWidth="1.3" />
    </FormatIcon>
  );
}

/**
 * Quotation marks beside two short lines, over two long ones: a quote. Each mark is a rounded
 * block with a stalk, filled as one shape so the grey doesn't darken where they meet.
 */
export function QuoteIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M1.75 9.75h12.5M1.75 13.25h12.5M10.75 2.75h3.5M10.75 6.25h3.5" />
      <path
        d="M2.25 2a.75.75 0 0 1 .75.75V5H1.5V2.75A.75.75 0 0 1 2.25 2zM1 5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.25a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 1 6.25zm5.25-3a.75.75 0 0 1 .75.75V5H5.5V2.75A.75.75 0 0 1 6.25 2zM5 5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.25a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 5 6.25z"
        fill="currentColor"
        stroke="none"
      />
    </FormatIcon>
  );
}

/** Three dots and three lines: the List menu. */
export function ListIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M5.75 3h8.5M5.75 8h8.5M5.75 13h8.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="2" cy="3" r="1" />
        <circle cx="2" cy="8" r="1" />
        <circle cx="2" cy="13" r="1" />
      </g>
    </FormatIcon>
  );
}

/** The small ⌄ beside a format bar button that opens a menu. */
export function MenuChevronIcon({ size = 12, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.75 4.125 6 7.875l3.25-3.75" />
    </svg>
  );
}

/** A serifed T: shows the format bar. */
export function TextFormatIcon(props: IconProps) {
  return (
    <FormatIcon {...props}>
      <path d="M2.75 4V2.75h10.5V4M8 2.75v10.5M6.75 13.25h2.5" />
    </FormatIcon>
  );
}
