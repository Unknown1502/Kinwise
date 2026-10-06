/**
 * Keyboard → "remote control" for the browser preview (react-tv-space-navigation's
 * configureRemoteControl, as in the library README and Amazon's multi-TV sample web path).
 *   Arrow keys → D-pad, Enter → Select, Escape / Backspace → Back.
 * On Vega the same job is done by packages/tv-app/src/remote.vega.ts with TVEventHandler.
 */
import {Directions, SpatialNavigation} from 'react-tv-space-navigation';
import {emitBack} from '../../tv-app/src/input/backBus';

type Direction = `${Directions}`;

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: Directions.UP,
  ArrowDown: Directions.DOWN,
  ArrowLeft: Directions.LEFT,
  ArrowRight: Directions.RIGHT,
  Enter: Directions.ENTER,
};

const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

let configured = false;

export function configureWebRemote(): void {
  if (configured) return;
  configured = true;

  SpatialNavigation.configureRemoteControl({
    remoteControlSubscriber: (callback: (direction: Direction | null) => void) => {
      const listener = (event: KeyboardEvent) => {
        if (isTyping(event.target)) return;
        const direction = KEY_TO_DIRECTION[event.key];
        if (!direction) return;
        event.preventDefault();
        callback(direction);
      };
      window.addEventListener('keydown', listener);
      return listener;
    },
    remoteControlUnsubscriber: (listener: (event: KeyboardEvent) => void) => {
      window.removeEventListener('keydown', listener);
    },
  });

  window.addEventListener('keydown', (event) => {
    if (isTyping(event.target) || !BACK_KEYS.has(event.key)) return;
    event.preventDefault();
    emitBack();
  });
}
