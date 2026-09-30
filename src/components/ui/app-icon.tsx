import { isWeb } from 'tamagui';

import { palette } from '@/theme/palette';

import { SymbolView } from 'expo-symbols';

type IconName =
  | 'home'
  | 'add'
  | 'add_circle'
  | 'settings'
  | 'upload_file'
  | 'description'
  | 'image'
  | 'text_snippet'
  | 'movie'
  | 'play_circle'
  | 'play_arrow'
  | 'menu_book'
  | 'auto_awesome'
  | 'psychology'
  | 'smart_toy'
  | 'lightbulb'
  | 'quiz'
  | 'video_library'
  | 'schedule'
  | 'tune'
  | 'folder'
  | 'grid_view'
  | 'arrow_forward'
  | 'chevron_right'
  | 'chevron_left'
  | 'close'
  | 'check'
  | 'delete'
  | 'edit'
  | 'check_circle'
  | 'record_voice_over'
  | 'graphic_eq'
  | 'expand_less'
  | 'expand_more'
  | 'content_copy'
  | 'replay'
  | 'videocam_off'
  | 'pause'
  | 'file_download';

const ICON_MAP: Record<IconName, { md: IconName; ios: string; web: IconName }> = {
  home: { md: 'home', ios: 'house.fill', web: 'home' },
  add: { md: 'add', ios: 'plus', web: 'add' },
  add_circle: { md: 'add_circle', ios: 'plus.circle.fill', web: 'add_circle' },
  settings: { md: 'settings', ios: 'gearshape.fill', web: 'settings' },
  upload_file: { md: 'upload_file', ios: 'square.and.arrow.up', web: 'upload_file' },
  description: { md: 'description', ios: 'doc.text.fill', web: 'description' },
  image: { md: 'image', ios: 'photo.fill', web: 'image' },
  text_snippet: { md: 'text_snippet', ios: 'doc.plaintext.fill', web: 'text_snippet' },
  movie: { md: 'movie', ios: 'film.fill', web: 'movie' },
  play_circle: { md: 'play_circle', ios: 'play.circle.fill', web: 'play_circle' },
  play_arrow: { md: 'play_arrow', ios: 'play.fill', web: 'play_arrow' },
  menu_book: { md: 'menu_book', ios: 'book.fill', web: 'menu_book' },
  auto_awesome: { md: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' },
  psychology: { md: 'psychology', ios: 'brain.head.profile', web: 'psychology' },
  smart_toy: { md: 'smart_toy', ios: 'cpu.fill', web: 'smart_toy' },
  lightbulb: { md: 'lightbulb', ios: 'lightbulb.fill', web: 'lightbulb' },
  quiz: { md: 'quiz', ios: 'questionmark.circle.fill', web: 'quiz' },
  video_library: { md: 'video_library', ios: 'play.rectangle.on.rectangle.fill', web: 'video_library' },
  schedule: { md: 'schedule', ios: 'clock.fill', web: 'schedule' },
  tune: { md: 'tune', ios: 'slider.horizontal.3', web: 'tune' },
  folder: { md: 'folder', ios: 'folder.fill', web: 'folder' },
  grid_view: { md: 'grid_view', ios: 'square.grid.2x2.fill', web: 'grid_view' },
  arrow_forward: { md: 'arrow_forward', ios: 'arrow.forward', web: 'arrow_forward' },
  chevron_right: { md: 'chevron_right', ios: 'chevron.right', web: 'chevron_right' },
  chevron_left: { md: 'chevron_left', ios: 'chevron.left', web: 'chevron_left' },
  close: { md: 'close', ios: 'xmark', web: 'close' },
  check: { md: 'check', ios: 'checkmark', web: 'check' },
  delete: { md: 'delete', ios: 'trash.fill', web: 'delete' },
  edit: { md: 'edit', ios: 'pencil', web: 'edit' },
  check_circle: { md: 'check_circle', ios: 'checkmark.circle.fill', web: 'check_circle' },
  record_voice_over: { md: 'record_voice_over', ios: 'waveform.and.mic', web: 'record_voice_over' },
  graphic_eq: { md: 'graphic_eq', ios: 'waveform', web: 'graphic_eq' },
  expand_less: { md: 'expand_less', ios: 'chevron.up', web: 'expand_less' },
  expand_more: { md: 'expand_more', ios: 'chevron.down', web: 'expand_more' },
  content_copy: { md: 'content_copy', ios: 'doc.on.doc', web: 'content_copy' },
  replay: { md: 'replay', ios: 'arrow.counterclockwise', web: 'replay' },
  videocam_off: { md: 'videocam_off', ios: 'video.slash', web: 'videocam_off' },
  pause: { md: 'pause', ios: 'pause.fill', web: 'pause' },
  file_download: { md: 'file_download', ios: 'arrow.down.doc', web: 'file_download' },
};

export interface AppIconProps {
  name: IconName;
  size?: number;
  color?: string;
}

/**
 * Cross-platform icon: Material Symbols (drawable font) on Android via
 * expo-symbols, SF Symbols on iOS. Web falls back to a text glyph so layout
 * stays stable where symbol fonts are unavailable.
 */
export function AppIcon({ name, size = 22, color = palette.text }: AppIconProps) {
  const icon = ICON_MAP[name];
  if (!icon) return null;

  if (isWeb) {
    return <WebGlyphFallback name={name} size={size} color={color} />;
  }

  return (
    <SymbolView
      tintColor={color}
      name={{ ios: icon.ios as never, android: icon.md, web: icon.web }}
      size={size}
      weight="semibold"
    />
  );
}

const WEB_GLYPHS: Partial<Record<IconName, string>> = {
  home: '⌂',
  add: '+',
  add_circle: '+',
  settings: '⚙',
  upload_file: '↑',
  description: '≡',
  image: '▤',
  text_snippet: '≡',
  movie: '□',
  play_circle: '▶',
  play_arrow: '▶',
  menu_book: '☰',
  auto_awesome: '✦',
  psychology: 'ψ',
  smart_toy: '🤖',
  lightbulb: '💡',
  quiz: '?',
  video_library: '▭',
  schedule: '○',
  tune: '≡',
  folder: '📁',
  grid_view: '⊞',
  arrow_forward: '→',
  chevron_right: '›',
  chevron_left: '‹',
  close: '✕',
  check: '✓',
  delete: '🗑',
  edit: '✎',
  check_circle: '✓',
  record_voice_over: '🎙',
  graphic_eq: '≈',
};

function WebGlyphFallback({ name, size, color }: { name: IconName; size: number; color: string }) {
  const { Text } = require('react-native');
  return (
    <Text style={{ color, fontSize: size * 0.8, fontWeight: '700', textAlign: 'center' }}>
      {WEB_GLYPHS[name] ?? '•'}
    </Text>
  );
}

export type { IconName as AppIconName };
