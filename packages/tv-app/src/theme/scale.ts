/**
 * Kinwise is designed on a 1920×1080 canvas (10-foot UI). In the browser preview the canvas is
 * exactly 1920×1080 and scaled with CSS, so design units map 1:1. On Vega, scale.vega.ts derives
 * the factor from the window width so the same layout fills the TV whatever its logical size.
 */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const UI_SCALE = 1;
