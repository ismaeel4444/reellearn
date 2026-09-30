import { StyleSheet, View } from 'react-native';

import { AppButton } from './app-button';
import { AppIcon } from './app-icon';
import { AppText } from './app-text';

import { palette } from '@/theme/palette';

export interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorState({ title, message, onRetry, onDismiss }: ErrorStateProps) {
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}>
      <View style={styles.iconWrap}>
        <AppIcon name="close" size={22} color={palette.danger} />
      </View>
      <View style={styles.textWrap}>
        <AppText weight="700" size={15}>
          {title}
        </AppText>
        <AppText variant="caption" color="secondary">
          {message}
        </AppText>
      </View>
      <View style={styles.actions}>
        {onRetry ? (
          <AppButton label="Retry" onPress={onRetry} variant="secondary" size="md" />
        ) : null}
        {onDismiss ? (
          <AppButton label="Dismiss" onPress={onDismiss} variant="ghost" size="md" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 92, 122, 0.35)',
    backgroundColor: 'rgba(255, 92, 122, 0.08)',
    padding: 16,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 92, 122, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { gap: 4 },
  actions: { flexDirection: 'row', gap: 10 },
});
