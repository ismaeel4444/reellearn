import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { palette } from '@/theme/palette';

export type AppTextVariant =
  | 'display'
  | 'title'
  | 'sectionTitle'
  | 'heading'
  | 'body'
  | 'bodySmall'
  | 'caption'
  | 'label';

export type AppTextWeight = '400' | '500' | '600' | '700' | '800';

export type AppTextColor =
  | 'default'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'primary'
  | 'highlight'
  | 'danger';

/**
 * ReelLearn type hierarchy (reference design):
 * display 34 / title 28 / sectionTitle 24 / heading 20 /
 * body 15 / bodySmall 13 / caption 12.
 */
const VARIANTS: Record<AppTextVariant, TextStyle> = {
  display: { fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -0.8 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  sectionTitle: { fontSize: 24, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  bodySmall: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
};

const COLORS: Record<AppTextColor, string> = {
  default: palette.text,
  secondary: palette.textSecondary,
  tertiary: palette.textTertiary,
  accent: palette.accent,
  primary: palette.primary,
  highlight: palette.captionHighlight,
  danger: palette.danger,
};

export interface AppTextProps {
  variant?: AppTextVariant;
  weight?: AppTextWeight;
  color?: AppTextColor;
  size?: number;
  children?: React.ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

/**
 * Typed text with the ReelLearn hierarchy presets. Values come straight from
 * the palette so themes stay consistent (Tamagui tokens remain available for
 * styled components elsewhere).
 */
export function AppText({
  variant = 'body',
  weight,
  color = 'default',
  size,
  children,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      style={[
        styles.base,
        VARIANTS[variant],
        { color: COLORS[color] },
        weight ? { fontWeight: weight } : null,
        size ? { fontSize: size, lineHeight: Math.round(size * 1.4) } : null,
        style,
      ]}
      {...rest}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: undefined, // Inter is set globally via useFonts + Tamagui defaults
  },
});
