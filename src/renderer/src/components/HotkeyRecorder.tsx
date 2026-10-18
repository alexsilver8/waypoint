import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Platform } from '../../../shared/types';
import { acceleratorFromKeyPress, acceleratorKeys, heldModifiers } from '../accelerator';
import { Keycaps } from './Keycaps';

/** What a window does with the shortcut someone records. */
export interface ShortcutRecorder {
  /** Stops the current shortcut from firing while a new one is being recorded. */
  pause(paused: boolean): void;
  /** Tries the shortcut. Resolves to why it couldn't be used, or nothing when it's in use now. */
  record(accelerator: string): Promise<string | undefined>;
}

interface HotkeyRecorderProps {
  value: string;
  /** The shortcut that works right now, if it isn't `value`. */
  active?: string;
  platform: Platform;
  recorder: ShortcutRecorder;
  /** Setup's big field, with a line under it saying what clicking does. */
  large?: boolean;
}

/** Shows the shortcut as keycaps; click it, then press a new one. */
export function HotkeyRecorder({ value, active, platform, recorder, large }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLButtonElement>(null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  /** What had the keyboard before a click started recording, to hand it back afterwards. */
  const returnFocus = useRef<HTMLElement | null>(null);

  /**
   * Gives the keyboard back once recording ends, if the field only had it for recording. In
   * setup, where clicks don't take focus, ↵ then continues instead of recording again.
   */
  const handBack = useCallback(() => {
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous?.isConnected && document.activeElement === field.current) previous.focus({ preventScroll: true });
  }, []);

  const stop = useCallback(() => {
    // Set now, not on the next render: handing the keyboard back blurs the field, and that mustn't stop it again.
    recordingRef.current = false;
    setRecording(false);
    setHeld([]);
    recorder.pause(false);
    handBack();
  }, [recorder, handBack]);

  const start = () => {
    setError(undefined);
    recordingRef.current = true;
    setRecording(true);
    recorder.pause(true);
    // Windows that keep the keyboard on themselves when clicked (setup does) don't focus the field.
    const previous = document.activeElement;
    returnFocus.current = previous instanceof HTMLElement && previous !== field.current ? previous : null;
    field.current?.focus();
  };

  // A click anywhere else stops recording, even where the click doesn't take focus.
  useEffect(() => {
    if (!recording) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !field.current?.contains(event.target)) stop();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [recording, stop]);

  // Never leave the shortcut paused, e.g. if the step changes while recording.
  useEffect(
    () => () => {
      if (recordingRef.current) recorder.pause(false);
    },
    [recorder],
  );

  const onKeyDown = async (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      stop();
      return;
    }
    const result = acceleratorFromKeyPress(event, platform);
    if (result.kind === 'pending') {
      setHeld(result.modifiers);
    } else if (result.kind === 'invalid') {
      setError(result.reason);
    } else {
      recordingRef.current = false;
      setRecording(false);
      setHeld([]);
      handBack();
      setError(await recorder.record(result.accelerator));
    }
  };

  const notWorking = !recording && active !== value;
  const escapeKey = platform === 'darwin' ? 'esc' : 'Esc';
  return (
    <div className={large ? 'hotkey hotkey--large' : 'hotkey'}>
      <button
        ref={field}
        type="button"
        className="hotkey__field"
        data-recording={recording || undefined}
        onClick={() => (recording ? stop() : start())}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (recording) setHeld(heldModifiers(event, platform));
        }}
        onBlur={() => recordingRef.current && stop()}
        aria-label={recording ? 'Press the new shortcut, or Escape to cancel' : `Shortcut: ${value}. Click to change`}
      >
        {recording ? (
          held.length > 0 ? (
            <Keycaps keys={acceleratorKeys(held.join('+'), platform)} />
          ) : (
            <span className="hotkey__prompt">Press a shortcut…</span>
          )
        ) : (
          <Keycaps keys={acceleratorKeys(value, platform)} />
        )}
      </button>
      {large && !error && !notWorking && (
        <span className="hotkey__hint">
          {recording ? `Press the keys you want, or ${escapeKey} to cancel` : 'Click to record a different one'}
        </span>
      )}
      {error && (
        <span className="hotkey__message" role="alert">
          {error}
        </span>
      )}
      {!error && notWorking && (
        <span className="hotkey__message" role="status">
          {active
            ? `Couldn’t register this one, so ${active} is in use.`
            : 'This shortcut isn’t working. Pick another.'}
        </span>
      )}
    </div>
  );
}
