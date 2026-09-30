import { Image, StyleSheet, View } from 'react-native';

// Relative path on purpose: `@/` maps into src/, and the artwork lives in the
// root assets/ folder shared with app.json.
const LOGO_SOURCE = require('../../../assets/images/reellearn-logo.png');

export interface LogoProps {
  size?: number;
  showWordmark?: boolean;
}

/**
 * ReelLearn brand logo (user-supplied artwork, includes the wordmark).
 * `reellearn-logo.png` is the full square 1254px original with wordmark;
 * scaled down it works as both mark and full lockup, so `showWordmark` is
 * kept for API compatibility but the artwork always renders complete.
 */
export function Logo({ size = 44, showWordmark = true }: LogoProps) {
  void showWordmark; // wordmark is baked into the artwork
  return (
    <View style={[styles.row, { width: size, height: size }]}>
      <Image
        source={LOGO_SOURCE}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="ReelLearn logo"
      />
    </View>
  );
}

export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={LOGO_SOURCE}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="ReelLearn logo mark"
    />
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'center' },
});
