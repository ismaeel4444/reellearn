import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';

export { useFonts as useInterFonts };

export const interFontAssets = {
  regular: Inter_400Regular,
  medium: Inter_500Medium,
  semiBold: Inter_600SemiBold,
  bold: Inter_700Bold,
  extraBold: Inter_800ExtraBold,
} as const;
