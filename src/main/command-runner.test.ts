import { describe, expect, it, vi } from 'vitest';
import type { CommandRequest, ToastMessage } from '../shared/ipc';
import type { ActionResult, CommandManifest, CommandRef } from '../shared/types';
import { CommandRunner } from './command-runner';
import type { CommandInfo } from './registry';

const LEFT_HALF: CommandRef = { extension: 'window-management', command: 'left-half' };
const SEARCH_FILES: CommandRef = { extension: 'files', command: 'search' };

function info(ref: CommandRef, title: string, mode: CommandManifest['mode']): CommandInfo {
  return {
    ref,
    manifest: { name: ref.command, title, mode },
    extension: { name: ref.extension, title: ref.extension, source: 'builtin' },
  };
}

function setup(options: { result?: ActionResult; inFront?: boolean; notifications?: boolean; late?: boolean } = {}) {
  let loaded = !options.late;
  let finishLoad = () => {};
  const commands = [info(LEFT_HALF, 'Left Half', 'no-view'), info(SEARCH_FILES, 'Search Files', 'view')];
  const events: string[] = [];
  const requests: CommandRequest[] = [];
  const toasts: ToastMessage[] = [];
  const notifications: Array<[string, string]> = [];
  const runAction = vi.fn(async () => options.result ?? { hide: true });
  const finish = vi.fn(async (result: ActionResult) => {
    const { copy: _copy, paste: _paste, ...rest } = result;
    return rest;
  });
  const runner = new CommandRunner({
    registry: {
      findCommand: (ref) =>
        loaded ? commands.find((c) => c.ref.extension === ref.extension && c.ref.command === ref.command) : undefined,
      runAction,
      firstLoad: new Promise<void>((resolve) => {
        finishLoad = () => {
          loaded = true;
          resolve();
        };
      }),
    },
    launcher: {
      inFront: options.inFront ?? false,
      show: () => events.push('show'),
      toast: (message) => toasts.push(message),
      runCommand: (request) => requests.push(request),
    },
    finish,
    notify: (title, body) => {
      if (options.notifications === false) return false;
      notifications.push([title, body]);
      return true;
    },
  });
  return { runner, events, requests, toasts, notifications, runAction, finish, finishLoad: () => finishLoad() };
}

describe('CommandRunner', () => {
  it('opens the launcher straight into a view command', async () => {
    const env = setup();
    await env.runner.run(SEARCH_FILES);
    expect(env.events).toEqual(['show']);
    expect(env.requests).toEqual([{ ref: SEARCH_FILES, toggle: false }]);
    expect(env.runAction).not.toHaveBeenCalled();
  });

  it('hands a view command to the launcher already in front, which closes it if it’s showing', async () => {
    const env = setup({ inFront: true });
    await env.runner.run(SEARCH_FILES);
    expect(env.events).toEqual([]);
    expect(env.requests).toEqual([{ ref: SEARCH_FILES, toggle: true }]);
  });

  it('runs a no-view command without the launcher, counting it like a pick from the root search', async () => {
    const env = setup();
    await env.runner.run(LEFT_HALF);
    expect(env.runAction).toHaveBeenCalledWith(
      { type: 'open-command', ref: LEFT_HALF },
      { rootItemId: 'command:window-management/left-half' },
    );
    expect(env.finish).toHaveBeenCalledWith({ hide: true });
    expect(env.events).toEqual([]);
    expect(env.requests).toEqual([]);
    expect(env.toasts).toEqual([]);
  });

  it('runs a no-view command in the launcher when that’s in front, so its toast shows there', async () => {
    const env = setup({ inFront: true });
    await env.runner.run(LEFT_HALF);
    expect(env.runAction).not.toHaveBeenCalled();
    expect(env.requests).toEqual([{ ref: LEFT_HALF, toggle: true }]);
  });

  it('says what it has to say as a notification', async () => {
    const env = setup({ result: { toast: 'Your Mac can sleep again' } });
    await env.runner.run(LEFT_HALF);
    expect(env.notifications).toEqual([['Left Half', 'Your Mac can sleep again']]);
    expect(env.events).toEqual([]);
  });

  it('opens the launcher with a failure, or where there are no notifications', async () => {
    const failed = setup({ result: { toast: 'Allow Waypoint in Accessibility', toastStyle: 'failure' } });
    await failed.runner.run(LEFT_HALF);
    expect(failed.notifications).toEqual([]);
    expect(failed.events).toEqual(['show']);
    expect(failed.toasts).toEqual([{ text: 'Allow Waypoint in Accessibility', style: 'failure' }]);

    const quiet = setup({ result: { toast: 'Wi-Fi is off' }, notifications: false });
    await quiet.runner.run(LEFT_HALF);
    expect(quiet.events).toEqual(['show']);
    expect(quiet.toasts).toEqual([{ text: 'Wi-Fi is off', style: 'success' }]);
  });

  it('shows a list a no-view command returns in the launcher, without running it again', async () => {
    const push = { type: 'list' as const, sections: [] };
    const env = setup({ result: { push, toast: 'Pick one' } });
    await env.runner.run(LEFT_HALF);
    expect(env.events).toEqual(['show']);
    expect(env.requests).toEqual([{ ref: LEFT_HALF, toggle: false, result: { push, toast: 'Pick one' } }]);
    expect(env.runAction).toHaveBeenCalledTimes(1);
  });

  it('asks before running a no-view command a link asked for, and opens a view command’s list', async () => {
    const env = setup();
    await env.runner.run(LEFT_HALF, { ask: true });
    expect(env.runAction).not.toHaveBeenCalled();
    expect(env.events).toEqual(['show']);
    const [request] = env.requests;
    const push = request?.result?.push;
    expect(push?.title).toBe('Left Half');
    expect(push?.type === 'list' && push.sections[0]?.items[0]?.actions).toEqual([
      { type: 'open-command', ref: LEFT_HALF, title: 'Run Command' },
    ]);
    await env.runner.run(SEARCH_FILES, { ask: true });
    expect(env.requests[1]).toEqual({ ref: SEARCH_FILES, toggle: false });
  });

  it('waits for extensions to load at launch, then says when there is no such command', async () => {
    const env = setup({ late: true });
    const running = env.runner.run(SEARCH_FILES);
    await Promise.resolve();
    expect(env.requests).toEqual([]);
    env.finishLoad();
    await running;
    expect(env.requests).toEqual([{ ref: SEARCH_FILES, toggle: false }]);

    await env.runner.run({ extension: 'gone', command: 'command' });
    expect(env.toasts).toEqual([{ text: 'There’s no command “gone/command”.', style: 'failure' }]);
  });
});
