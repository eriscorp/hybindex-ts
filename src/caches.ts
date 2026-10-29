import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { SCHEMA_VERSION, getLegacyCacheBase, resolveCacheBase } from './paths.js';

/**
 * Index cache housekeeping (HTOO-583).
 *
 * Nothing else in this package deletes a cache directory. Each `SCHEMA_VERSION`
 * bump starts a new `v<N>/` tree beside the old one, and a world that moves or
 * is deleted leaves its `<worldKey>/` directory. These functions find those
 * directories and remove them.
 *
 * Nothing calls them automatically. An app calls them from a user action, for
 * example "Clear old indexes". The index is a rebuildable cache, so a removed
 * directory costs a rebuild and nothing else: an app on an older version of
 * this package rebuilds its `v<N>` index on the next load.
 */

/**
 * Why a cache directory can be removed.
 *
 * - `oldSchema`: its schema version is lower than `SCHEMA_VERSION`.
 * - `missingWorld`: the library path in its `_meta.json` does not exist, or it
 *   has no readable `_meta.json`.
 */
export type IndexCacheRemoveReason = 'oldSchema' | 'missingWorld';

/** One index cache directory: `<base>/v<schemaVersion>/<worldKey>/`. */
export interface IndexCacheEntry {
  /** Absolute path to the directory. */
  dir: string;
  schemaVersion: number;
  worldKey: string;
  /** From `_meta.json`, or null when the file is missing or unreadable. */
  libraryPath: string | null;
  /** From `_meta.json`, or null when the file is missing or unreadable. */
  builtAt: string | null;
  /** Total size of the files in the directory, in bytes. */
  sizeBytes: number;
  /** Why the directory can be removed, or null when it must stay. */
  removeReason: IndexCacheRemoveReason | null;
}

export interface PruneIndexCachesOptions {
  /** Return the directories that would be removed, and remove nothing. */
  dryRun?: boolean;
}

const VERSION_DIR = /^v(\d+)$/;

/** The cache bases to scan: the current base, and the previous base when it exists. */
function cacheBases(): string[] {
  const legacy = getLegacyCacheBase();
  const current = resolveCacheBase();
  return legacy && legacy !== current ? [current, legacy] : [current];
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // dir may not exist
  }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      total += await directorySize(full);
    } else if (e.isFile()) {
      total += await fs.stat(full).then((st) => st.size, () => 0);
    }
  }
  return total;
}

async function readMeta(dir: string): Promise<{ libraryPath: string | null; builtAt: string | null }> {
  try {
    const raw = await fs.readFile(join(dir, '_meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as { libraryPath?: unknown; builtAt?: unknown };
    return {
      libraryPath: typeof meta.libraryPath === 'string' ? meta.libraryPath : null,
      builtAt: typeof meta.builtAt === 'string' ? meta.builtAt : null,
    };
  } catch {
    return { libraryPath: null, builtAt: null };
  }
}

async function pathExists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true, () => false);
}

function removeReason(
  schemaVersion: number,
  libraryPath: string | null,
  worldExists: boolean,
): IndexCacheRemoveReason | null {
  // A newer version of this package owns a higher version. Never mark it.
  if (schemaVersion > SCHEMA_VERSION) return null;
  if (schemaVersion < SCHEMA_VERSION) return 'oldSchema';
  return libraryPath === null || !worldExists ? 'missingWorld' : null;
}

/**
 * Every index cache directory under the cache base, and under the previous
 * base (`getLegacyCacheBase`) when it still exists. Each entry tells whether
 * it can be removed, and why.
 *
 * Sorted by schema version, then by `worldKey`.
 */
export async function listIndexCaches(): Promise<IndexCacheEntry[]> {
  const entries: IndexCacheEntry[] = [];
  for (const base of cacheBases()) {
    for (const versionName of await subdirectories(base)) {
      const version = VERSION_DIR.exec(versionName);
      if (!version?.[1]) continue;
      const schemaVersion = parseInt(version[1], 10);
      const versionDir = join(base, versionName);
      for (const key of await subdirectories(versionDir)) {
        const dir = join(versionDir, key);
        const { libraryPath, builtAt } = await readMeta(dir);
        const worldExists = libraryPath !== null && (await pathExists(libraryPath));
        entries.push({
          dir,
          schemaVersion,
          worldKey: key,
          libraryPath,
          builtAt,
          sizeBytes: await directorySize(dir),
          removeReason: removeReason(schemaVersion, libraryPath, worldExists),
        });
      }
    }
  }
  return entries.sort(
    (a, b) => a.schemaVersion - b.schemaVersion || (a.worldKey < b.worldKey ? -1 : a.worldKey > b.worldKey ? 1 : 0),
  );
}

/** Remove `dir` when it is empty. rmdir refuses a non-empty directory. */
async function removeIfEmpty(dir: string): Promise<void> {
  await fs.rmdir(dir).catch(() => { /* not empty, or gone */ });
}

/**
 * Remove each directory that `listIndexCaches` marks with a `removeReason`.
 * Returns the removed entries. With `dryRun`, returns the entries that would
 * be removed, and removes nothing.
 *
 * After the removal, a `v<N>/` directory that is empty is removed too. So is
 * the previous base, when it is empty. A version higher than `SCHEMA_VERSION`
 * is never touched.
 */
export async function pruneIndexCaches(
  options: PruneIndexCachesOptions = {},
): Promise<IndexCacheEntry[]> {
  const marked = (await listIndexCaches()).filter((e) => e.removeReason !== null);
  if (options.dryRun) return marked;

  const removed: IndexCacheEntry[] = [];
  for (const entry of marked) {
    try {
      await fs.rm(entry.dir, { recursive: true, force: true });
      removed.push(entry);
    } catch { /* in use, or no permission — leave it for the next prune */ }
  }

  for (const base of cacheBases()) {
    for (const versionName of await subdirectories(base)) {
      const version = VERSION_DIR.exec(versionName);
      if (!version?.[1] || parseInt(version[1], 10) > SCHEMA_VERSION) continue;
      await removeIfEmpty(join(base, versionName));
    }
  }
  const legacy = getLegacyCacheBase();
  if (legacy && legacy !== resolveCacheBase()) {
    await removeIfEmpty(legacy);
    await removeIfEmpty(dirname(legacy));
  }
  return removed;
}
