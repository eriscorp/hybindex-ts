import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  buildIndex,
  buildSection,
  cleanupInWorldIndex,
  deleteIndex,
  duplicateNamesFor,
  fieldsForType,
  getCreidhneDir,
  getIndexDir,
  getIndexFilePath,
  getIndexStatus,
  getLegacyCacheBase,
  getLegacyIndexPath,
  INDEX_TYPES,
  loadIndex,
  migrateLegacyCacheBase,
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

  it('refreshes only its own section signature, leaving others stale', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    // Dirty a different section, then save castables.
    await writeXml(libraryPath, 'items', 'new.xml', itemXml('New'));
    const { fields } = await buildSection(libraryPath, 'castables');
    await saveSection(libraryPath, 'castables', fields);

    // items must still register as stale — saving one section must not silently
    // mark the whole world as up to date.
    expect((await getIndexStatus(libraryPath)).stale).toBe(true);
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

  it('spells the vendor directory Erisco on every platform', () => {
    // hybindex was the one thing in the house that lowercased it, and only off
    // Windows — invisible until somebody used Linux, where case matters.
    delete process.env.HYBINDEX_CACHE_DIR;
    const segments = resolveCacheBase().split(/[\\/]/);
    expect(segments).toContain('Erisco');
    expect(segments).not.toContain('erisco');
  });

  it('puts the macOS base in Application Support, with the other Erisco tools', () => {
    delete process.env.HYBINDEX_CACHE_DIR;
    expect(resolveCacheBase('darwin')).toBe(
      join(homedir(), 'Library', 'Application Support', 'Erisco', 'hybindex'),
    );
    expect(resolveCacheBase('linux')).toBe(join(homedir(), '.config', 'Erisco', 'hybindex'));
  });

  it('getLegacyCacheBase names the previous base only where one can exist', () => {
    expect(getLegacyCacheBase()).toBeNull(); // HYBINDEX_CACHE_DIR overrides the base
    delete process.env.HYBINDEX_CACHE_DIR;
    // Windows never used another base, so there is nothing to move.
    expect(getLegacyCacheBase('win32')).toBeNull();
    // Linux: the pre-1.1.0 lowercase spelling.
    expect(getLegacyCacheBase('linux')).toBe(join(homedir(), '.config', 'erisco', 'hybindex'));
    // macOS: the pre-1.2.0 base, the same as the Linux base.
    expect(getLegacyCacheBase('darwin')).toBe(join(homedir(), '.config', 'Erisco', 'hybindex'));
    for (const platform of ['linux', 'darwin'] as const) {
      expect(getLegacyCacheBase(platform)).not.toBe(resolveCacheBase(platform));
    }
  });

  it('fieldsForType returns the keys owned by a type', () => {
    const castableFields = fieldsForType('castables');
    expect(castableFields).toContain('castables');
    expect(castableFields).toContain('castableClasses');
    expect(castableFields).not.toContain('items');
  });

  // Field ownership is hand-maintained across builder.ts and storage.ts. A field
  // missing from FIELD_TO_FILE would land in <type>.json via saveSection but
  // _meta.json via saveIndex, leaving the same field in two files with merge
  // order deciding the winner. Pin the invariant rather than the instance.
  it('every field buildSection emits is owned by that type in FIELD_TO_FILE', async () => {
    for (const type of INDEX_TYPES) {
      const { fields } = await buildSection(libraryPath, type);
      const owned = fieldsForType(type);
      for (const key of Object.keys(fields)) {
        expect(owned, `${type} emits unowned field "${key}"`).toContain(key);
      }
    }
  });
});

// ── Previous cache base migration ───────────────────────────────────────────

describe('migrateLegacyCacheBase', () => {
  it('does nothing while HYBINDEX_CACHE_DIR overrides the base', async () => {
    await expect(migrateLegacyCacheBase()).resolves.toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('is inert on Windows, which never wrote the old spelling', async () => {
    delete process.env.HYBINDEX_CACHE_DIR;
    const home = await fs.mkdtemp(join(tmpdir(), 'hybindex-home-'));
    const priorLocal = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = home;
    const decoy = join(home, 'erisco', 'hybindex');
    await fs.mkdir(decoy, { recursive: true });
    try {
      await expect(migrateLegacyCacheBase()).resolves.toBeUndefined();
      // Even a hand-made lowercase directory is left where it stands: on NTFS
      // the two spellings are one directory, so there is nothing to move.
      await expect(fs.access(decoy)).resolves.toBeUndefined();
    } finally {
      if (priorLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = priorLocal;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  // Only Linux and macOS move anything: Windows never used another base. Linux
  // moves the lowercase spelling, and macOS moves `~/.config/Erisco/hybindex`.
  // On both, the vendor directory that the move empties is
  // `~/.config/erisco`: on macOS that is the same directory as
  // `~/.config/Erisco`. `os.homedir()` reads $HOME on POSIX, which is what lets
  // this run against a temp home instead of the real one.
  describe.skipIf(process.platform === 'win32')('on POSIX', () => {
    let home: string;
    let priorHome: string | undefined;

    beforeEach(async () => {
      delete process.env.HYBINDEX_CACHE_DIR;
      priorHome = process.env.HOME;
      home = await fs.mkdtemp(join(tmpdir(), 'hybindex-home-'));
      process.env.HOME = home;
    });

    afterEach(async () => {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      await fs.rm(home, { recursive: true, force: true });
    });

    it('renames the previous base and drops the emptied vendor directory', async () => {
      const legacy = getLegacyCacheBase()!;
      await fs.mkdir(join(legacy, 'v3'), { recursive: true });
      await fs.writeFile(join(legacy, 'v3', 'marker'), 'x', 'utf-8');

      await migrateLegacyCacheBase();

      const moved = join(resolveCacheBase(), 'v3', 'marker');
      await expect(fs.readFile(moved, 'utf-8')).resolves.toBe('x');
      await expect(fs.access(legacy)).rejects.toThrow();
      // The old vendor directory is gone, not left standing and empty.
      await expect(fs.access(join(home, '.config', 'erisco'))).rejects.toThrow();
    });

    it('leaves both alone when the current base is already in use', async () => {
      // The window where one consumer has upgraded and the other has not.
      const legacy = getLegacyCacheBase()!;
      await fs.mkdir(legacy, { recursive: true });
      await fs.writeFile(join(legacy, 'old'), 'old', 'utf-8');
      await fs.mkdir(resolveCacheBase(), { recursive: true });
      await fs.writeFile(join(resolveCacheBase(), 'new'), 'new', 'utf-8');

      await migrateLegacyCacheBase();

      await expect(fs.readFile(join(legacy, 'old'), 'utf-8')).resolves.toBe('old');
      await expect(fs.readFile(join(resolveCacheBase(), 'new'), 'utf-8')).resolves.toBe('new');
    });

    it('is a no-op, and does not throw, when there is nothing to move', async () => {
      await expect(migrateLegacyCacheBase()).resolves.toBeUndefined();
      await expect(fs.access(resolveCacheBase())).rejects.toThrow();
    });
  });
});

// ── Duplicate name persistence ──────────────────────────────────────────────

describe('duplicate names round-trip', () => {
  it('survives saveIndex → loadIndex in the type\'s own file', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Ard Sal'));

    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    const onDisk = JSON.parse(await fs.readFile(getIndexFilePath(libraryPath, 'castables'), 'utf-8'));
    expect(onDisk.castablesDuplicateNames).toEqual({ 'ard sal': ['a.xml', 'b.xml'] });

    const loaded = await loadIndex(libraryPath);
    expect(loaded!.castablesDuplicateNames).toEqual({ 'ard sal': ['a.xml', 'b.xml'] });
  });

  it('clears once the collision is resolved, via saveSection', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Ard Sal'));
    await saveIndex(libraryPath, await buildIndex(libraryPath));

    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Beag Sal'));
    const { fields } = await buildSection(libraryPath, 'castables');
    await saveSection(libraryPath, 'castables', fields);

    const loaded = await loadIndex(libraryPath);
    expect(loaded!.castablesDuplicateNames).toEqual({});
  });

  it('reads back as empty for an index built before the field existed', async () => {
    // A v3 cache has no duplicate report. duplicateNamesFor must answer {} for
    // it rather than undefined, so a consumer needs no version check.
    await writeXml(libraryPath, 'npcs', 'a.xml', castableXml('Unused'));
    await saveIndex(libraryPath, await buildIndex(libraryPath));
    const path = getIndexFilePath(libraryPath, 'npcs');
    const data = JSON.parse(await fs.readFile(path, 'utf-8'));
    delete data.npcsDuplicateNames;
    await fs.writeFile(path, JSON.stringify(data), 'utf-8');

    const loaded = await loadIndex(libraryPath);
    expect(loaded!.npcsDuplicateNames).toBeUndefined();
    expect(duplicateNamesFor(loaded!, 'npcs')).toEqual({});
  });
});
