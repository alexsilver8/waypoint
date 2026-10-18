/** First-launch setup: its steps, what its window shows, and its contract with the main process. */
import type { Settings } from './settings';
import type { Platform } from './types';

/**
 * The steps, in order. Accessibility asks for macOS's permission to paste into and move other
 * apps' windows; other systems don't ask, so they skip it.
 */
export type OnboardingStep = 'welcome' | 'shortcut' | 'accessibility' | 'preferences' | 'ready';

export function onboardingSteps(platform: Platform): OnboardingStep[] {
  return platform === 'darwin'
    ? ['welcome', 'shortcut', 'accessibility', 'preferences', 'ready']
    : ['welcome', 'shortcut', 'preferences', 'ready'];
}

/** Shortcuts setup offers with one click, as accelerators. The first is the default. */
export function suggestedShortcuts(platform: Platform): string[] {
  return platform === 'darwin'
    ? ['Alt+Space', 'Control+Space', 'Command+Shift+Space', 'Command+Space']
    : ['Alt+Space', 'Control+Space', 'Control+Shift+Space', 'Control+Alt+Space'];
}

/** Whether macOS lets Waypoint control other apps. Elsewhere there's nothing to allow. */
export type AccessibilityStatus = 'allowed' | 'not-allowed' | 'not-needed';

/** The settings setup shows and changes. */
export type OnboardingSettings = Pick<Settings, 'hotkey' | 'theme' | 'launchAtLogin' | 'clipboardHistory'>;

/** The ones it changes directly; the shortcut goes through `setHotkey`, which checks it works. */
export type OnboardingPatch = Partial<Pick<Settings, 'theme' | 'launchAtLogin' | 'clipboardHistory'>>;

/** Everything the setup window shows. */
export interface OnboardingState {
  settings: OnboardingSettings;
  /** The shortcut that works right now (may differ from `settings.hotkey` if that one failed). */
  activeHotkey?: string;
  steps: OnboardingStep[];
  accessibility: AccessibilityStatus;
  /** Only the installed app can open at login, not a copy run from source. */
  canLaunchAtLogin: boolean;
  /** A Wayland session, where global shortcuts may not reach the app. */
  wayland: boolean;
}

/** How setup ended. Either way it doesn't open by itself again. */
export type OnboardingOutcome = 'finished' | 'skipped';

export const OnboardingChannel = {
  get: 'onboarding:get',
  update: 'onboarding:update',
  setHotkey: 'onboarding:set-hotkey',
  pauseHotkey: 'onboarding:pause-hotkey',
  checkAccessibility: 'onboarding:check-accessibility',
  openAccessibility: 'onboarding:open-accessibility',
  openKeyboardSettings: 'onboarding:open-keyboard-settings',
  finish: 'onboarding:finish',
  /** main → window: the shortcut was pressed while setup is open. */
  hotkeyPressed: 'onboarding:hotkey-pressed',
  /** main → window: settings changed; fetch the state again. */
  changed: 'onboarding:changed',
} as const;

/** What the setup window's preload exposes as `window.onboarding`. */
export interface OnboardingApi {
  platform: Platform;
  get(): Promise<OnboardingState>;
  update(patch: OnboardingPatch): Promise<OnboardingState>;
  /** Tries the shortcut; on failure the previous one stays and `error` says why. */
  setHotkey(accelerator: string): Promise<{ state: OnboardingState; error?: string }>;
  /** Stops the current shortcut from firing while a new one is being recorded. */
  pauseHotkey(paused: boolean): void;
  checkAccessibility(): Promise<AccessibilityStatus>;
  /** Asks macOS for the permission and opens Privacy & Security → Accessibility. */
  openAccessibility(): void;
  /** Opens System Settings → Keyboard, where Spotlight's shortcut can be turned off. */
  openKeyboardSettings(): void;
  /** Closes setup for good and opens the launcher. */
  finish(outcome: OnboardingOutcome): void;
  onHotkeyPressed(listener: () => void): () => void;
  onChanged(listener: () => void): () => void;
}
