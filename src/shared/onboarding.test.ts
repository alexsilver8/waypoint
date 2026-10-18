import { describe, expect, it } from 'vitest';
import { onboardingSteps, suggestedShortcuts } from './onboarding';

describe('onboardingSteps', () => {
  it('asks for Accessibility on macOS, between the shortcut and the preferences', () => {
    expect(onboardingSteps('darwin')).toEqual(['welcome', 'shortcut', 'accessibility', 'preferences', 'ready']);
  });

  it('skips Accessibility where nothing needs allowing', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(onboardingSteps(platform)).toEqual(['welcome', 'shortcut', 'preferences', 'ready']);
    }
  });
});

describe('suggestedShortcuts', () => {
  it('starts with the default shortcut everywhere', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(suggestedShortcuts(platform)[0]).toBe('Alt+Space');
    }
  });

  it('offers ⌘ only on macOS', () => {
    expect(suggestedShortcuts('darwin')).toContain('Command+Space');
    expect(suggestedShortcuts('linux').some((shortcut) => shortcut.includes('Command'))).toBe(false);
  });
});
