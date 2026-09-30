import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';

import { palette } from '@/theme/palette';
import { availableVoices, type VoiceOption } from '@/services/ai/voices';

export interface VoiceSelectorProps {
  selectedId: string;
  onSelect: (voiceId: string) => void;
}

/** Selects among locally installed Kokoro voices (spec §7, §16). */
export function VoiceSelector({ selectedId, onSelect }: VoiceSelectorProps) {
  return (
    <View accessibilityRole="radiogroup">
      {availableVoices.map((voice) => (
        <VoiceRow
          key={voice.id}
          voice={voice}
          selected={voice.id === selectedId}
          onSelect={() => onSelect(voice.id)}
        />
      ))}
    </View>
  );
}

function VoiceRow({
  voice,
  selected,
  onSelect,
}: {
  voice: VoiceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`Voice ${voice.name}, ${voice.accent} ${voice.gender}`}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && { opacity: 0.85 },
      ]}>
      <View style={styles.avatarWrap}>
        <AppText weight="700" size={14} color={selected ? 'default' : 'secondary'}>
          {voice.name.slice(0, 1)}
        </AppText>
      </View>
      <View style={styles.textWrap}>
        <AppText weight="600" size={15}>
          {voice.name}
        </AppText>
        <AppText variant="caption">
          {voice.accent} · {voice.gender}
        </AppText>
      </View>
      {selected ? <AppIcon name="check" size={18} color={palette.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: palette.primary,
    backgroundColor: 'rgba(124, 92, 255, 0.10)',
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, gap: 2 },
});
