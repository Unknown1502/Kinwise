import {AccessibilityInfo} from 'react-native';

/**
 * Browser-preview version of announce(): react-native-web's announceForAccessibility is a
 * no-op, so we write to a visually hidden aria-live region (read by NVDA/VoiceOver/ChromeVox)
 * and emit a `kinwise:announce` event the preview chrome shows as "VoiceView would say…".
 */
let region: HTMLElement | null = null;

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (region && document.body.contains(region)) return region;
  region = document.createElement('div');
  region.id = 'kinwise-announcer';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'assertive');
  region.setAttribute('aria-atomic', 'true');
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.appendChild(region);
  return region;
}

export function announce(message: string): void {
  if (!message) return;
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // ignore
  }
  const el = liveRegion();
  if (el) {
    // Clear first so repeating the same sentence is announced again.
    el.textContent = '';
    setTimeout(() => {
      el.textContent = message;
    }, 30);
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kinwise:announce', {detail: message}));
  }
}
