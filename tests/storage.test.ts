import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  buildIndex,
  buildSection,
  deleteIndex,
  getCreidhneDir,
  getIndexFilePath,
  getLegacyIndexPath,
  getIndexStatus,
  loadIndex,
  saveIndex,
  saveSection,
} from '../src/index.js';
import { castableXml, cleanup, itemXml, makeWorldTemp, writeXml } from './helpers.js';

let libraryPath: string;
let root: string;

beforeEach(async () => {
  const t = await makeWorldTemp();
  libraryPath = t.libraryPath;
  root = t.root;
});

afterEach(async () => {
  await cleanup(root);
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

  it('writes per-type files directly under .creidhne/', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    const entries = await fs.readdir(getCreidhneDir(libraryPath));
    expect(entries).toContain('_meta.json');
    expect(entries).toContain('castables.json');
    expect(entries).toContain('items.json');
    // No leftover .tmp files from atomic writes
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});

// ── Legacy migration ────────────────────────────────────────────────────────

describe('legacy migration', () => {
  it('migrates legacy index.json to the per-type layout on first load and deletes it', async () => {
    // Seed the legacy single-file index
    const legacy = {
      libraryPath,
      builtAt: '2025-01-01T00:00:00.000Z',
      castables: ['Legacy Castable'],
      items: [],
      statuses: [],
      castablesNamesByFilename: { 'l.xml': 'Legacy Castable' },
      castableFilenames: { 'Legacy Castable': 'l.xml' },
    };
    const legacyPath = getLegacyIndexPath(libraryPath);
    await fs.writeFile(legacyPath, JSON.stringify(legacy), 'utf-8');

    const loaded = await loadIndex(libraryPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.castables).toEqual(['Legacy Castable']);

    // Legacy file should be gone
    await expect(fs.access(legacyPath)).rejects.toThrow();

    // New layout should exist
    await expect(fs.access(getIndexFilePath(libraryPath, 'castables'))).resolves.toBeUndefined();
    await expect(fs.access(getIndexFilePath(libraryPath, '_meta'))).resolves.toBeUndefined();
  });

  it('does not migrate if per-type layout already exists', async () => {
    // Pre-populate new layout
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);

    // Also write a stale legacy file
    const legacyPath = getLegacyIndexPath(libraryPath);
    await fs.writeFile(legacyPath, JSON.stringify({ castables: ['Stale'] }), 'utf-8');

    const loaded = await loadIndex(libraryPath);
    expect(loaded!.castables).not.toContain('Stale');

    // Legacy file should have been cleaned up anyway
    await expect(fs.access(legacyPath)).rejects.toThrow();
  });

  it('returns null when neither layout exists', async () => {
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
  it('removes legacy index + all per-type files but preserves other .creidhne files', async () => {
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);
    await fs.writeFile(getLegacyIndexPath(libraryPath), '{}', 'utf-8');
    // Pre-seed an unrelated .creidhne file
    await fs.writeFile(join(getCreidhneDir(libraryPath), 'constants.json'), '{}', 'utf-8');

    await deleteIndex(libraryPath);

    await expect(fs.access(getLegacyIndexPath(libraryPath))).rejects.toThrow();
    await expect(fs.access(getIndexFilePath(libraryPath, '_meta'))).rejects.toThrow();
    await expect(fs.access(getIndexFilePath(libraryPath, 'castables'))).rejects.toThrow();
    // Unrelated files are untouched
    await expect(fs.access(join(getCreidhneDir(libraryPath), 'constants.json'))).resolves.toBeUndefined();
  });
});

// ── getIndexStatus ──────────────────────────────────────────────────────────

describe('getIndexStatus', () => {
  it('reports exists=false when nothing is on disk', async () => {
    const status = await getIndexStatus(libraryPath);
    expect(status.exists).toBe(false);
  });

  it('reports exists=true with builtAt for new layout', async () => {
    const built = await buildIndex(libraryPath);
    await saveIndex(libraryPath, built);
    const status = await getIndexStatus(libraryPath);
    expect(status.exists).toBe(true);
    expect(status.builtAt).toBeDefined();
  });

  it('reports exists=true for legacy layout', async () => {
    await fs.writeFile(
      getLegacyIndexPath(libraryPath),
      JSON.stringify({ builtAt: '2024-01-01T00:00:00.000Z' }),
      'utf-8',
    );
    const status = await getIndexStatus(libraryPath);
    expect(status.exists).toBe(true);
    expect(status.builtAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

// ── Path helpers ────────────────────────────────────────────────────────────

describe('path helpers', () => {
  it('per-type files sit directly under .creidhne/', () => {
    expect(getIndexFilePath(libraryPath, 'castables'))
      .toBe(join(libraryPath, '..', '.creidhne', 'castables.json'));
  });
});
