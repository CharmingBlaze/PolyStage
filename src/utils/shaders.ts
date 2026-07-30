export interface RetroShaderSettings {
  crtScanlines: boolean;
  lcdGrid: boolean;
  bayerDither: boolean;
  crtCurvature: boolean;
}

export const defaultRetroShaderSettings: RetroShaderSettings = {
  crtScanlines: true,
  lcdGrid: false,
  bayerDither: true,
  crtCurvature: false,
};
