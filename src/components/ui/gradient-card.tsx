import { SafeLinearGradient } from './safe-linear-gradient';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/theme/palette';

export interface GradientCardProps {
  children: React.ReactNode;
  colors?: [string, string];
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  accessibilityLabel?: string;
}

/**
 * Subtle gradient container — used sparingly (primary CTA, promo card),
 * per the design rule "use purple/blue gradients sparingly".
 */
export function GradientCard({
  children,
  colors = [palette.gradientPromoFrom, palette.gradientPromoTo],
  onPress,
  style,
  radius = 20,
  accessibilityLabel,
}: GradientCardProps) {
  const content = (
    <>
      <SafeLinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [{ borderRadius: radius, opacity: pressed ? 0.9 : 1 }, style]}>
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[{ borderRadius: radius }, style]} accessibilityLabel={accessibilityLabel}>
      {content}
    </View>
  );
}
