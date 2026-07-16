import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isArchivedPath, listSectionFiles } from '../src/scan.js';
import { sectionSignature } from '../src/filecache.js';
import { castableXml, cleanup, makeWorldTemp, writeArchivedXml, writeXml } from './helpers.js';

let libraryPath: string;
let root: string;
let cacheDir: string;

beforeEach(async () => {
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

describe('isArchivedPath', () => {
  it('matches `.ignore` as a path segment at any depth', () => {
    expect(isArchivedPath('.ignore/old.xml')).toBe(true);
    expect(isArchivedPath('.ignore/nested/old.xml')).toBe(true);
    expect(isArchivedPath('sub/.ignore/old.xml')).toBe(true);
    expect(isArchivedPath('blast.xml')).toBe(false);
    expect(isArchivedPath('fire/blast.xml')).toBe(false);
  });

  it('does not match `.ignore` as a substring', () => {
    // The server tests the whole path with `!x.Contains(".ignore")`, so it also
    // skips these. We deliberately diverge: the substring rule would blank an
    // entire world checked out under a path containing `.ignore`.
    expect(isArchivedPath('sword.ignore.xml')).toBe(false);
    expect(isArchivedPath('old.ignored/x.xml')).toBe(false);
  });
});

describe('listSectionFiles / filecache coupling', () => {
  it('the file cache signature covers exactly the files listSectionFiles enumerates', async () => {
    // If these two ever drift, edits to the files only one of them sees would
    // never invalidate the cache and the index would freeze at its first build.
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    await writeXml(libraryPath, 'castables', 'fire/b.xml', castableXml('B'));
    await writeArchivedXml(libraryPath, 'castables', 'old.xml', castableXml('C'));
    await writeArchivedXml(libraryPath, 'castables', 'deep/older.xml', castableXml('D'));

    const { active, archived } = await listSectionFiles(libraryPath, 'castables');
    const sig = await sectionSignature(libraryPath, 'castables');

    expect(sig.map((s) => s.path).sort()).toEqual(
      [...active, ...archived].map((rel) => `castables/${rel}`).sort(),
    );
  });

  it('splits active from archived and returns sorted, forward-slashed paths', async () => {
    await writeXml(libraryPath, 'castables', 'z.xml', castableXml('Z'));
    await writeXml(libraryPath, 'castables', 'fire/a.xml', castableXml('A'));
    await writeArchivedXml(libraryPath, 'castables', 'nested/old.xml', castableXml('Old'));

    const { active, archived } = await listSectionFiles(libraryPath, 'castables');
    expect(active).toEqual(['fire/a.xml', 'z.xml']);
    expect(archived).toEqual(['.ignore/nested/old.xml']);
  });

  it('returns empty lists for a type directory that does not exist', async () => {
    const { active, archived } = await listSectionFiles(libraryPath, 'recipes');
    expect(active).toEqual([]);
    expect(archived).toEqual([]);
  });

  it('matches the extension case-insensitively, preserving the name as written', async () => {
    // The server globs `*.xml` through a case-insensitive filesystem, so it
    // loads all of these. Skipping them here would leave the index disagreeing
    // with what the server actually runs.
    await writeXml(libraryPath, 'castables', 'upper.XML', castableXml('Upper'));
    await writeXml(libraryPath, 'castables', 'mixed.Xml', castableXml('Mixed'));
    await writeXml(libraryPath, 'castables', 'lower.xml', castableXml('Lower'));
    await writeArchivedXml(libraryPath, 'castables', 'old.XML', castableXml('Old'));

    const { active, archived } = await listSectionFiles(libraryPath, 'castables');
    // Names come back exactly as they are on disk — only the match is folded.
    expect(active).toEqual(['lower.xml', 'mixed.Xml', 'upper.XML']);
    expect(archived).toEqual(['.ignore/old.XML']);
  });

  it('still ignores files whose extension merely contains xml', async () => {
    await writeXml(libraryPath, 'castables', 'notes.xmlbak', castableXml('Nope'));
    await writeXml(libraryPath, 'castables', 'real.xml', castableXml('Yes'));
    const { active } = await listSectionFiles(libraryPath, 'castables');
    expect(active).toEqual(['real.xml']);
  });
});
