import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Filesystem enumeration for the index. This module is the single definition of
 * "which files belong to section <type>": both `buildSection` (which reads and
 * parses them) and `filecache.sectionSignature` (which stats them) go through
 * `listSectionFiles`, so the two can never disagree about the file set.
 *
 * That agreement is load-bearing. When the two sides drift — e.g. the builder
 * scanning subdirectories while the signature only sees the top level — edits
 * to the unseen files never invalidate the cache and the index silently freezes
 * at its first build.
 *
 * Scanning is recursive, matching the Hybrasyl server: it loads world XML with
 * `Directory.GetFiles(path, "*.xml", SearchOption.AllDirectories)`, so
 * subdirectories under a type dir are already legal on disk.
 */

/** Max concurrent file reads per section scan (I/O parallelism). */
const READ_CONCURRENCY = 16;

/** Directory name marking a type's archive: content the server never loads. */
const IGNORE_DIR = '.ignore';

/** One section's `.xml` files, split by whether they are archived. */
export interface SectionFiles {
  /** Absolute path to the section directory (`<libraryPath>/<type>`). */
  dir: string;
  /** Active files: type-relative, forward-slashed, sorted. e.g. `fire/blast.xml` */
  active: string[];
  /** Archived files: type-relative, forward-slashed, sorted. e.g. `.ignore/old.xml` */
  archived: string[];
}

/**
 * True when a type-relative path lies under an archive — that is, when any path
 * SEGMENT is exactly `.ignore`, at any depth.
 *
 * This is deliberately stricter than the server, which tests the whole path with
 * `!x.Contains(".ignore")` and so also skips `sword.ignore.xml` and
 * `old.ignored/`. Neither shape exists in the world data, and the substring test
 * would blank an entire world checked out under a path containing `.ignore`.
 */
export function isArchivedPath(relPath: string): boolean {
  return relPath.split('/').includes(IGNORE_DIR);
}

/**
 * Recursively collect files under `dir` whose name ends with `ext`, as paths
 * relative to the original root (forward-slashed, extension kept). `onFile`
 * receives each hit so callers can bucket as they go.
 *
 * Symlinked directories are not followed — `Dirent.isDirectory()` is false for a
 * symlink — so the walk cannot cycle.
 */
async function walk(
  dir: string,
  rel: string,
  ext: string,
  inIgnore: boolean,
  onFile: (relPath: string, archived: boolean) => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir may not exist
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walk(join(dir, e.name), childRel, ext, inIgnore || e.name === IGNORE_DIR, onFile);
    } else if (e.isFile() && e.name.endsWith(ext)) {
      onFile(childRel, inIgnore);
    }
  }
}

/**
 * Plain code-unit ordering, deliberately NOT `localeCompare`: the sort order
 * reaches the persisted index, and `localeCompare` depends on the host's locale
 * data, so it could order two machines' indexes differently. This is the same
 * ordering `Array.prototype.sort()` already applies to the name lists.
 */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Enumerate one type's `.xml` files, active and archived.
 *
 * Results are sorted, which makes the build deterministic: several accumulators
 * (statusCasters, itemVendors, npcStringKeys, formulaUsedBy*, category usedBy)
 * append in file order and are never re-sorted, so raw `readdir` order would let
 * two machines produce different indexes from the same world.
 */
export async function listSectionFiles(libraryPath: string, type: string): Promise<SectionFiles> {
  const dir = join(libraryPath, type);
  const active: string[] = [];
  const archived: string[] = [];
  await walk(dir, '', '.xml', false, (relPath, isArchived) => {
    (isArchived ? archived : active).push(relPath);
  });
  return { dir, active: active.sort(byPath), archived: archived.sort(byPath) };
}

/**
 * Recursively enumerate `.lua` files under `scriptsDir`, relative to it and
 * forward-slashed, with the extension KEPT. Callers that need the extensionless
 * form (the `scripts` index field) strip it themselves.
 */
export async function listLuaFiles(scriptsDir: string): Promise<string[]> {
  const files: string[] = [];
  await walk(scriptsDir, '', '.lua', false, (relPath) => {
    files.push(relPath);
  });
  return files.sort(byPath);
}

/**
 * Read every file named by `rels` (relative to `dir`) concurrently with a
 * bounded pool, returning contents in the SAME order as `rels`. Order
 * preservation is required: the parse pass feeds order-sensitive accumulators,
 * so parsing must follow `rels` order even though reads finish out of order.
 * Unreadable files yield `null` and are skipped by the caller.
 */
export async function readAllInOrder(dir: string, rels: string[]): Promise<(string | null)[]> {
  const results = new Array<string | null>(rels.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= rels.length) return;
      try {
        results[i] = await fs.readFile(join(dir, rels[i]!), 'utf-8');
      } catch {
        results[i] = null;
      }
    }
  };
  const poolSize = Math.min(READ_CONCURRENCY, rels.length);
  await Promise.all(Array.from({ length: poolSize }, worker));
  return results;
}
