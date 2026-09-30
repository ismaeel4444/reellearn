import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';

import { AppIcon, type AppIconName } from './app-icon';
import { AppText } from './app-text';

import { palette } from '@/theme/palette';

interface TabConfig {
  icon: AppIconName;
  label: string;
}

const TAB_CONFIG: Record<string, TabConfig> = {
  index: { icon: 'home', label: 'Home' },
  create: { icon: 'add_circle', label: 'Create' },
  reels: { icon: 'play_circle', label: 'Reels' },
  library: { icon: 'menu_book', label: 'Library' },
};

/**
 * Custom bottom navigation matching the reference design: flat surface bar,
 * 4 compact icon+label destinations, purple active state, no pill.
 */
export function BottomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key] ?? ({} as (typeof descriptors)[string]);
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { icon: 'grid_view' as AppIconName, label: route.name };

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () =>
          navigation.emit({ type: 'tabLongPress', target: route.key });

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? config.label}
            onPress={onPress}
            onLongPress={onLongPress}
            hitSlop={{ top: 6, bottom: 6 }}
            style={styles.tab}>
            <AppIcon
              name={config.icon}
              size={23}
              color={focused ? palette.primary : palette.textSecondary}
            />
            <AppText
              size={11}
              weight={focused ? '700' : '600'}
              color={focused ? 'primary' : 'tertiary'}>
              {config.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
