// GitHub: the pull requests waiting for your review, your own, your issues and your
// repositories. Signs in with GitHub CLI when you use it (`gh auth login`); otherwise paste a
// personal access token into the search field once.
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  API,
  ago,
  dedupe,
  headers,
  looksLikeToken,
  NEW_TOKEN_URL,
  preview,
  refusal,
  SEARCHES,
  toIssue,
  toRepository,
} from './github.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Action} Action */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./github.js').Issue} Issue */
/** @typedef {import('./github.js').Repository} Repository */

const CACHE_MS = 60_000;
const TIMEOUT_MS = 8000;

/** @type {Map<string, { at: number, value: unknown }>} */
const cache = new Map();
/** The token from GitHub CLI; `null` once asked and there was none. @type {string | null | undefined} */
let cliToken;

class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {boolean} [signedOut] The token was refused.
   */
  constructor(message, signedOut = false) {
    super(message);
    this.signedOut = signedOut;
  }
}

/** @returns {string | undefined} */
function findGh() {
  const file = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    join(homedir(), '.local', 'bin'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI'),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      accessSync(join(dir, file), process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return join(dir, file);
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/** @returns {Promise<string | null>} */
function askGh() {
  const gh = findGh();
  if (!gh) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      gh,
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 4000, windowsHide: true },
      (error, stdout) => {
        const token = `${stdout}`.trim();
        resolve(!error && token ? token : null);
      },
    );
  });
}

/**
 * The token to use and where it came from: one you pasted, else GitHub CLI's.
 * @param {Context} ctx
 * @returns {Promise<{ token: string, from: 'saved' | 'gh' } | undefined>}
 */
async function getToken(ctx) {
  const saved = ctx.storage.get('token');
  if (typeof saved === 'string' && saved) return { token: saved, from: 'saved' };
  if (cliToken === undefined) cliToken = await askGh();
  return cliToken ? { token: cliToken, from: 'gh' } : undefined;
}

/**
 * Shows the sign-in view after a refused token; GitHub CLI is asked again next time, in case
 * you signed in there meanwhile.
 * @param {Context} ctx
 * @param {string} title
 * @param {unknown} error
 * @returns {ListView}
 */
function failedView(ctx, title, error) {
  if (error instanceof GitHubError && error.signedOut) {
    cliToken = undefined;
    return signInView(ctx, title, error.message);
  }
  return { type: 'list', title, emptyText: error instanceof Error ? error.message : String(error), sections: [] };
}

/**
 * GET from the API, as JSON.
 * @param {string} token
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function get(token, path) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new GitHubError(
      error instanceof Error && error.name === 'TimeoutError'
        ? "GitHub didn't answer in time. Check your connection and try again."
        : `Couldn't reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok)
    throw new GitHubError(refusal(response.status, response.headers, Date.now()), response.status === 401);
  return response.json();
}

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return /** @type {T} */ (hit.value);
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The view to sign in from: paste a token into the search field and save it.
 * @param {Context} ctx
 * @param {string} title
 * @param {string} [problem]
 * @returns {ListView}
 */
function signInView(ctx, title, problem) {
  const typed = ctx.query.trim();
  /** @type {ListItem[]} */
  const items = [];
  if (looksLikeToken(typed)) {
    items.push({
      id: 'save-token',
      title: 'Save This Token',
      subtitle: `${typed.slice(0, 8)}…${typed.slice(-4)}`,
      icon: { builtin: 'lock', tint: 'green' },
      actions: [{ type: 'callback', id: 'save-token', title: 'Save Token', payload: typed }],
    });
  }
  items.push({
    id: 'create-token',
    title: 'Create a Token on GitHub',
    subtitle: 'With the repo and read:org scopes',
    icon: { builtin: 'globe', tint: 'blue' },
    actions: [{ type: 'open-url', url: NEW_TOKEN_URL, title: 'Open GitHub' }],
  });
  return {
    type: 'list',
    title,
    searchPlaceholder: 'Paste a GitHub token…',
    filtering: false,
    emptyText: '',
    sections: [
      {
        title: problem ?? 'Sign in to GitHub',
        items: items.map((item) => ({
          ...item,
          detail: {
            title: 'Sign in to GitHub',
            body: [
              ...(problem ? [problem, ''] : []),
              'Paste a personal access token into the search field, then save it.',
              '',
              'Or, if you use GitHub CLI, run gh auth login in a terminal and open this again.',
              '',
              "The token is saved on this computer in Waypoint's data folder (extension-data/github/storage.json), and only sent to api.github.com.",
            ].join('\n'),
          },
        })),
      },
    ],
  };
}

/**
 * @param {'saved' | 'gh'} from
 * @returns {Action[]}
 */
function commonActions(from) {
  return [
    { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } },
    from === 'saved'
      ? { type: 'callback', id: 'sign-out', title: 'Forget GitHub Token', style: 'destructive' }
      : { type: 'callback', id: 'sign-out', title: 'Sign Out (GitHub CLI)', style: 'destructive' },
  ];
}

/**
 * @param {Issue} issue
 * @param {Action[]} extra
 * @returns {ListItem}
 */
function issueItem(issue, extra) {
  const now = Date.now();
  const kind = issue.pullRequest ? 'Pull request' : 'Issue';
  return {
    id: String(issue.id),
    title: issue.title,
    subtitle: `${issue.repo}#${issue.number}`,
    accessory: ago(issue.updated, now),
    icon: issue.pullRequest
      ? { builtin: 'git-commit', tint: issue.draft ? 'gray' : 'green' }
      : { builtin: 'alert', tint: 'green' },
    keywords: [issue.repo, String(issue.number), issue.author, ...issue.labels],
    detail: {
      title: issue.title,
      body: preview(issue.body) || `No description.`,
      metadata: [
        { label: 'Repository', value: issue.repo },
        { label: kind, value: `#${issue.number}${issue.draft ? ' · Draft' : ''}` },
        { label: 'Author', value: issue.author },
        ...(issue.labels.length > 0 ? [{ label: 'Labels', value: issue.labels.join(', ') }] : []),
        ...(issue.comments > 0 ? [{ label: 'Comments', value: String(issue.comments) }] : []),
        { label: 'Updated', value: ago(issue.updated, now) },
      ],
    },
    actions: [
      { type: 'open-url', url: issue.url, title: 'Open in Browser' },
      { type: 'copy', text: issue.url, title: 'Copy URL', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
      { type: 'copy', text: `[${issue.title}](${issue.url})`, title: 'Copy as Markdown Link' },
      { type: 'copy', text: `${issue.repo}#${issue.number}`, title: 'Copy Reference' },
      ...(issue.pullRequest
        ? [/** @type {Action} */ ({ type: 'open-url', url: `${issue.url}/files`, title: 'Open Changed Files' })]
        : []),
      ...extra,
    ],
  };
}

/**
 * @param {'pull-requests' | 'issues'} command
 * @param {string} title
 * @returns {(ctx: Context) => Promise<ListView>}
 */
function searchCommand(command, title) {
  return async (ctx) => {
    const auth = await getToken(ctx);
    if (!auth) return signInView(ctx, title);
    /** @type {Array<{ title: string, items: Issue[] }>} */
    let sections;
    try {
      sections = await cached(`${command}:${auth.token.slice(-6)}`, () =>
        Promise.all(
          SEARCHES[command].map(async (search) => {
            const data = /** @type {{ items?: unknown[] }} */ (
              await get(
                auth.token,
                `/search/issues?q=${encodeURIComponent(search.q)}&sort=updated&order=desc&per_page=50`,
              )
            );
            return { title: search.title, items: (data.items ?? []).flatMap((item) => toIssue(item) ?? []) };
          }),
        ),
      );
    } catch (error) {
      return failedView(ctx, title, error);
    }
    const extra = commonActions(auth.from);
    return {
      type: 'list',
      title,
      searchPlaceholder: command === 'issues' ? 'Search your issues…' : 'Search your pull requests…',
      emptyText: command === 'issues' ? 'No open issues for you. 🎉' : 'No open pull requests for you. 🎉',
      sections: dedupe(sections)
        .filter((section) => section.items.length > 0)
        .map((section) => ({ title: section.title, items: section.items.map((issue) => issueItem(issue, extra)) })),
    };
  };
}

/**
 * @param {Repository} repo
 * @param {Action[]} extra
 * @returns {ListItem}
 */
function repoItem(repo, extra) {
  const now = Date.now();
  return {
    id: String(repo.id),
    title: repo.name,
    subtitle: repo.owner,
    accessory: ago(repo.pushed, now),
    icon: repo.private
      ? { builtin: 'lock', tint: 'gray' }
      : { builtin: 'folder', tint: repo.archived ? 'gray' : 'blue' },
    keywords: [repo.fullName, repo.description, repo.language].filter(Boolean),
    detail: {
      title: repo.fullName,
      body: repo.description || 'No description.',
      metadata: [
        {
          label: 'Visibility',
          value: `${repo.private ? 'Private' : 'Public'}${repo.archived ? ' · Archived' : ''}${repo.fork ? ' · Fork' : ''}`,
        },
        ...(repo.language ? [{ label: 'Language', value: repo.language }] : []),
        { label: 'Stars', value: repo.stars.toLocaleString() },
        { label: 'Forks', value: repo.forks.toLocaleString() },
        { label: 'Open issues and pull requests', value: repo.openIssues.toLocaleString() },
        ...(repo.defaultBranch ? [{ label: 'Default branch', value: repo.defaultBranch }] : []),
        { label: 'Last push', value: ago(repo.pushed, now) },
      ],
    },
    actions: [
      { type: 'open-url', url: repo.url, title: 'Open in Browser' },
      { type: 'open-url', url: `${repo.url}/pulls`, title: 'Open Pull Requests' },
      { type: 'open-url', url: `${repo.url}/issues`, title: 'Open Issues' },
      { type: 'copy', text: repo.url, title: 'Copy URL', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
      ...(repo.sshUrl
        ? [/** @type {Action} */ ({ type: 'copy', text: repo.sshUrl, title: 'Copy SSH Clone URL' })]
        : []),
      ...(repo.cloneUrl
        ? [/** @type {Action} */ ({ type: 'copy', text: repo.cloneUrl, title: 'Copy HTTPS Clone URL' })]
        : []),
      { type: 'copy', text: `gh repo clone ${repo.fullName}`, title: 'Copy Clone Command' },
      ...extra,
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function reposView(ctx) {
  const title = 'GitHub Repositories';
  const auth = await getToken(ctx);
  if (!auth) return signInView(ctx, title);
  /** @type {Repository[]} */
  let repos;
  try {
    repos = await cached(`repos:${auth.token.slice(-6)}`, async () => {
      /** @type {Repository[]} */
      const all = [];
      // Up to 300, most recently pushed first.
      for (let page = 1; page <= 3; page++) {
        const data = await get(auth.token, `/user/repos?per_page=100&sort=pushed&page=${page}`);
        const batch = Array.isArray(data) ? data.flatMap((item) => toRepository(item) ?? []) : [];
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    });
  } catch (error) {
    return failedView(ctx, title, error);
  }
  const extra = commonActions(auth.from);
  return {
    type: 'list',
    title,
    searchPlaceholder: 'Search your repositories…',
    emptyText: 'No repositories yet.',
    sections: [{ items: repos.map((repo) => repoItem(repo, extra)) }],
  };
}

/**
 * @param {(ctx: Context) => Promise<ListView>} view
 * @returns {(id: string, payload: unknown, ctx: Context) => Promise<ActionResult | undefined>}
 */
function actions(view) {
  return async (id, payload, ctx) => {
    if (id === 'refresh') {
      cache.clear();
      return { replace: await view(ctx) };
    }
    if (id === 'save-token' && typeof payload === 'string' && looksLikeToken(payload)) {
      const token = payload.trim();
      /** @type {{ login?: string }} */
      let user;
      try {
        user = /** @type {{ login?: string }} */ (await get(token, '/user'));
      } catch (error) {
        return { toast: error instanceof Error ? error.message : String(error), toastStyle: 'failure' };
      }
      ctx.storage.set('token', token);
      cache.clear();
      return {
        replace: await view({ ...ctx, query: '' }),
        clearSearch: true,
        toast: `Signed in as ${user.login ?? 'you'}`,
      };
    }
    if (id === 'sign-out') {
      const saved = ctx.storage.get('token');
      if (typeof saved === 'string' && saved) {
        ctx.storage.remove('token');
        cache.clear();
        return { replace: await view({ ...ctx, query: '' }), toast: 'Forgot your GitHub token' };
      }
      return { toast: 'You are signed in with GitHub CLI. Run gh auth logout in a terminal to sign out.' };
    }
    return undefined;
  };
}

const pullRequests = searchCommand('pull-requests', 'Pull Requests');
const issues = searchCommand('issues', 'Issues');

/** @type {Extension} */
export default {
  commands: {
    'pull-requests': { view: pullRequests, onAction: actions(pullRequests) },
    issues: { view: issues, onAction: actions(issues) },
    repos: { view: reposView, onAction: actions(reposView) },
  },
};
