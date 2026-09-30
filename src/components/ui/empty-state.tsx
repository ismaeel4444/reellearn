import { StyleSheet, View } from 'react-native';

import { AppButton } from './app-button';
import { AppIcon, type AppIconName } from './app-icon';
import { AppText } from './app-text';

import { palette } from '@/theme/palette';

export interface EmptyStateProps {
  icon: AppIconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.iconWrap}>
        <AppIcon name={icon} size={30} color={palette.primary} />
      </View>
      <AppText variant="heading">{title}</AppText>
      <AppText color="secondary" style={styles.body}>
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <AppButton label={actionLabel} onPress={onAction} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 56,
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: 'rgba(124, 92, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  body: { textAlign: 'center', maxWidth: 300 },
  action: { marginTop: 12, alignSelf: 'stretch', maxWidth: 300 },
});
