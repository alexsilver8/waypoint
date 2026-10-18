/**
 * The most Markdown a detail view may hold: room for a long README (Waypoint's own is about 35,000
 * characters), and little enough that the launcher parses any page of it in well under a tenth of
 * a second, however it's written. `src/renderer/src/markdown-lexer.ts` keeps the parsing in bounds.
 */
export const MAX_MARKDOWN = 50_000;
