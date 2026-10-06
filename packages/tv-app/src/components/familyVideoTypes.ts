import type {ViewStyle} from 'react-native';

/** Props shared by FamilyVideo.tsx (fallback), FamilyVideo.web.tsx (preview) and FamilyVideo.vega.tsx (Vega). */
export interface FamilyVideoProps {
  /** Absolute URL of the caregiver's short Pause video, if any. */
  url?: string;
  /** Who recorded it (shown on the placeholder). */
  from: string;
  style?: ViewStyle;
}
