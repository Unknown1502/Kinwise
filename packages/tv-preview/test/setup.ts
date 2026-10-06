import {configureWebRemote} from '../src/remote';

// jsdom lacks a few browser APIs react-native-web touches.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof (globalThis as {ResizeObserver?: unknown}).ResizeObserver !== 'function') {
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Same keyboard → remote mapping the preview uses.
configureWebRemote();
