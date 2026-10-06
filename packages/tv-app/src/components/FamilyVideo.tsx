import React from 'react';
import type {FamilyVideoProps} from './familyVideoTypes';
import {VideoPlaceholder} from './VideoPlaceholder';

export type {FamilyVideoProps};

/**
 * Portable fallback with no video player: shows who the message is from. Captions are always
 * rendered by the Pause screen itself, so the message is never lost.
 * Overridden by FamilyVideo.web.tsx (browser preview) and FamilyVideo.vega.tsx (Vega OS).
 */
export function FamilyVideo({from, style}: FamilyVideoProps) {
  return <VideoPlaceholder from={from} style={style} />;
}
