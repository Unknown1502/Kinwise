import {Dimensions} from 'react-native';

/**
 * Vega override of theme/scale.ts: map the 1920×1080 design canvas onto the TV window.
 * If Vega reports 1920 logical pixels the factor is exactly 1.
 */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

const {width, height} = Dimensions.get('window');
const byWidth = width > 0 ? width / DESIGN_WIDTH : 1;
const byHeight = height > 0 ? height / DESIGN_HEIGHT : 1;

export const UI_SCALE = Math.min(byWidth, byHeight) || 1;
