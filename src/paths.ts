import { createHash } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';

/**
 * On-disk schema version. Bump when the persisted index shape changes in a
 * backward-incompatible way. The cache directory is namespaced by this value
 * (`…/hybindex/v<SCHEMA_VERSION>/…`) so two app versions on different schemas
 * never read each other's files.
 */
export const SCHEMA_VERSION = 4;

/**
 * Root of the shared, app-agnostic index cache. The derived index is a
 * rebuildable lookup table, so it lives in per-machine local storage — NOT in
 * the (git-tracked) world folder.
 *
 * - Windows:      %LOCALAPPDATA%\Erisco\hybindex
 * - macOS/Linux:  ~/.config/Erisco/hybindex
 *
 * Every consumer resolves the same base. The cache under it is namespaced by
 * `SCHEMA_VERSION`, so two apps share one cache only while they are on the same
 * schema — an app a major version behind reads its own `v<n>` directory beside
 * the current one and rebuilds. The base is shared; the cache is shared only
 * when the versions agree.
 *
 * `HYBINDEX_CACHE_DIR` overrides the base entirely (used by tests, and
 * available as an escape hatch). Pure `os`/`process.env` — no Electron dep, so
 * the package stays usable from any Node context.
 */
export function resolveCacheBase(): string {
  const override = process.env.HYBINDEX_CACHE_DIR;
  if (override) return override;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(local, 'Erisco', 'hybindex');
  }
  return join(homedir(), '.config', 'Erisco', 'hybindex');
}

/**
 * The pre-1.1.0 base on POSIX, which spelled the vendor directory `erisco`.
 * Every other Erisco app writes `Erisco` on every platform, so this package was
 * the one exception, and only where it was invisible: NTFS and APFS are
 * case-insensitive, so `erisco` and `Erisco` are one directory on Windows and
 * macOS. Linux is case-sensitive, and there a user got two sibling vendor
 * directories.
 *
 * Returns null when there is nothing that could need moving — on Windows, which
 * never wrote the lowercase form, and under a `HYBINDEX_CACHE_DIR` override,
 * which replaces the base outright. See `migrateLegacyCacheBase` in storage.ts.
 */
export function getLegacyCacheBase(): string | null {
  if (process.env.HYBINDEX_CACHE_DIR) return null;
  if (process.platform === 'win32') return null;
  return join(homedir(), '.config', 'erisco', 'hybindex');
}

/**
 * Normalize a library path so the same library always maps to the same key:
 * absolute, forward slashes, lowercased Windows drive letter, no trailing slash.
 */
function normalizeLibraryPath(libraryPath: string): string {
  let norm = resolve(libraryPath).replace(/\\/g, '/').replace(/\/+$/, '');
  norm = norm.replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
  return norm;
}

/**
 * Stable, filesystem-safe key identifying one library's cache. Different
 * libraries (e.g. Hybrasyl's `world` and `ceridwen`) must never collide, so the
 * key is `<worldName>-<sha1(normalizedAbsPath)>`:
 *
 * - The sha1 of the full normalized path guarantees uniqueness even when two
 *   libraries share a folder name.
 * - `<worldName>` is a human-readable prefix taken from the PARENT directory,
 *   because Creidhne library paths are `…/<worldName>/xml` — the leaf is always
 *   `xml`. Parent of `…/world/xml` → `world`; `…/ceridwen/xml` → `ceridwen`.
 */
export function worldKey(libraryPath: string): string {
  const norm = normalizeLibraryPath(libraryPath);
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 12);
  const parts = norm.split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  const worldName = (leaf.toLowerCase() === 'xml' ? parent : leaf) || 'world';
  const safe = worldName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe}-${hash}`;
}

/**
 * Resolved cache directory for one library's index:
 * `<cacheBase>/v<SCHEMA_VERSION>/<worldKey>/`. This is where the per-type index
 * files (`_meta.json`, `castables.json`, …) and `_filecache.json` live.
 */
export function getIndexDir(libraryPath: string): string {
  return join(resolveCacheBase(), `v${SCHEMA_VERSION}`, worldKey(libraryPath));
}

/** Path to a per-type or meta index file inside the library's cache dir. */
export function getIndexFilePath(libraryPath: string, name: string): string {
  return join(getIndexDir(libraryPath), `${name}.json`);
}

/** The incremental-build signature manifest, inside the library's cache dir. */
export function getFileCachePath(libraryPath: string): string {
  return join(getIndexDir(libraryPath), '_filecache.json');
}

// ── Legacy in-world location (pre-0.3.0) ─────────────────────────────────────
//
// Before 0.3.0 the index lived alongside the authoritative constants.json /
// formulas.json in `world/.creidhne/`. These helpers still point there so the
// one-time cleanup (storage.cleanupInWorldIndex) can remove the stale, now
// git-polluting copies. Authoritative files in that dir are left untouched.

/** Path to the in-world `.creidhne/` dir (one level up from `world/xml/`). */
export function getCreidhneDir(libraryPath: string): string {
  return join(libraryPath, '..', '.creidhne');
}

/** Legacy single-file index path (in-world). */
export function getLegacyIndexPath(libraryPath: string): string {
  return join(getCreidhneDir(libraryPath), 'index.json');
}

/** Path to a per-type/meta file in the legacy in-world layout. */
export function getInWorldIndexFilePath(libraryPath: string, name: string): string {
  return join(getCreidhneDir(libraryPath), `${name}.json`);
}
