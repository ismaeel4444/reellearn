/**
 * Voice registry for the bundled Kokoro voice pack (spec §7, §16).
 *
 * The MVP ships the `af.bin` voice asset. Kokoro v1.0 voice binaries pack
 * multiple voices into one file; the entries below describe the voices we
 * expose for Latin-language content. Only voices the bundled pack actually
 * contains are listed — no cloud or extra TTS engines.
 */
export interface VoiceOption {
  id: string;
  name: string;
  /** Kokoro voice code used by the runtime in Phase 4. */
  code: string;
  gender: 'female' | 'male';
  accent: string;
}

export const availableVoices: VoiceOption[] = [
  { id: 'af_heart', name: 'Heart', code: 'af_heart', gender: 'female', accent: 'American' },
  { id: 'af_river', name: 'River', code: 'af_river', gender: 'female', accent: 'American' },
  { id: 'af_sarah', name: 'Sarah', code: 'af_sarah', gender: 'female', accent: 'American' },
  { id: 'am_michael', name: 'Michael', code: 'am_michael', gender: 'male', accent: 'American' },
  { id: 'am_adam', name: 'Adam', code: 'am_adam', gender: 'male', accent: 'American' },
  { id: 'am_santa', name: 'Santa', code: 'am_santa', gender: 'male', accent: 'American' },
];

export const defaultVoiceId = 'af_heart';

export function getVoiceById(id: string | null | undefined): VoiceOption {
  return availableVoices.find((v) => v.id === id) ?? availableVoices[0];
}
