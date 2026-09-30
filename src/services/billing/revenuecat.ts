/**
 * RevenueCat integration — one-time purchase hard paywall (Test Store).
 *
 * Config contract:
 *   • RC_TEST_STORE_API_KEY — Test Store key from the RevenueCat dashboard
 *     (Apps and providers → Test configuration → Test Store → API key).
 *     Debug/dev builds only: swap to the platform-specific public key for
 *     release builds — the SDK deliberately crashes in release if it sees a
 *     Test Store key, and Test Store purchases would not go through the
 *     real stores anyway.
 *   • ENTITLEMENT_ID — the RevenueCat entitlement that unlocks the app
 *     (Dashboard → Product catalog → Entitlements).
 *   • Offering: the paywall shown is the app's DEFAULT offering, which renders
 *     the dashboard-designed paywall (react-native-purchases-ui).
 *
 * Gate contract: `useHasAccess()` returns true while the entitlement is
 * active. The root layout renders the paywall route instead of the app until
 * it is. Entitlement changes (purchase / restore / refund) stream through
 * Purchases.addCustomerInfoUpdateListener, so no manual refresh is needed.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  LOG_LEVEL,
} from 'react-native-purchases';

import { isExpoGo } from '@/services/billing/environment';

// ---- Config (fill these in) --------------------------------------------------
/**
 * Test Store API key, loaded from .env (EXPO_PUBLIC_CAT_KEY) — never hardcode
 * or commit it. Public key: safe to embed in the client, but debug/Test Store
 * only. Swap to the platform-specific key for release builds.
 */
export const RC_TEST_STORE_API_KEY = process.env.EXPO_PUBLIC_CAT_KEY ?? '';
/** Entitlement that unlocks the whole app (one-time purchase). */
export const ENTITLEMENT_ID = 'reellearn_unlimited';
// -------------------------------------------------------------------------------

export type BillingState = {
  /** Entitlement active — app unlocked. */
  hasAccess: boolean;
  /** True while SDK init + first customerInfo fetch are in flight. */
  loading: boolean;
  /** True once the SDK finished init and access is known (even if false). */
  ready: boolean;
  /** Raw customer info (exposed for debugging / Customer Center). */
  customerInfo: CustomerInfo | null;
};

let configured = false;

/** Configure the SDK once (idempotent). Safe to call on every mount. */
export function initRevenueCat(): void {
  if (configured) return;
  if (!RC_TEST_STORE_API_KEY) {
    // Missing key: log loudly but don't crash the whole app — paywall will
    // error and the user stays locked (fail-closed).
    console.error(
      '[billing] EXPO_PUBLIC_CAT_KEY is not set. Add it to .env and RESTART Metro (npx expo start -c).'
    );
    configured = true; // don't retry-spam; leave SDK unconfigured
    return;
  }
  configured = true;

  Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  if (Platform.OS === 'android') {
    Purchases.configure({ apiKey: RC_TEST_STORE_API_KEY });
  } else {
    // iOS will use its own platform key when production is set up; the Test
    // Store key works for both platforms during Test Store development.
    Purchases.configure({ apiKey: RC_TEST_STORE_API_KEY });
  }
}

/** Is the unlock entitlement active for this customer? */
export function hasEntitlement(info: CustomerInfo | null): boolean {
  return info != null && info.entitlements.active[ENTITLEMENT_ID] != null;
}

/**
 * App-wide access hook. Configures the SDK on first mount, streams
 * CustomerInfo updates, and derives `hasAccess` from the entitlement.
 */
export function useHasAccess(): BillingState {
  const [state, setState] = useState<BillingState>({
    hasAccess: false,
    loading: true,
    ready: false,
    customerInfo: null,
  });

  useEffect(() => {
    if (isExpoGo()) {
      // Expo Go has no native SDK — treat as locked but ready (UI still runs).
      console.warn('[billing] Expo Go detected — RevenueCat native module unavailable, app stays locked.');
      setState({ hasAccess: false, loading: false, ready: true, customerInfo: null });
      return;
    }

    let mounted = true;
    initRevenueCat();

    const push = (info: CustomerInfo) => {
      if (mounted) {
        setState({
          hasAccess: hasEntitlement(info),
          loading: false,
          ready: true,
          customerInfo: info,
        });
      }
    };

    // Stream every change (purchase, restore, expiration, refund…).
    const listener: CustomerInfoUpdateListener = push;
    Purchases.addCustomerInfoUpdateListener(listener);

    // Initial fetch (covers app restarts with a purchased device).
    Purchases.getCustomerInfo()
      .then(push)
      .catch((err) => {
        // First-launch offline etc. — stay locked, ready, and let retries
        // happen on the paywall screen (it re-fetches on entry).
        console.warn('[billing] initial getCustomerInfo failed:', err);
        if (mounted) {
          setState((s) => ({ ...s, loading: false, ready: true }));
        }
      });

    return () => {
      mounted = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  return state;
}
