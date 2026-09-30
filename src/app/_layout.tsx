import '@tamagui/native/setup-expo-linear-gradient';
import { DarkTheme, ThemeProvider } from 'expo-router';
import { useFonts } from '@expo-google-fonts/inter';
import { TamaguiProvider } from 'tamagui';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { tamaguiConfig } from '@/theme/tamagui.config';
import { palette } from '@/theme/palette';
import { getDatabase } from '@/services/storage';
import { ensureDataDirectories } from '@/services/storage/file-system';
import { seedInitialBackgroundVideos } from '@/services/media/background-videos';
import { useHasAccess } from '@/services/billing/revenuecat';
import PaywallView from '@/features/billing/paywall-view';
import { ActivityIndicator, View } from 'react-native';

SplashScreen.preventAutoHideAsync();

const DarkNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.primary,
    background: palette.background,
    card: palette.surface,
    text: palette.text,
    border: palette.border,
    notification: palette.accent,
  },
};

export default function RootLayout() {
  const { hasAccess, ready } = useHasAccess();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold'),
    Inter_800ExtraBold: require('@expo-google-fonts/inter/800ExtraBold'),
  });
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        ensureDataDirectories();
        await getDatabase();
        // Seed background videos asynchronously so UI launch is not blocked
        seedInitialBackgroundVideos().catch((e) =>
          console.warn('[ReelLearn] background video seed failed', e)
        );
      } catch (err) {
        console.error('[ReelLearn] startup init failed', err);
      } finally {
        if (!cancelled) setDataReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isReady = (fontsLoaded || fontError != null) && dataReady;

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [isReady]);

  // Safety fallback: dismiss splash screen within 2.5s regardless
  useEffect(() => {
    const timer = setTimeout(() => {
      setDataReady(true);
      SplashScreen.hideAsync().catch(() => undefined);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  if (!isReady && !dataReady) {
    return null; // Splash remains visible until fonts + DB are ready.
  }

  // Hard paywall: until billing is ready we show a splash-like spinner; once
  // ready, non-entitled users see ONLY the paywall route. Entitled users get
  // the whole app. (Access re-evaluates automatically via CustomerInfo
  // updates — purchase on the paywall unlocks the app instantly.)
  if (!ready) {
    return (
      <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
        <ThemeProvider value={DarkNavigationTheme}>
          <SafeAreaProvider>
            <StatusBar style="light" />
            <View style={[styles.root, styles.center]}>
              <ActivityIndicator color={palette.primary} size="large" />
            </View>
          </SafeAreaProvider>
        </ThemeProvider>
      </TamaguiProvider>
    );
  }
  if (!hasAccess) {
    return (
      <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
        <ThemeProvider value={DarkNavigationTheme}>
          <SafeAreaProvider>
            <StatusBar style="light" />
            <PaywallView />
          </SafeAreaProvider>
        </ThemeProvider>
      </TamaguiProvider>
    );
  }

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <ThemeProvider value={DarkNavigationTheme}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.background },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="study-set/[id]" />
            <Stack.Screen name="generation/[id]" />
            <Stack.Screen name="quiz/[id]" />
            <Stack.Screen name="settings" />
          </Stack>
        </SafeAreaProvider>
      </ThemeProvider>
    </TamaguiProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  center: { alignItems: 'center', justifyContent: 'center' },
});
