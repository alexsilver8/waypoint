import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OnboardingStore } from './store';

const tempPath = () => join(mkdtempSync(join(tmpdir(), 'onboarding-')), 'onboarding.json');
const saved = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('OnboardingStore', () => {
  it('starts setup on a fresh install', () => {
    const path = tempPath();
    expect(new OnboardingStore(path, true).pending).toBe(true);
    expect(saved(path)).toMatchObject({ status: 'pending' });
  });

  it('leaves installs from before setup existed alone', () => {
    const path = tempPath();
    expect(new OnboardingStore(path, false).pending).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('opens again after quitting halfway', () => {
    const path = tempPath();
    new OnboardingStore(path, true);
    // The second launch has settings by now, so it isn't a first run.
    expect(new OnboardingStore(path, false).pending).toBe(true);
  });

  it('stays closed once finished or skipped', () => {
    for (const outcome of ['finished', 'skipped'] as const) {
      const path = tempPath();
      const store = new OnboardingStore(path, true);
      store.complete(outcome);
      expect(store.pending).toBe(false);
      expect(saved(path)).toMatchObject({ status: outcome });
      expect(new OnboardingStore(path, false).pending).toBe(false);
    }
  });

  it('treats a file it can’t read as no record', () => {
    const path = tempPath();
    writeFileSync(path, 'not json');
    expect(new OnboardingStore(path, false).pending).toBe(false);
    writeFileSync(path, JSON.stringify({ status: 'whenever' }));
    expect(new OnboardingStore(path, false).pending).toBe(false);
  });
});
