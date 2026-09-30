import { UIManager, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Safe LinearGradient wrapper.
 *
 * expo-linear-gradient's JS resolves fine even when the NATIVE view is not in
 * the running binary (e.g. dev client built before the package was added).
 * In that case the view-manager lookup only fails at render time with
 * "Can't find ViewManager 'ExpoLinearGradient' in ViewManagerRegistry" — a
 * full red-screen crash that a require-time try/catch cannot prevent.
 *
 * So before rendering the native view we verify the view manager is actually
 * registered (new-arch Expo adapters register as
 * `ViewManagerAdapter_<Name>`); otherwise we render a solid blend of the two
 * colors, which keeps every purple CTA visually correct.
 */

interface ExpoGradientProps {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

function hasNativeGradientView(): boolean {
  try {
    // Package must at least be resolvable.
    const mod = require('expo-linear-gradient');
    if (!mod?.LinearGradient) return false;

    const names = ['ExpoLinearGradient', 'ViewManagerAdapter_ExpoLinearGradient'];
    for (const name of names) {
      try {
        const config =
          typeof UIManager.getViewManagerConfig === 'function'
            ? UIManager.getViewManagerConfig(name)
            : (UIManager as unknown as Record<string, unknown>)[name];
        if (config != null) return true;
      } catch {
        // Keep probing other names.
      }
    }
    return false;
  } catch {
    return false; // Package missing entirely.
  }
}

const nativeAvailable = hasNativeGradientView();
const ExpoLinearGradient: React.ComponentType<ExpoGradientProps> | null = nativeAvailable
  ? require('expo-linear-gradient').LinearGradient
  : null;

export interface SafeLinearGradientProps {
  colors: [string, string] | string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Never crashes: real gradient when the native view exists, otherwise a solid
 * blend so the UI still reads correctly. Rebuild the dev client with
 * `npx expo run:android` to unlock true gradients.
 */
export function SafeLinearGradient({
  colors,
  start,
  end,
  style,
  children,
}: SafeLinearGradientProps) {
  if (ExpoLinearGradient) {
    return (
      <ExpoLinearGradient colors={colors} start={start} end={end} style={style}>
        {children}
      </ExpoLinearGradient>
    );
  }
  return (
    <View style={[style, { backgroundColor: blend(colors) }]}>{children}</View>
  );
}

/** Simple 50/50 mix of the first and last color for the fallback fill. */
function blend(colors: string[]): string {
  const first = parseHex(colors[0]);
  const last = parseHex(colors[colors.length - 1]);
  if (!first || !last) return colors[0] ?? '#7C5CFF';
  const mix = (a: number, b: number) => Math.round((a + b) / 2);
  return `rgb(${mix(first[0], last[0])}, ${mix(first[1], last[1])}, ${mix(first[2], last[2])})`;
}

function parseHex(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
