// Conventional Commits: write a commit message like `feat(search): find notes by content`
// and see, as you type, whether it follows the convention and what it does to the version.
// Pick a type to start, or just describe the change and pick the type it suggests.
import {
  checkCommit,
  commitType,
  formatCommit,
  gitCommitCommand,
  guessType,
  parseCommit,
  releaseOf,
  TYPES,
} from './commits.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('./commits.js').Commit} Commit */
/** @typedef {import('./commits.js').Release} Release */

/** @param {Release} release */
function releaseLabel(release) {
  return release ? `${release.charAt(0).toUpperCase()}${release.slice(1)} release` : 'No release';
}

/** @param {Release} release */
function releaseText(release) {
  switch (release) {
    case 'major':
      return 'Breaking change: releasing it bumps the major version (1.4.2 → 2.0.0).';
    case 'minor':
      return 'Releasing it bumps the minor version (1.4.2 → 1.5.0).';
    case 'patch':
      return 'Releasing it bumps the patch version (1.4.2 → 1.4.3).';
    default:
      return "It doesn't trigger a release by itself.";
  }
}

/**
 * A finished message, with how it does against the convention.
 * @param {Commit} commit
 * @param {string} id
 * @param {Context} ctx
 * @returns {ListItem}
 */
function messageItem(commit, id, ctx) {
  const message = formatCommit(commit);
  const checks = checkCommit(commit);
  const passes = checks.every((check) => check.ok);
  const release = releaseOf(commit);
  const type = commitType(commit.type);
  /** @type {Action[]} */
  const actions = [
    { type: 'paste', text: message, title: 'Paste Message' },
    { type: 'copy', text: message, title: 'Copy Message' },
    {
      type: 'copy',
      text: gitCommitCommand(message, ctx.platform),
      title: ctx.platform === 'win32' ? 'Copy as git commit Command (PowerShell)' : 'Copy as git commit Command',
      shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
    },
  ];
  if (type) {
    actions.push({
      type: 'paste',
      text: `${type.gitmoji} ${message}`,
      // No shortcut: a key still held when the paste is typed (⇧) would change what the app does.
      title: 'Paste with Gitmoji',
    });
  }
  actions.push({
    type: 'callback',
    id: 'edit',
    title: commit.breaking ? 'Unmark as Breaking Change' : 'Mark as Breaking Change',
    payload: formatCommit({ ...commit, breaking: !commit.breaking }),
    shortcut: { key: 'b', modifiers: ['mod', 'shift'] },
  });
  actions.push({
    type: 'callback',
    id: 'edit',
    title: 'Edit Message',
    payload: message,
    shortcut: { key: 'e', modifiers: ['mod'] },
  });

  return {
    id,
    title: message,
    subtitle: type?.title ?? 'Unknown type',
    accessory: releaseLabel(release),
    icon: { builtin: 'git-commit', tint: passes ? 'green' : 'orange' },
    detail: {
      title: passes ? 'Looks good' : 'Almost there',
      body: [...checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.text}`), '', releaseText(release)].join('\n'),
      metadata: [
        { label: 'Type', value: type ? `${type.type}: ${type.title}` : commit.type },
        ...(commit.scope ? [{ label: 'Scope', value: commit.scope }] : []),
      ],
    },
    actions,
  };
}

/**
 * The types to start from.
 * @returns {ListItem[]}
 */
function typeItems() {
  return TYPES.map((type) => ({
    id: `type:${type.type}`,
    title: type.type,
    subtitle: type.title,
    accessory: releaseLabel(type.release),
    icon: { emoji: type.gitmoji },
    detail: {
      title: `${type.type}: ${type.title}`,
      body: [type.description, '', `For example: ${type.example}`, '', releaseText(type.release)].join('\n'),
    },
    actions: [
      { type: 'callback', id: 'edit', title: `Write a ${type.title}`, payload: `${type.type}: ` },
      {
        type: 'callback',
        id: 'edit',
        title: 'Start with a Scope',
        payload: `${type.type}(`,
        shortcut: { key: 's', modifiers: ['mod', 'shift'] },
      },
    ],
  }));
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function writeView(ctx) {
  const text = (ctx.query || ctx.argument || '').trimStart();
  const commit = parseCommit(text);
  /** @type {ListView['sections']} */
  let sections;
  if (!text.trim()) {
    sections = [{ title: 'Pick a type', items: typeItems() }];
  } else if (commit) {
    sections = [{ title: 'Your message', items: [messageItem(commit, 'message', ctx)] }];
  } else {
    // Just a description: offer it with every type, the likeliest first.
    const description = text.trim();
    const guess = guessType(description);
    const ordered = [guess, ...TYPES.map((type) => type.type).filter((type) => type !== guess)];
    sections = [
      {
        title: 'Pick a type',
        items: ordered.map((type) => messageItem({ type, breaking: false, description }, `suggest:${type}`, ctx)),
      },
    ];
  }
  return {
    type: 'list',
    title: 'Commit Message',
    searchPlaceholder: 'Describe the change, or type feat(scope): …',
    // The list is built from what's typed.
    filtering: false,
    sections,
  };
}

/** @type {Extension} */
export default {
  commands: {
    write: {
      view: writeView,
      onAction(id, payload) {
        // Puts a message (or the start of one) in the search field to carry on typing.
        if (id === 'edit' && typeof payload === 'string') return { search: payload };
        return undefined;
      },
    },
  },
};
