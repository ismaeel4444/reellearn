import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesError } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';

import { palette } from '@/theme/palette';
import { ENTITLEMENT_ID, hasEntitlement } from '@/services/billing/revenuecat';

/**
 * Hard paywall view — rendered INSTEAD of the app until the unlock
 * entitlement is active (see RootLayout). Renders the RevenueCat
 * dashboard-designed paywall (default offering) fullscreen. There is no
 * close button: this is a one-time purchase that unlocks the whole app.
 *
 * Note: this is a plain component, not a route — the root layout swaps it in
 * and out based on entitlement state, so purchase → unlock → app appears with
 * no navigation calls needed.
 */
export default function PaywallView() {
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <RevenueCatUI.Paywall
        onPurchaseStarted={() => {
          setPurchaseBusy(true);
          setError(null);
        }}
        onPurchaseCompleted={({ customerInfo }: { customerInfo: CustomerInfo }) => {
          setPurchaseBusy(false);
          // Unlock happens automatically: the CustomerInfo listener in
          // useHasAccess() flips hasAccess, and the layout swaps to the app.
          const activeIds = Object.keys(customerInfo.entitlements.active);
          const allIds = Object.keys(customerInfo.entitlements.all);
          console.log(
            `[billing] purchase completed — active entitlements: [${activeIds.join(', ') || 'NONE'}], all: [${allIds.join(', ') || 'NONE'}], expected: "${ENTITLEMENT_ID}"`
          );
          if (!hasEntitlement(customerInfo)) {
            setError(
              allIds.length === 0
                ? `Purchase completed but no entitlement exists yet. Check the entitlement ID (expected: ${ENTITLEMENT_ID}) and that the product is attached to it in the dashboard.`
                : `Entitlement mismatch — active: ${allIds.join(', ')}. Update ENTITLEMENT_ID in revenuecat.ts to match.`
            );
          }
        }}
        onPurchaseError={({ error: err }: { error: PurchasesError }) => {
          setPurchaseBusy(false);
          setError(err?.message ?? 'Purchase failed. Please try again.');
        }}
        onPurchaseCancelled={() => {
          setPurchaseBusy(false);
        }}
        onRestoreCompleted={({ customerInfo }: { customerInfo: CustomerInfo }) => {
          if (!hasEntitlement(customerInfo)) {
            setError('Nothing to restore yet.');
          }
        }}
        onRestoreError={({ error: err }: { error: PurchasesError }) => {
          setError(err?.message ?? 'Restore failed. Please try again.');
        }}
      />
      {purchaseBusy && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="auto">
          <ActivityIndicator color={palette.primary} size="large" />
        </View>
      )}
      {error != null && !purchaseBusy && (
        <View style={styles.errorWrap} pointerEvents="none">
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  errorWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 24,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(180,40,40,0.92)',
  },
  errorText: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
