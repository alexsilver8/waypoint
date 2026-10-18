import { Check, Flag, Keyboard, type LucideIcon, PersonStanding, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityStatus,
  type OnboardingOutcome,
  type OnboardingPatch,
  type OnboardingState,
  type OnboardingStep,
  onboardingSteps,
} from '../../../shared/onboarding';
import { sameShortcut } from '../accelerator';
import type { ShortcutRecorder } from '../components/HotkeyRecorder';
import { Keycaps } from '../components/Keycaps';
import { PaletteMark } from '../components/PaletteMark';
import { AccessibilityStep, PreferencesStep, ReadyStep, ShortcutStep, WelcomeStep } from './steps';

const api = window.onboarding;
const { platform } = api;
const mac = platform === 'darwin';
const ENTER = mac ? '↵' : 'Enter';
const ESCAPE = mac ? 'esc' : 'Esc';
/** How often to look whether Accessibility was turned on, while its step shows. */
const ACCESSIBILITY_POLL_MS = 1500;
const SPOTLIGHT_ERROR =
  'Spotlight uses ⌘ Space. Turn off its shortcut under System Settings › Keyboard › Keyboard Shortcuts › Spotlight, then pick it again.';

/** Each step's name in the capsule, and its icon and label in the dock. */
const STEPS: Record<OnboardingStep, { title: string; label: string; icon: LucideIcon }> = {
  welcome: { title: 'Welcome to Waypoint', label: 'Welcome', icon: Sparkles },
  shortcut: { title: 'Pick your shortcut', label: 'Shortcut', icon: Keyboard },
  accessibility: { title: 'Allow Accessibility', label: 'Accessibility', icon: PersonStanding },
  preferences: { title: 'Make it yours', label: 'Preferences', icon: SlidersHorizontal },
  ready: { title: 'You’re all set', label: 'Ready', icon: Flag },
};

/** Focuses a step's sheet as it appears, so ↵ and esc work and screen readers read the new step. */
const focusStep = (node: HTMLElement | null) => node?.focus({ preventScroll: true });

/**
 * First-launch setup, in the launcher's panes: the steps in the dock down the left, the step's
 * name in the capsule and the step in the sheet, with Back and Continue along its foot.
 */
export function OnboardingApp() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [index, setIndex] = useState(0);
  /** The furthest step reached. The dock goes back to any step up to it. */
  const [furthest, setFurthest] = useState(0);
  /** The shortcut was pressed since it was picked, so the Shortcut step says it works. */
  const [tried, setTried] = useState(false);
  const [pickError, setPickError] = useState<string>();
  const [accessibility, setAccessibility] = useState<AccessibilityStatus>('not-needed');
  const finished = useRef(false);

  const steps = state?.steps ?? onboardingSteps(platform);
  const step = steps[index] ?? 'welcome';
  const last = index === steps.length - 1;

  useEffect(() => {
    const load = () =>
      void api.get().then((next) => {
        setState(next);
        setAccessibility(next.accessibility);
      });
    load();
    return api.onChanged(load);
  }, []);

  const finish = useCallback((outcome: OnboardingOutcome) => {
    if (finished.current) return;
    finished.current = true;
    api.finish(outcome);
  }, []);

  const goTo = useCallback((next: number) => {
    setIndex(next);
    setFurthest((reached) => Math.max(reached, next));
  }, []);

  const forward = () => (last ? finish('finished') : goTo(index + 1));
  const back = () => index > 0 && goTo(index - 1);
  const keys = useRef({ forward, back });
  keys.current = { forward, back };

  // ↵ continues and esc goes back, unless a control has the keyboard: ↵ on a switch flips it.
  // The appearance picker's radios do nothing with ↵, and clicking one gives it the keyboard.
  // Listening from layout, so the keys work from the moment the first step is on screen.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const onControl =
        event.target instanceof Element &&
        event.target.closest('button, input:not([type="radio"]), select, textarea, a');
      if (event.key === 'Enter' && !onControl) {
        event.preventDefault();
        if (!event.repeat) keys.current.forward();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        keys.current.back();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clicks leave the keyboard with the window, so ↵ still continues after you flip a switch.
  useEffect(() => {
    const keepFocus = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    };
    document.addEventListener('mousedown', keepFocus);
    return () => document.removeEventListener('mousedown', keepFocus);
  }, []);

  // While setup is open the shortcut answers here: it shows the shortcut works, and on the last
  // step it does what it always will, open the launcher.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(
    () =>
      api.onHotkeyPressed(() => {
        if (stepRef.current === 'ready') finish('finished');
        else setTried(true);
      }),
    [finish],
  );

  // macOS doesn't say when Accessibility is turned on, so look while its step shows.
  const watchAccessibility = step === 'accessibility';
  useEffect(() => {
    if (!watchAccessibility) return;
    let live = true;
    const check = () =>
      void api.checkAccessibility().then((status) => {
        if (live) setAccessibility(status);
      });
    check();
    const timer = setInterval(check, ACCESSIBILITY_POLL_MS);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [watchAccessibility]);

  // A new shortcut starts out untried.
  const recorder = useMemo<ShortcutRecorder>(
    () => ({
      pause: (paused) => api.pauseHotkey(paused),
      record: async (accelerator) => {
        const { state: next, error } = await api.setHotkey(accelerator);
        setState(next);
        if (!error) {
          setTried(false);
          setPickError(undefined);
        }
        return error;
      },
    }),
    [],
  );

  const pick = async (accelerator: string) => {
    const { state: next, error } = await api.setHotkey(accelerator);
    setState(next);
    if (error) {
      setPickError(mac && sameShortcut(accelerator, 'Command+Space', platform) ? SPOTLIGHT_ERROR : error);
    } else {
      setPickError(undefined);
      setTried(false);
    }
  };

  const update = (patch: OnboardingPatch) => {
    setState((previous) => (previous ? { ...previous, settings: { ...previous.settings, ...patch } } : previous));
    void api.update(patch).then(setState);
  };

  const primary =
    step === 'welcome'
      ? 'Get Started'
      : step === 'accessibility' && accessibility !== 'allowed'
        ? 'Not Now'
        : last
          ? 'Open Waypoint'
          : 'Continue';

  const view = (() => {
    if (step === 'welcome') return <WelcomeStep platform={platform} />;
    if (!state) return null;
    switch (step) {
      case 'shortcut':
        return (
          <ShortcutStep
            state={state}
            platform={platform}
            recorder={recorder}
            tried={tried}
            pickError={pickError}
            onPick={(accelerator) => void pick(accelerator)}
            onOpenKeyboardSettings={() => api.openKeyboardSettings()}
          />
        );
      case 'accessibility':
        return <AccessibilityStep status={accessibility} onOpen={() => api.openAccessibility()} />;
      case 'preferences':
        return <PreferencesStep state={state} onUpdate={update} />;
      case 'ready':
        return <ReadyStep state={state} platform={platform} />;
    }
  })();

  return (
    <div className="onboarding">
      <nav className="steps" aria-label="Setup steps">
        {steps.map((id, i) => {
          const { label, icon: Icon } = STEPS[id];
          const current = i === index;
          const done = i < furthest && !current;
          return (
            <button
              key={id}
              type="button"
              className="steps__button"
              aria-current={current ? 'step' : undefined}
              aria-label={done ? `${label}, done` : label}
              title={label}
              data-done={done || undefined}
              disabled={i > furthest}
              onClick={() => goTo(i)}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              {done && (
                <span className="steps__check" aria-hidden="true">
                  <Check size={10} strokeWidth={3.5} />
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="onboarding__main">
        <header className="capsule">
          <PaletteMark size={20} />
          <h1 id="step-title" className="capsule__title">
            {STEPS[step].title}
          </h1>
          <span className="capsule__count">
            Step {index + 1} of {steps.length}
          </span>
        </header>

        <section className="sheet">
          <main
            key={step}
            ref={focusStep}
            className="sheet__body"
            data-step={step}
            tabIndex={-1}
            aria-labelledby="step-title"
          >
            {view}
          </main>
          <footer className="footer">
            {last ? (
              <span className="footer__hint">
                Change any of this in Settings
                <Keycaps keys={[mac ? '⌘' : 'Ctrl', ',']} />
              </span>
            ) : (
              <button type="button" className="footer__skip" onClick={() => finish('skipped')}>
                Skip Setup
              </button>
            )}
            <div className="footer__actions">
              {index > 0 && (
                <button type="button" className="footer__button" onClick={back}>
                  Back
                  <Keycaps keys={[ESCAPE]} />
                </button>
              )}
              <button type="button" className="footer__button footer__button--primary" onClick={forward}>
                {primary}
                <Keycaps keys={[ENTER]} />
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
