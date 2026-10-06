import {AccessibilityInfo} from 'react-native';

/**
 * Tracks whether a screen reader (VoiceView on Fire TV) is on.
 *
 * react-tv-space-navigation moves a custom focus, not the native accessibility focus, so the
 * screen reader does not notice D-pad moves by itself. When it is on, focusable components
 * announce their label on focus (see components/FocusButton.tsx).
 */
let enabled = false;
let forced: boolean | undefined;

export function isScreenReaderOn(): boolean {
  return forced ?? enabled;
}

/** The browser preview can simulate VoiceView with ?voiceview=1. */
export function forceScreenReader(on: boolean | undefined): void {
  forced = on;
}

export function watchScreenReader(): () => void {
  let alive = true;
  AccessibilityInfo.isScreenReaderEnabled?.()
    .then((on) => {
      if (alive) enabled = on;
    })
    .catch(() => undefined);
  let sub: {remove?: () => void} | undefined;
  try {
    sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on: boolean) => {
      enabled = on;
    }) as unknown as {remove?: () => void};
  } catch {
    sub = undefined;
  }
  return () => {
    alive = false;
    sub?.remove?.();
  };
}
