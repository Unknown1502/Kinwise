import type {ImageSourcePropType} from 'react-native';

/** Metro hands an imported image over as an asset id; Vite (the browser preview) as a URL string. */
export function asset(mod: unknown): ImageSourcePropType {
  return typeof mod === 'string' ? {uri: mod} : (mod as ImageSourcePropType);
}
