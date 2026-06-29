import { promises as fs } from 'fs';
import { join } from 'path';
import { INDEX_TYPES } from './types.js';
import { getFileCachePath } from './paths.js';

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

/** Signature of the `.xml` files directly in `dir` (non-recursive). */
async function dirSignature(dir: string, base: string): Promise<FileSig[]> {
  const sigs: FileSig[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.xml')) {
        const s = await statSig(join(dir, e.name), join(base, e.name));
        if (s) sigs.push(s);
      }
    }
  } catch { /* dir may not exist */ }
  return sigs;
}

/** Recursive signature of `.lua` files under `dir`. */
async function luaSignature(dir: string, base: string): Promise<FileSig[]> {
  const sigs: FileSig[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = join(base, e.name);
      if (e.isDirectory()) sigs.push(...(await luaSignature(full, rel)));
      else if (e.isFile() && e.name.endsWith('.lua')) {
        const s = await statSig(full, rel);
        if (s) sigs.push(s);
      }
    }
  } catch { /* dir may not exist */ }
  return sigs;
}

/** Signature for one type: its active dir plus its `.ignore/` archive. */
async function sectionSignature(libraryPath: string, type: string): Promise<SectionSignature> {
  const dir = join(libraryPath, type);
  const active = await dirSignature(dir, type);
  const archived = await dirSignature(join(dir, '.ignore'), `${type}/.ignore`);
  return [...active, ...archived].sort((a, b) => a.path.localeCompare(b.path));
}

/** Compute the full file cache (every type + the scripts scan). */
export async function computeFileCache(libraryPath: string): Promise<FileCache> {
  const cache: FileCache = {};
  for (const type of INDEX_TYPES) {
    cache[type] = await sectionSignature(libraryPath, type);
  }
  const scriptsDir = join(libraryPath, '..', 'scripts');
  cache[SCRIPTS_KEY] = (await luaSignature(scriptsDir, 'scripts')).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
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
