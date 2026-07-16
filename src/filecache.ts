import { promises as fs } from 'fs';
import { join } from 'path';
import { INDEX_TYPES } from './types.js';
import { getFileCachePath } from './paths.js';
import { listLuaFiles, listSectionFiles } from './scan.js';

/**
 * Incremental-build support. A full `buildIndex` re-reads and re-parses every
 * XML file even when nothing changed. To skip unchanged types we record a
 * cheap, metadata-only signature per type (and for the global scripts scan) and
 * compare it against the previous build's signature. Computing a signature uses
 * only `readdir` + `stat` (no file reads), so it is orders of magnitude cheaper
 * than a rescan.
 *
 * A signature mismatch (file added/removed/renamed/touched, or a checkout that
 * rewrites mtimes) forces that section to rebuild — always safe, never stale.
 */

/** One file's identity within a section signature. */
export interface FileSig {
  /** Path relative to the library root (forward-slashed). */
  path: string;
  mtimeMs: number;
  size: number;
}

/** A section's signature: its files' identities, sorted by path. */
export type SectionSignature = FileSig[];

/** Signatures for every scannable section, keyed by type (plus `scripts`). */
export type FileCache = Record<string, SectionSignature>;

/** The synthetic key for the global Lua scripts / cookie scan. */
export const SCRIPTS_KEY = 'scripts';

async function statSig(full: string, rel: string): Promise<FileSig | null> {
  try {
    const st = await fs.stat(full);
    return { path: rel.replace(/\\/g, '/'), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/** Stat a set of section-relative paths into a sorted signature. */
async function signatureFor(dir: string, base: string, rels: string[]): Promise<SectionSignature> {
  const sigs = await Promise.all(rels.map((rel) => statSig(join(dir, rel), `${base}/${rel}`)));
  return sigs
    .filter((s): s is FileSig => s !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Signature for one type: every `.xml` under its directory, active and archived.
 * Shares `listSectionFiles` with the builder so the two always cover the same
 * files — see the note in scan.ts on why that matters.
 */
export async function sectionSignature(
  libraryPath: string,
  type: string,
): Promise<SectionSignature> {
  const { dir, active, archived } = await listSectionFiles(libraryPath, type);
  return signatureFor(dir, type, [...active, ...archived]);
}

/** Compute the full file cache (every type + the scripts scan). */
export async function computeFileCache(libraryPath: string): Promise<FileCache> {
  const cache: FileCache = {};
  for (const type of INDEX_TYPES) {
    cache[type] = await sectionSignature(libraryPath, type);
  }
  const scriptsDir = join(libraryPath, '..', 'scripts');
  cache[SCRIPTS_KEY] = await signatureFor(scriptsDir, SCRIPTS_KEY, await listLuaFiles(scriptsDir));
  return cache;
}

export function sectionSigEqual(a?: SectionSignature, b?: SectionSignature): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.path !== y.path || x.mtimeMs !== y.mtimeMs || x.size !== y.size) return false;
  }
  return true;
}

export function fileCacheEqual(a: FileCache | null, b: FileCache | null): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!sectionSigEqual(a[k], b[k])) return false;
  }
  return true;
}

export async function loadFileCache(libraryPath: string): Promise<FileCache | null> {
  try {
    const raw = await fs.readFile(getFileCachePath(libraryPath), 'utf-8');
    return JSON.parse(raw) as FileCache;
  } catch {
    return null;
  }
}

export async function writeFileCache(libraryPath: string, cache: FileCache): Promise<void> {
  const filePath = getFileCachePath(libraryPath);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache), 'utf-8');
  await fs.rename(tmp, filePath);
}
