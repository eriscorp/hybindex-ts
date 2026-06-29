import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildIndex,
  buildSection,
  cleanupInWorldIndex,
  deleteIndex,
  fieldsForType,
  getCreidhneDir,
  getIndexDir,
  getIndexFilePath,
  getIndexStatus,
  getLegacyIndexPath,
  loadIndex,
  resolveCacheBase,
  saveIndex,
  saveSection,
  worldKey,
} from '../src/index.js';
import { castableXml, cleanup, itemXml, makeWorldTemp, writeXml } from './helpers.js';

let libraryPath: string;
let root: string;
let cacheDir: string;

beforeEach(async () => {
  // Point the shared cache at an isolated temp dir so tests never touch the
  // real %LOCALAPPDATA%/~/.local location.
  cacheDir = await fs.mkdtemp(join(tmpdir(), 'hybindex-cache-'));
  process.env.HYBINDEX_CACHE_DIR = cacheDir;
  const t = await makeWorldTemp();
  libraryPath = t.libraryPath;
  root = t.root;
});

afterEach(async () => {
  delete process.env.HYBINDEX_CACHE_DIR;
  await cleanup(root);
  await fs.rm(cacheDir, { recursive: true, force: true });
});

// ── Round-trip ──────────────────────────────────────────────────────────────

describe('saveIndex → loadIndex', () => {
  it('preserves fields across a write + read cycle', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword', { shopTab: 'Weapons' }));

    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    const loaded = await loadIndex(libraryPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.castables).toEqual(['Ard Sal']);
    expect(loaded!.items).toEqual(['Sword']);
    expect(loaded!.vendorTabs).toEqual(['Weapons']);
    expect(loaded!.castablesNamesByFilename['a.xml']).toBe('Ard Sal');
    expect(loaded!.libraryPath).toBe(libraryPath);
  });

  it('writes per-type files into the cache dir, not the world folder', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    const entries = await fs.readdir(getIndexDir(libraryPath));
    expect(entries).toContain('_meta.json');
    expect(entries).toContain('castables.json');
    expect(entries).toContain('items.json');
    expect(entries).toContain('_filecache.json');
    // No leftover .tmp files from atomic writes
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);

    // The world folder's .creidhne/ holds no index files.
    const creidhne = await fs.readdir(getCreidhneDir(libraryPath)).catch(() => []);
    expect(creidhne).not.toContain('castables.json');
    expect(creidhne).not.toContain('_meta.json');
  });

  it('the cache dir lives under the configured cache base, not the world', () => {
    const dir = getIndexDir(libraryPath);
    expect(dir.startsWith(resolveCacheBase())).toBe(true);
    expect(dir).not.toContain('.creidhne');
  });
});

// ── In-world cleanup (0.3.0 relocation) ──────────────────────────────────────

describe('in-world cleanup', () => {
  it('saveIndex removes stale pre-0.3.0 index files from the world folder', async () => {
    // Simulate an old in-world index alongside authoritative files.
    const creidhne = getCreidhneDir(libraryPath);
    await fs.mkdir(creidhne, { recursive: true });
    await fs.writeFile(join(creidhne, '_meta.json'), '{"builtAt":"old"}', 'utf-8');
    await fs.writeFile(join(creidhne, 'castables.json'), '{"castables":["Old"]}', 'utf-8');
    await fs.writeFile(getLegacyIndexPath(libraryPath), '{}', 'utf-8');
    await fs.writeFile(join(creidhne, 'constants.json'), '{"keep":true}', 'utf-8');
    await fs.writeFile(join(creidhne, 'formulas.json'), '{"keep":true}', 'utf-8');

    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    // Index files gone, authoritative files untouched.
    await expect(fs.access(join(creidhne, '_meta.json'))).rejects.toThrow();
    await expect(fs.access(join(creidhne, 'castables.json'))).rejects.toThrow();
    await expect(fs.access(getLegacyIndexPath(libraryPath))).rejects.toThrow();
    await expect(fs.access(join(creidhne, 'constants.json'))).resolves.toBeUndefined();
    await expect(fs.access(join(creidhne, 'formulas.json'))).resolves.toBeUndefined();
  });

  it('cleanupInWorldIndex is idempotent when nothing is there', async () => {
    await expect(cleanupInWorldIndex(libraryPath)).resolves.toBeUndefined();
  });

  it('loadIndex returns null when no cache exists (fresh clone / first run)', async () => {
    const loaded = await loadIndex(libraryPath);
    expect(loaded).toBeNull();
  });
});

// ── saveSection ─────────────────────────────────────────────────────────────

describe('saveSection', () => {
  it('updates only the specified section and bumps _meta.builtAt', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword'));

    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);
    const initialMeta = JSON.parse(await fs.readFile(getIndexFilePath(libraryPath, '_meta'), 'utf-8'));

    // Modify disk: add another castable
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Beag Sal'));

    // Wait enough for builtAt to differ
    await new Promise((r) => setTimeout(r, 10));
    const { fields } = await buildSection(libraryPath, 'castables');
    await saveSection(libraryPath, 'castables', fields);

    const reloaded = await loadIndex(libraryPath);
    expect(reloaded!.castables).toEqual(['Ard Sal', 'Beag Sal']);
    expect(reloaded!.items).toEqual(['Sword']); // untouched

    const newMeta = JSON.parse(await fs.readFile(getIndexFilePath(libraryPath, '_meta'), 'utf-8'));
    expect(newMeta.builtAt).not.toBe(initialMeta.builtAt);
  });
});

// ── deleteIndex ─────────────────────────────────────────────────────────────

describe('deleteIndex', () => {
  it('removes all per-type cache files', async () => {
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    await deleteIndex(libraryPath);

    await expect(fs.access(getIndexFilePath(libraryPath, '_meta'))).rejects.toThrow();
    await expect(fs.access(getIndexFilePath(libraryPath, 'castables'))).rejects.toThrow();
    await expect(fs.access(getIndexFilePath(libraryPath, '_filecache'))).rejects.toThrow();
  });
});

// ── getIndexStatus ──────────────────────────────────────────────────────────

describe('getIndexStatus', () => {
  it('reports exists=false when nothing is on disk', async () => {
    const status = await getIndexStatus(libraryPath);
    expect(status.exists).toBe(false);
  });

  it('reports exists=true, not stale, right after a build', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);
    const status = await getIndexStatus(libraryPath);
    expect(status.exists).toBe(true);
    expect(status.builtAt).toBeDefined();
    expect(status.stale).toBe(false);
  });

  it('reports stale=true after a file changes on disk', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('B'));
    const status = await getIndexStatus(libraryPath);
    expect(status.stale).toBe(true);
  });
});

// ── Path helpers ────────────────────────────────────────────────────────────

describe('path helpers', () => {
  it('per-type files sit under the cache dir, namespaced by schema version', () => {
    const dir = getIndexDir(libraryPath);
    expect(getIndexFilePath(libraryPath, 'castables')).toBe(join(dir, 'castables.json'));
    expect(dir).toMatch(/[\\/]v\d+[\\/]/);
  });

  it('worldKey separates distinct libraries that share the xml leaf name', () => {
    const worldXml = join(root, 'world', 'xml');
    const ceridwenXml = join(root, 'ceridwen', 'xml');
    const k1 = worldKey(worldXml);
    const k2 = worldKey(ceridwenXml);
    expect(k1).not.toBe(k2);
    expect(k1.startsWith('world-')).toBe(true);
    expect(k2.startsWith('ceridwen-')).toBe(true);
    // Stable: same path → same key.
    expect(worldKey(worldXml)).toBe(k1);
  });

  it('fieldsForType returns the keys owned by a type', () => {
    const castableFields = fieldsForType('castables');
    expect(castableFields).toContain('castables');
    expect(castableFields).toContain('castableClasses');
    expect(castableFields).not.toContain('items');
  });
});
