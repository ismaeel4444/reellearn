import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';

import { BottomTabBar } from '@/components/ui/bottom-tab-bar';
import { tabBarVisibility } from '@/hooks/tab-bar-visibility';
import { palette } from '@/theme/palette';

/**
 * JS-based bottom tabs with the custom ReelLearn bar (flat surface, purple
 * active state, icon + label per the reference design). Screens render their
 * own headers, so the navigation header stays hidden.
 *
 * The bar can hide itself: full-bleed video screens call `useTabBarHidden()`
 * (see hooks/use-tab-bar-visibility.ts) and this wrapper re-renders the
 * navigator with `tabBar: () => null` when hidden.
 */
export default function TabsLayout() {
  const [hidden, setHidden] = useState(tabBarVisibility.value);

  useEffect(() => tabBarVisibility.subscribe(() => setHidden(tabBarVisibility.value)), []);

  return (
    <Tabs
      // Must render as JSX: the navigator calls `tabBar(props)` directly, so
      // passing the component unwrapped would invoke its hooks outside React.
      tabBar={(props) => (hidden ? null : <BottomTabBar {...props} />)}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.background },
        lazy: true,
      }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="reels" />
      <Tabs.Screen name="library" />
    </Tabs>
  );
}
