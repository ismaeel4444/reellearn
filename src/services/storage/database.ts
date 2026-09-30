import type { SQLiteDatabase } from 'expo-sqlite';
import { openDatabaseAsync } from 'expo-sqlite';

import { runMigrations } from './migrations';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** Open (once) and migrate the local ReelLearn database. */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync('reellearn.db').then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return dbPromise;
}
