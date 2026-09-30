/**
 * Tiny observable store for tab-bar visibility. Written by
 * `useTabBarHidden()` (focus/blur of full-bleed video screens) and read by
 * the custom `BottomTabBar` wrapper in `(tabs)/_layout.tsx`, which forces the
 * navigator to re-render when the value flips.
 */
type Listener = () => void;

let listeners: Listener[] = [];

export const tabBarVisibility = {
  value: false,
  set(next: boolean) {
    if (this.value === next) return;
    this.value = next;
    for (const fn of listeners) fn();
  },
  subscribe(fn: Listener): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
  get() {
    return this.value;
  },
};
