/** True when running inside Expo Go (no custom native modules available). */
export function isExpoGo(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants');
    return Boolean(Constants?.executionEnvironment === 'storeClient' || Constants?.expoConfig === null && Constants?.manifest != null);
  } catch {
    return false;
  }
}
