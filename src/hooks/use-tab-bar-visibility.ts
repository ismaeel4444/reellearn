import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { tabBarVisibility } from './tab-bar-visibility';

/**
 * Hide the custom bottom tab bar while this screen is focused.
 *
 * Used by the full-bleed video screens (Reels tab feed, /watch/[id]) where
 * the bar would cover the caption / player chrome. The custom bar in
 * `(tabs)/_layout.tsx` reads `tabBarVisibility.value` on every render; this
 * hook bumps the store on focus/blur so the bar shows/hides. On unmount the
 * listener is removed and visibility is restored so navigation never gets
 * stuck bar-less.
 */
export function useTabBarHidden(): void {
  const mounted = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const unsub = tabBarVisibility.subscribe(() => {}); // keep a ref while focused
      mounted.current = true;
      tabBarVisibility.set(true);
      return () => {
        mounted.current = false;
        unsub();
        tabBarVisibility.set(false);
      };
    }, [])
  );
}
