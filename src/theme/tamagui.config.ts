import { createFont, createTamagui, createTokens } from 'tamagui';

import { palette } from './palette';

/**
 * Inter font mapping for Tamagui. Face weights map to the preloaded
 * @expo-google-fonts/inter TTFs (see src/theme/inter.ts).
 */
const interFont = createFont({
  family: 'Inter',
  size: {
    1: 11,
    2: 12,
    3: 13,
    4: 14,
    true: 15,
    5: 16,
    6: 18,
    7: 20,
    8: 23,
    9: 26,
    10: 30,
    11: 34,
    12: 40,
    13: 48,
    14: 56,
  },
  lineHeight: {
    1: 15,
    2: 16,
    3: 18,
    4: 20,
    true: 22,
    5: 24,
    6: 26,
    7: 28,
    8: 31,
    9: 34,
    10: 38,
    11: 42,
    12: 50,
    13: 58,
    14: 66,
  },
  weight: {
    0: '400',
    1: '500',
    2: '600',
    3: '700',
    4: '800',
  },
  letterSpacing: {
    1: 0,
    2: -0.2,
    3: -0.3,
    4: -0.4,
    5: -0.5,
    6: -0.6,
    7: -0.7,
    8: -0.8,
  },
  face: {
    400: { normal: 'Inter_400Regular' },
    500: { normal: 'Inter_500Medium' },
    600: { normal: 'Inter_600SemiBold' },
    700: { normal: 'Inter_700Bold' },
    800: { normal: 'Inter_800ExtraBold' },
  },
});

const sizeTokens = {
  $0: 0,
  '$0.25': 2,
  '$0.5': 4,
  '$0.75': 6,
  $1: 8,
  '$1.5': 12,
  $2: 16,
  '$2.5': 20,
  $3: 24,
  '$3.5': 28,
  $4: 32,
  $5: 40,
  $6: 48,
  $7: 56,
  $8: 64,
  $9: 80,
  $10: 96,
  $11: 112,
  $12: 128,
  $13: 148,
  $14: 168,
  $15: 188,
  $16: 208,
  true: 16,
} as const;

const tokens = createTokens({
  color: { ...palette, background0: '#0A0C12' },
  radius: {
    $0: 0,
    $1: 6,
    $2: 10,
    $3: 14,
    $true: 16,
    $4: 20,
    $5: 26,
    $6: 34,
    $7: 44,
    $round: 999,
  },
  space: sizeTokens,
  size: sizeTokens,
  zIndex: {
    $0: 0,
    $1: 100,
    $2: 200,
    $3: 300,
  },
});

const themes = {
  dark: {
    background: palette.background,
    background0: '#0A0C12',
    backgroundHover: palette.surfaceHover,
    backgroundPress: palette.surfaceHover,
    backgroundFocus: palette.surfaceHover,
    backgroundStrong: palette.surfaceElevated,
    backgroundTransparent: 'rgba(23, 27, 38, 0)',

    color: palette.text,
    colorHover: palette.white,
    colorPress: palette.white,
    colorFocus: palette.white,
    colorTransparent: 'rgba(245, 247, 251, 0)',

    borderColor: palette.border,
    borderColorHover: palette.borderStrong,
    borderColorPress: palette.primary,
    borderColorFocus: palette.primary,

    primary: palette.primary,
    blue: palette.blue,
    accent: palette.accent,
    warning: palette.warning,
    danger: palette.danger,
    captionHighlight: palette.captionHighlight,
    surface: palette.surface,
    surfaceElevated: palette.surfaceElevated,
    textSecondary: palette.textSecondary,
    textTertiary: palette.textTertiary,
  },
  light: {
    // The ReelLearn design is dark-first; light exists only as a sane fallback.
    background: '#F4F5F9',
    background0: '#FFFFFF',
    backgroundHover: '#E9EBF2',
    backgroundPress: '#E9EBF2',
    backgroundFocus: '#E9EBF2',
    backgroundStrong: '#FFFFFF',
    backgroundTransparent: 'rgba(255, 255, 255, 0)',

    color: '#161923',
    colorHover: '#000000',
    colorPress: '#000000',
    colorFocus: '#000000',
    colorTransparent: 'rgba(22, 25, 35, 0)',

    borderColor: '#D9DCE6',
    borderColorHover: '#C2C6D4',
    borderColorPress: palette.primary,
    borderColorFocus: palette.primary,

    primary: palette.primary,
    blue: palette.blue,
    accent: '#00A88A',
    warning: '#B97A00',
    danger: '#D9385B',
    captionHighlight: '#8A6D00',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    textSecondary: '#5B6172',
    textTertiary: '#8A90A2',
  },
} as const;

export const tamaguiConfig = createTamagui({
  fonts: {
    heading: interFont,
    body: interFont,
  },
  themes,
  tokens,
  settings: {
    defaultFont: 'body',
  },
});

export type TamaguiConfig = typeof tamaguiConfig;

export default tamaguiConfig;
