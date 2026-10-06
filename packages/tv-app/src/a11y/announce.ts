import {AccessibilityInfo} from 'react-native';

/**
 * Speak a message through the platform screen reader (VoiceView on Vega / Fire TV).
 * announce.web.ts adds an aria-live region for the browser preview, where
 * react-native-web's announceForAccessibility is a no-op.
 */
export function announce(message: string): void {
  if (!message) return;
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // Never let accessibility plumbing break the UI.
  }
}
