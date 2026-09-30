import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/theme/palette';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Consistent screen scaffold: dark background, top safe area, optional
 * padding and scrolling. Bottom insets are handled by the tab layout.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
  contentContainerStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const pad = padded ? styles.padded : null;

  if (!scroll) {
    return (
      <View
        style={[
          styles.flex,
          styles.background,
          { paddingTop: insets.top },
          pad,
          style,
        ]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, styles.background, style]}
      contentContainerStyle={[
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 96 },
        pad,
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  background: { backgroundColor: palette.background },
  padded: { paddingHorizontal: 20 },
});
