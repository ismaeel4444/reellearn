import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { palette } from '@/theme/palette';

interface RowItem {
  icon: AppIconName;
  label: string;
  value?: string;
  iconColor?: string;
}

interface Section {
  title: string;
  rows: RowItem[];
}

const SECTIONS: Section[] = [
  {
    title: 'Appearance',
    rows: [{ icon: 'tune', label: 'Theme', value: 'Dark' }],
  },
  {
    title: 'Learning',
    rows: [
      { icon: 'text_snippet', label: 'Caption settings' },
      { icon: 'play_circle', label: 'Playback' },
      { icon: 'quiz', label: 'Quiz preferences' },
    ],
  },
  {
    title: 'Storage',
    rows: [
      { icon: 'video_library', label: 'Downloaded reels' },
      { icon: 'folder', label: 'Storage usage' },
    ],
  },
  {
    title: 'About',
    rows: [
      { icon: 'smart_toy', label: 'About ReelLearn', value: '1.0.0' },
      { icon: 'description', label: 'Privacy' },
      { icon: 'description', label: 'Terms' },
    ],
  },
];

function SettingsRow({ row }: { row: RowItem }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}>
      <View style={styles.rowIconWrap}>
        <AppIcon name={row.icon} size={17} color={row.iconColor ?? palette.primary} />
      </View>
      <AppText size={15} weight="500" style={styles.rowLabel}>
        {row.label}
      </AppText>
      {row.value ? (
        <AppText variant="bodySmall" color="tertiary">
          {row.value}
        </AppText>
      ) : null}
      <AppIcon name="chevron_right" size={17} color={palette.textTertiary} />
    </Pressable>
  );
}

/**
 * Settings screen in the ReelLearn visual language — grouped surface cards,
 * icon + chevron rows. Preferences become functional as each feature lands.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <AppIcon name="chevron_left" size={22} color={palette.text} />
        </Pressable>
        <AppText variant="heading" style={styles.headerTitle}>
          Settings
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <AppText variant="label" color="tertiary" style={styles.sectionTitle}>
              {section.title}
            </AppText>
            <View style={styles.card}>
              {section.rows.map((row) => (
                <SettingsRow key={row.label} row={row} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 42 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  section: { marginBottom: 24, gap: 10 },
  sectionTitle: { marginLeft: 4 },
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(124, 92, 255, 0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1 },
});
