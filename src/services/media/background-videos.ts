import type { BackgroundVideo } from '@/models/types';
import { getDatabase, upsertBackgroundVideo } from '@/services/storage';
import { dirs, ensureDataDirectories, importFileToStorage } from '@/services/storage/file-system';

/**
 * Background video system (spec §22). Never hard-codes a single video:
 * videos live in a repository (DB metadata + files under data/backgrounds/)
 * and can be extended with packs or per-reel selection later.
 *
 * The initial gameplay video is simply the first available background.
 */
export const initialBackgroundVideo: Pick<
  BackgroundVideo,
  'id' | 'name' | 'category' | 'durationSec'
> = {
  id: 'minecraft1',
  name: 'Minecraft Gameplay 1',
  category: 'gameplay',
  durationSec: null,
};

/** Seed bundled gameplay video(s) into the repository. Idempotent. */
export async function seedInitialBackgroundVideos(): Promise<void> {
  try {
    const db = await getDatabase();
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM background_videos WHERE id = ?',
      [initialBackgroundVideo.id]
    );
    if (existing) return;

    ensureDataDirectories();
    const asset = require('../../../videos/minecraft1.mp4');
    const { File } = await import('expo-file-system');
    const { Asset } = await import('expo-asset');
    const [loaded] = await Asset.loadAsync(asset);
    if (!loaded) return;
    await loaded.downloadAsync();

    const localUri = loaded.localUri ?? loaded.uri;
    if (!localUri || !localUri.startsWith('file://')) return;

    const src = new File(localUri);
    if (!src.exists) return;
    const dest = new File(dirs.backgrounds, 'minecraft1.mp4');
    const parent = dirs.backgrounds;
    if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
    src.copy(dest);

    await upsertBackgroundVideo(db, {
      id: initialBackgroundVideo.id,
      name: initialBackgroundVideo.name,
      localPath: dest.uri,
      durationSec: initialBackgroundVideo.durationSec,
      category: initialBackgroundVideo.category,
      addedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[seedInitialBackgroundVideos] error seeding background video:', err);
  }
}

/** Import a user-picked video file as a new background. */
export async function addBackgroundVideo(uri: string, name: string): Promise<BackgroundVideo> {
  const db = await getDatabase();
  ensureDataDirectories();
  const { path } = importFileToStorage(uri, dirs.backgrounds, name);
  const video: BackgroundVideo = {
    id: `bg-${Date.now().toString(36)}`,
    name,
    localPath: path,
    durationSec: null,
    category: 'custom',
    addedAt: Date.now(),
  };
  await upsertBackgroundVideo(db, video);
  return video;
}
