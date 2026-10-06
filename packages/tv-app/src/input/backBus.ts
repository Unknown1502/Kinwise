import {useEffect, useRef} from 'react';

/**
 * One place for the remote's Back button.
 * - Vega: remote.vega.ts forwards BackHandler 'hardwareBackPress' here.
 * - Browser preview: tv-preview/src/remote.ts forwards Escape / Backspace here.
 *
 * Listeners run newest-first; the first one that returns true consumes the press.
 * If nobody handles it, Vega falls back to the system behaviour (leave the app).
 */
type BackListener = () => boolean;

const listeners: BackListener[] = [];

export function onBack(listener: BackListener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.lastIndexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitBack(): boolean {
  for (let i = listeners.length - 1; i >= 0; i--) {
    try {
      if (listeners[i]!()) return true;
    } catch (err) {
      console.warn('[kinwise] back handler failed', err);
    }
  }
  return false;
}

/** React hook: `handler` always sees the latest props/state; return true to consume Back. */
export function useBack(handler: () => boolean): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onBack(() => ref.current()), []);
}
