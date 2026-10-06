/**
 * Fire TV remote → react-tv-space-navigation, for Vega OS.
 *
 * Adapted from Amazon's multi-TV sample (packages/shared-ui/src/app/configureRemoteControl.ts and
 * remote-control/RemoteControlManager.kepler.ts, MIT-0): Vega's React Native exposes
 * TVEventHandler, which delivers HWEvent { eventType: 'up' | 'down' | 'left' | 'right' |
 * 'select' | 'back' | …, eventKeyAction: 0 (down) | 1 (up) }.
 *
 * Back is handled through BackHandler ('hardwareBackPress'), as in the sample's PlayerScreen,
 * so that when Kinwise does not consume it (e.g. on Today at Home) Vega's default applies.
 *
 * Imported once from index.js before the app registers. The browser preview configures its own
 * keyboard mapping in packages/tv-preview/src/remote.ts.
 */
import {BackHandler} from 'react-native';
import type {HWEvent} from 'react-native';
import {Directions, SpatialNavigation} from 'react-tv-space-navigation';
import {emitBack} from './input/backBus';

type Direction = `${Directions}`;
type DirectionListener = (direction: Direction | null) => void;

const EVENT_TYPE_TO_DIRECTION: Record<string, Direction> = {
  up: Directions.UP,
  down: Directions.DOWN,
  left: Directions.LEFT,
  right: Directions.RIGHT,
  select: Directions.ENTER,
};

const listeners = new Set<DirectionListener>();
// TVEventHandler is typed loosely here on purpose, exactly like the sample does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tvEventHandler: any = null;

function handleHWEvent(_component: unknown, event: HWEvent): void {
  // eventKeyAction: 0 = KEY_DOWN, 1 = KEY_UP, -1/undefined = default. Act on key-down only.
  const action = (event as {eventKeyAction?: number}).eventKeyAction;
  if (action !== undefined && action !== 0 && action !== -1) return;
  const direction = EVENT_TYPE_TO_DIRECTION[event.eventType];
  if (!direction) return;
  listeners.forEach((listener) => listener(direction));
}

function ensureTvEventHandler(): void {
  if (tvEventHandler) return;
  // Required lazily (as in the sample) to avoid type issues with Vega's react-native typings.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {TVEventHandler} = require('react-native');
  tvEventHandler = new TVEventHandler();
  tvEventHandler.enable({}, handleHWEvent);
}

SpatialNavigation.configureRemoteControl({
  remoteControlSubscriber: (callback: DirectionListener) => {
    ensureTvEventHandler();
    const listener: DirectionListener = (direction) => callback(direction);
    listeners.add(listener);
    return listener;
  },
  remoteControlUnsubscriber: (listener: DirectionListener) => {
    listeners.delete(listener);
  },
});

BackHandler.addEventListener('hardwareBackPress', () => emitBack());
