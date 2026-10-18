import {
  ArrowUpRight,
  Check,
  Clipboard,
  ClipboardPaste,
  Command,
  LayoutGrid,
  type LucideIcon,
  Music,
  PersonStanding,
  StickyNote,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type AccessibilityStatus,
  type OnboardingPatch,
  type OnboardingState,
  suggestedShortcuts,
} from '../../../shared/onboarding';
import type { Platform, Tint } from '../../../shared/types';
import { acceleratorKeys, sameShortcut } from '../accelerator';
import { HotkeyRecorder, type ShortcutRecorder } from '../components/HotkeyRecorder';
import { ItemIcon } from '../components/ItemIcon';
import { Keycaps } from '../components/Keycaps';
import { ThemePicker } from '../components/ThemePicker';
import { Toggle } from '../components/Toggle';

/** The keys as this system labels them. */
function keyLabels(platform: Platform) {
  const mac = platform === 'darwin';
  return {
    enter: mac ? '↵' : 'Enter',
    esc: mac ? 'esc' : 'Esc',
    tab: mac ? '⇥' : 'Tab',
    mod: mac ? '⌘' : 'Ctrl',
  };
}

/** A shortcut written out in a sentence or on a button: "⌥ Space" on macOS, "Alt+Space" elsewhere. */
function shortcutText(accelerator: string, platform: Platform): string {
  return acceleratorKeys(accelerator, platform).join(platform === 'darwin' ? ' ' : '+');
}

/** A glossy icon tile, like the launcher's. */
function Tile({ icon: Icon, tint, strokeWidth = 2 }: { icon: LucideIcon; tint: Tint; strokeWidth?: number }) {
  return (
    <span className="icon icon--tile" data-tint={tint} aria-hidden="true">
      <Icon size={16} strokeWidth={strokeWidth} />
    </span>
  );
}

/** A line saying how something stands: listening, it works, what's still to do. */
function Status({
  visual,
  title,
  tone,
  aside,
  children,
}: {
  visual: ReactNode;
  title: string;
  tone?: 'success';
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="status" data-tone={tone}>
      {visual}
      <span className="status__text">
        <span className="status__title">{title}</span>
        <span className="status__detail">{children}</span>
      </span>
      {aside}
    </div>
  );
}

/** Waypoint's app icon: a command bar holding three pigment wells. */
function AppIcon() {
  return (
    <svg className="welcome__icon" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Waypoint">
      <rect width="64" height="64" rx="15" fill="#1b1e2c" />
      <rect x="12" y="23" width="40" height="18" rx="9" fill="none" stroke="#fff" strokeWidth="3.4" />
      <circle cx="23" cy="32" r="3" fill="var(--pigment-blue)" />
      <circle cx="32" cy="32" r="3" fill="var(--pigment-pink)" />
      <circle cx="41" cy="32" r="3" fill="var(--pigment-yellow)" />
    </svg>
  );
}

// ── Welcome ─────────────────────────────────────────────────

export function WelcomeStep({ platform }: { platform: Platform }) {
  const { enter } = keyLabels(platform);
  return (
    <div className="welcome">
      <div className="welcome__hero">
        <AppIcon />
        <h2 className="welcome__title">Your whole computer, a few keys away.</h2>
        <p className="lede">
          Waypoint opens apps, runs commands, keeps notes and remembers what you copy, all from one box you call up with
          a shortcut. Setting it up takes about a minute.
        </p>
      </div>
      <ul className="cards">
        <li className="card">
          <Tile icon={LayoutGrid} tint="blue" />
          <span className="card__title">Apps</span>
          <span className="card__text">Type a few letters and press {enter} to open one.</span>
        </li>
        <li className="card">
          <Tile icon={Command} tint="purple" />
          <span className="card__title">Commands</span>
          <span className="card__text">Snap windows, lock the screen, eject a disk.</span>
        </li>
        <li className="card">
          <Tile icon={StickyNote} tint="yellow" />
          <span className="card__title">Notes</span>
          <span className="card__text">As many as you like, each one a Markdown file.</span>
        </li>
        <li className="card">
          <Tile icon={Clipboard} tint="orange" />
          <span className="card__title">Clipboard</span>
          <span className="card__text">Find anything you copied, even days later.</span>
        </li>
      </ul>
    </div>
  );
}

// ── Shortcut ────────────────────────────────────────────────

interface ShortcutStepProps {
  state: OnboardingState;
  platform: Platform;
  recorder: ShortcutRecorder;
  /** The shortcut has been pressed since it was picked. */
  tried: boolean;
  /** Why the last suggestion picked couldn't be used. */
  pickError?: string;
  onPick(accelerator: string): void;
  onOpenKeyboardSettings(): void;
}

export function ShortcutStep({
  state,
  platform,
  recorder,
  tried,
  pickError,
  onPick,
  onOpenKeyboardSettings,
}: ShortcutStepProps) {
  const { hotkey } = state.settings;
  const working = state.activeHotkey;
  // Spotlight keeps ⌘ Space until its own shortcut is turned off.
  const spotlight = platform === 'darwin' && sameShortcut(hotkey, 'Command+Space', platform);
  return (
    <>
      <p className="intro">
        Press it from any app to open Waypoint, and again to put it away. You can change it any time in Settings.
      </p>
      <div className="well">
        <HotkeyRecorder large value={hotkey} active={working} platform={platform} recorder={recorder} />
        <fieldset className="chips">
          <legend className="visually-hidden">Suggested shortcuts</legend>
          {suggestedShortcuts(platform).map((accelerator) => {
            const picked = sameShortcut(accelerator, hotkey, platform);
            return (
              <button
                key={accelerator}
                type="button"
                className="chip"
                aria-pressed={picked}
                onClick={() => onPick(accelerator)}
              >
                {picked && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}
                {shortcutText(accelerator, platform)}
              </button>
            );
          })}
        </fieldset>
        {pickError && (
          <span className="hotkey__message" role="alert">
            {pickError}
          </span>
        )}
      </div>
      <div aria-live="polite">
        {tried ? (
          <Status tone="success" visual={<Tile icon={Check} tint="green" strokeWidth={2.6} />} title="It works">
            That’s how you’ll open Waypoint from any app.
          </Status>
        ) : spotlight ? (
          <Status
            visual={<Tile icon={TriangleAlert} tint="yellow" strokeWidth={2.4} />}
            title="Spotlight uses ⌘ Space"
            aside={
              <button type="button" className="button" onClick={onOpenKeyboardSettings}>
                Keyboard Settings
                <ArrowUpRight size={13} strokeWidth={2.4} aria-hidden="true" />
              </button>
            }
          >
            Turn off its shortcut under Keyboard Shortcuts › Spotlight, then try it.
          </Status>
        ) : working ? (
          <Status
            visual={<span className="pulse" aria-hidden="true" />}
            title="Try it now"
            aside={<span className="status__aside">Listening…</span>}
          >
            Press {shortcutText(working, platform)}. It works from any app, even with this window behind.
          </Status>
        ) : null}
      </div>
      {state.wayland && (
        <p className="footnote">
          On Wayland, global shortcuts may not reach Waypoint. If it doesn’t answer, bind a shortcut in your desktop’s
          settings that runs <code>waypoint</code>.
        </p>
      )}
    </>
  );
}

// ── Accessibility (macOS) ───────────────────────────────────

export function AccessibilityStep({ status, onOpen }: { status: AccessibilityStatus; onOpen(): void }) {
  return (
    <>
      <p className="intro">
        macOS asks before one app can control another. Turn on Waypoint under Accessibility so it can:
      </p>
      <ul className="group">
        <li className="feature">
          <Tile icon={ClipboardPaste} tint="pink" />
          <span className="feature__text">
            <span className="feature__title">Paste into the app you were in</span>
            <span className="feature__detail">Emoji, gitmoji and commit messages land where you were typing.</span>
          </span>
        </li>
        <li className="feature">
          <ItemIcon icon={{ builtin: 'window-left-half', tint: 'teal' }} />
          <span className="feature__text">
            <span className="feature__title">Move and resize windows</span>
            <span className="feature__detail">Halves, thirds, quarters and the next display.</span>
          </span>
        </li>
        <li className="feature">
          <Tile icon={Music} tint="green" />
          <span className="feature__text">
            <span className="feature__title">Control what’s playing</span>
            <span className="feature__detail">Play, pause and skip, whatever app it’s in.</span>
          </span>
        </li>
      </ul>
      <div aria-live="polite">
        {status === 'allowed' ? (
          <Status
            tone="success"
            visual={<Tile icon={Check} tint="green" strokeWidth={2.6} />}
            title="Waypoint is allowed"
          >
            Pasting, window layouts and media keys all work.
          </Status>
        ) : (
          <Status
            visual={<Tile icon={PersonStanding} tint="gray" />}
            title="Not turned on yet"
            aside={
              <button type="button" className="button button--raised" onClick={onOpen}>
                Open System Settings
                <ArrowUpRight size={13} strokeWidth={2.4} aria-hidden="true" />
              </button>
            }
          >
            Privacy &amp; Security › Accessibility, then switch on Waypoint.
          </Status>
        )}
      </div>
      <p className="footnote">Rather not? Skip it, and anything Waypoint would paste is copied for you instead.</p>
    </>
  );
}

// ── Preferences ─────────────────────────────────────────────

export function PreferencesStep({
  state,
  onUpdate,
}: {
  state: OnboardingState;
  onUpdate(patch: OnboardingPatch): void;
}) {
  const { theme, clipboardHistory, launchAtLogin } = state.settings;
  const loginDescription = state.canLaunchAtLogin
    ? 'Start Waypoint when you log in, so your shortcut always works.'
    : 'Works in the installed app, not when running from source.';
  return (
    <>
      <ThemePicker showLegend value={theme} onChange={(next) => onUpdate({ theme: next })} />
      <div className="group">
        <div className="setting">
          <span className="setting__text">
            <span className="setting__label">Save clipboard history</span>
            <span className="setting__description">
              Find text you copied earlier. Anything a password manager marks as private is skipped, and it stays on
              this computer.
            </span>
          </span>
          <Toggle
            label="Save clipboard history"
            checked={clipboardHistory.enabled}
            onChange={(enabled) => onUpdate({ clipboardHistory: { ...clipboardHistory, enabled } })}
          />
        </div>
        <div className="setting">
          <span className="setting__text">
            <span className="setting__label">Open at login</span>
            <span className="setting__description">{loginDescription}</span>
          </span>
          <Toggle
            label="Open at login"
            checked={launchAtLogin}
            disabled={!state.canLaunchAtLogin}
            onChange={(next) => onUpdate({ launchAtLogin: next })}
          />
        </div>
      </div>
    </>
  );
}

// ── Ready ───────────────────────────────────────────────────

export function ReadyStep({ state, platform }: { state: OnboardingState; platform: Platform }) {
  const { enter, esc, tab, mod } = keyLabels(platform);
  const working = state.activeHotkey;
  return (
    <div className="ready">
      <div className="ready__hero">
        <span className="ready__lead">Open Waypoint from any app with</span>
        <span className="ready__keys">
          <Keycaps keys={acceleratorKeys(working ?? state.settings.hotkey, platform)} />
        </span>
        <span className="ready__hint">
          {working ? 'Press it now to start' : `That shortcut isn’t working yet, so press ${enter} to open Waypoint`}
        </span>
      </div>
      <section className="keys" aria-labelledby="keys-heading">
        <h2 id="keys-heading" className="keys__heading">
          Four keys to know
        </h2>
        <ul className="cards">
          <li className="card">
            <Keycaps keys={[enter]} />
            <span className="card__title">Open</span>
            <span className="card__text">Runs what’s selected.</span>
          </li>
          <li className="card">
            <Keycaps keys={[mod, 'K']} />
            <span className="card__title">Actions</span>
            <span className="card__text">Everything you can do with it.</span>
          </li>
          <li className="card">
            <Keycaps keys={[tab]} />
            <span className="card__title">Scopes</span>
            <span className="card__text">Just apps, notes or your clipboard.</span>
          </li>
          <li className="card">
            <Keycaps keys={[esc]} />
            <span className="card__title">Back</span>
            <span className="card__text">All the way back, then closes.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
