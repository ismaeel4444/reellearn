import { useRouter, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { GradientCard } from '@/components/ui/gradient-card';
import { Logo } from '@/components/ui/logo';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StudySetCard } from '@/components/study/study-set-card';
import { strings } from '@/i18n/strings';
import { palette } from '@/theme/palette';
import { listStudySets } from '@/services/storage/repositories';
import { getDatabase } from '@/services/storage/database';
import type { StudySet } from '@/models/types';
import { useEffect, useState, useCallback } from 'react';

export default function HomeScreen() {
  const router = useRouter();
  const [studySets, setStudySets] = useState<StudySet[]>([]);

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      setStudySets(await listStudySets(db));
    } catch (err) {
      console.error('[Home] failed to load study sets', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const visibleSets = studySets.slice(0, 3);
  const hasSets = studySets.length > 0;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Logo size={40} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/settings')}>
          <AppIcon name="settings" size={21} color={palette.textSecondary} />
        </Pressable>
      </View>

      <AppText variant="body" color="secondary" style={styles.tagline}>
        Turn your study material into short, engaging reels.
      </AppText>

      <GradientCard
        onPress={() => router.navigate('/(tabs)/create')}
        colors={[palette.gradientFrom, palette.gradientTo]}
        radius={24}
        style={styles.cta}
        accessibilityLabel={strings.home.createCtaTitle}>
        <View style={styles.ctaInner}>
          <View style={styles.ctaIconWrap}>
            <AppIcon name="add" size={22} color={palette.white} />
          </View>
          <View style={styles.ctaTextWrap}>
            <AppText weight="700" size={19} color="default">
              {strings.home.createCtaTitle}
            </AppText>
            <AppText variant="bodySmall" color="default" style={styles.ctaSubtitle}>
              {strings.home.createCtaSubtitle}
            </AppText>
          </View>
          <AppIcon name="arrow_forward" size={20} color={palette.white} />
        </View>
      </GradientCard>

      {hasSets ? (
        <>
          <SectionHeader
            title={strings.home.studySetsHeader}
            actionLabel={strings.home.seeAll}
            onAction={() => router.navigate('/(tabs)/library')}
          />
          <View style={styles.listWrap}>
            {visibleSets.map((studySet) => {
              const progress =
                studySet.reelCountActual > 0
                  ? (studySet.reelsWatched / studySet.reelCountActual) * 100
                  : 0;
              return (
                <StudySetCard
                  key={studySet.id}
                  studySet={studySet}
                  progressPercent={progress}
                  onPress={() => router.push(`/study-set/${studySet.id}`)}
                />
              );
            })}
          </View>
        </>
      ) : (
        <EmptyState
          icon="auto_awesome"
          title={strings.home.emptyTitle}
          body={strings.home.emptyBody}
          actionLabel={strings.home.createCtaTitle}
          onAction={() => router.navigate('/(tabs)/create')}
        />
      )}

      <GradientCard
        colors={[palette.gradientPromoFrom, palette.gradientPromoTo]}
        radius={20}
        style={styles.promo}>
        <View style={styles.promoInner}>
          <View style={styles.promoIconWrap}>
            <AppIcon name="psychology" size={24} color={palette.primary} />
          </View>
          <View style={styles.promoTextWrap}>
            <AppText weight="700" size={16}>
              {strings.home.promoTitle}
            </AppText>
            <AppText variant="caption" color="secondary">
              {strings.home.promoBody}
            </AppText>
          </View>
        </View>
      </GradientCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  settingsBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: { marginBottom: 20, marginTop: 2 },
  cta: { marginBottom: 28 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  ctaIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTextWrap: { flex: 1, gap: 2 },
  ctaSubtitle: { opacity: 0.85 },
  listWrap: { gap: 12 },
  promo: { marginTop: 28 },
  promoInner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  promoIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 92, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoTextWrap: { flex: 1, gap: 2 },
});
