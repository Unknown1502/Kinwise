import React, {createContext, useContext} from 'react';
import {colors} from './theme';

/**
 * What a focusable element sits on. A white focus ring reads on the backdrop, but not on the
 * apricot family card, the light visitor sheet or the Pause's persimmon, so those switch to deep.
 */
export type Surface = 'backdrop' | 'apricot' | 'sheet' | 'persimmon';

const SurfaceContext = createContext<Surface>('backdrop');

export function OnSurface({surface, children}: {surface: Surface; children: React.ReactNode}) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

export function ringColor(surface: Surface): string {
  return surface === 'backdrop' ? colors.white : colors.deep;
}
