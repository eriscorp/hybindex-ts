import { join } from 'path';

/**
 * libraryPath is the `world/xml/` directory (Creidhne's convention).
 * The `.creidhne/` data dir is one level up, shared with Taliesin. It also
 * holds `constants.json` and `formulas.json`; per-type index files sit
 * alongside them (flat layout, no `index/` subfolder).
 */
export function getCreidhneDir(libraryPath: string): string {
  return join(libraryPath, '..', '.creidhne');
}

/** Legacy single-file index path. Read-only after migration. */
export function getLegacyIndexPath(libraryPath: string): string {
  return join(getCreidhneDir(libraryPath), 'index.json');
}

/**
 * Path to a per-type or meta index file. Lives directly in `.creidhne/`
 * alongside constants.json / formulas.json.
 */
export function getIndexFilePath(libraryPath: string, name: string): string {
  return join(getCreidhneDir(libraryPath), `${name}.json`);
}
