import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { AppIcon, type AppIconName } from './app-icon';
import { AppText } from './app-text';
import { SafeLinearGradient } from './safe-linear-gradient';

import { palette } from '@/theme/palette';

export type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface AppButtonProps {
  label: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  icon?: AppIconName;
  trailingIcon?: AppIconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'md' | 'lg';
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  trailingIcon,
  disabled = false,
  loading = false,
  fullWidth = false,
  size = 'md',
  style,
  accessibilityLabel,
}: AppButtonProps) {
  const height = size === 'lg' ? 56 : 50;
  const radius = size === 'lg' ? 18 : 16;

  if (variant === 'primary') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          { height, borderRadius: radius, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 },
          fullWidth && styles.fullWidth,
          style,
        ]}>
        <SafeLinearGradient
          colors={[palette.gradientFrom, palette.gradientTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <ButtonContent
          label={loading ? 'Please wait…' : label}
          icon={icon}
          trailingIcon={trailingIcon}
          color={palette.white}
        />
      </Pressable>
    );
  }

  const surfaceColor =
    variant === 'danger' ? 'rgba(255, 92, 122, 0.12)' : variant === 'ghost' ? 'transparent' : palette.surface;
  const textColor =
    variant === 'danger' ? palette.danger : variant === 'ghost' ? palette.text : palette.text;
  const borderColor = variant === 'ghost' ? 'transparent' : palette.border;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          borderRadius: radius,
          backgroundColor: surfaceColor,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}>
      <ButtonContent label={label} icon={icon} trailingIcon={trailingIcon} color={textColor} />
    </Pressable>
  );
}

function ButtonContent({
  label,
  icon,
  trailingIcon,
  color,
}: {
  label: string;
  icon?: AppIconName;
  trailingIcon?: AppIconName;
  color: string;
}) {
  const textColor = color === palette.text ? ('default' as const) : ('default' as const);
  void textColor;
  return (
    <>
      {icon ? <AppIcon name={icon} size={20} color={color} /> : null}
      <AppText weight="600" size={16} style={{ color }}>
        {label}
      </AppText>
      {trailingIcon ? <AppIcon name={trailingIcon} size={20} color={color} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
