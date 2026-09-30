/**
 * ReelLearn design palette — from the approved dark-premium design.
 * Single source of truth; Tamagui tokens and themes are built from this.
 */
export const palette = {
  background: '#0F1117',
  surface: '#171B26',
  surfaceElevated: '#1C2130',
  surfaceHover: '#232939',
  border: '#252B3A',
  borderStrong: '#333B52',

  primary: '#7C5CFF',
  primaryDark: '#5A3FE0',
  blue: '#4A90FF',
  accent: '#00E5B7',
  warning: '#FFB020',
  danger: '#FF5C7A',
  captionHighlight: '#FFD84D',

  text: '#F5F7FB',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',

  gradientFrom: '#7C5CFF',
  gradientTo: '#4A90FF',
  gradientPromoFrom: '#2A2550',
  gradientPromoTo: '#171B26',

  white: '#FFFFFF',
  black: '#000000',
} as const;

export type PaletteColor = keyof typeof palette;

/**
 * App-wide layout constants (kept out of Tamagui tokens intentionally).
 * Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32.
 */
export const layout = {
  tabBarHeightIos: 50,
  tabBarHeightAndroid: 80,
  maxContentWidth: 800,
  screenPaddingH: 20,
  cardRadius: 20,
  cardRadiusLg: 24,
  cardRadiusMd: 16,
  controlRadius: 14,
  thumbRadius: 12,
  /** 44pt minimum touch target everywhere. */
  minTouch: 44,
} as const;
