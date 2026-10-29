import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SCHEMA_VERSION,
  buildIndex,
  getIndexDir,
  getLegacyCacheBase,
  listIndexCaches,
  pruneIndexCaches,
  resolveCacheBase,
  saveIndex,
  worldKey,
} from '../src/index.js';
import { castableXml, cleanup, makeWorldTemp, writeXml } from './helpers.js';

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

/** Write a cache directory by hand: `<base>/v<version>/<key>/`, with an optional `_meta.json`. */
async function fakeCache(
  version: number,
  key: string,
  meta: Record<string, unknown> | null,
  base = cacheDir,
): Promise<string> {
  const dir = join(base, `v${version}`, key);
  await fs.mkdir(dir, { recursive: true });
  if (meta) await fs.writeFile(join(dir, '_meta.json'), JSON.stringify(meta), 'utf-8');
  await fs.writeFile(join(dir, 'castables.json'), '{"castables":[]}', 'utf-8');
  return dir;
}

const exists = (path: string): Promise<boolean> => fs.access(path).then(() => true, () => false);

describe('listIndexCaches', () => {
  it('lists a current cache with its meta and size, and does not mark it', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    await saveIndex(libraryPath, await buildIndex(libraryPath));

    const [entry, ...rest] = await listIndexCaches();

    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      dir: getIndexDir(libraryPath),
      schemaVersion: SCHEMA_VERSION,
      worldKey: worldKey(libraryPath),
      libraryPath,
      removeReason: null,
    });
    expect(typeof entry?.builtAt).toBe('string');
    expect(entry?.sizeBytes).toBeGreaterThan(0);
  });

  it('marks a lower schema version oldSchema, and never a higher one', async () => {
    await fakeCache(SCHEMA_VERSION - 2, 'w-1', { libraryPath });
    await fakeCache(SCHEMA_VERSION - 1, 'w-1', { libraryPath });
    await fakeCache(SCHEMA_VERSION + 1, 'w-1', { libraryPath: join(root, 'gone') });

    const entries = await listIndexCaches();

    expect(entries.map((e) => [e.schemaVersion, e.removeReason])).toEqual([
      [SCHEMA_VERSION - 2, 'oldSchema'],
      [SCHEMA_VERSION - 1, 'oldSchema'],
      [SCHEMA_VERSION + 1, null],
    ]);
  });

  it('marks a cache whose world does not exist missingWorld', async () => {
    await fakeCache(SCHEMA_VERSION, 'gone-1', { libraryPath: join(root, 'gone', 'xml'), builtAt: 'then' });

    const [entry] = await listIndexCaches();

    expect(entry).toMatchObject({ worldKey: 'gone-1', builtAt: 'then', removeReason: 'missingWorld' });
  });

  it('marks a cache without a readable _meta.json missingWorld', async () => {
    await fakeCache(SCHEMA_VERSION, 'nometa-1', null);
    const bad = await fakeCache(SCHEMA_VERSION, 'badmeta-1', null);
    await fs.writeFile(join(bad, '_meta.json'), '{not json', 'utf-8');

    const entries = await listIndexCaches();

    expect(entries.map((e) => [e.worldKey, e.libraryPath, e.removeReason])).toEqual([
      ['badmeta-1', null, 'missingWorld'],
      ['nometa-1', null, 'missingWorld'],
    ]);
  });

  it('ignores files and directories that are not v<N>', async () => {
    await fs.mkdir(join(cacheDir, 'scratch', 'x'), { recursive: true });
    await fs.writeFile(join(cacheDir, 'v9'), 'a file, not a directory', 'utf-8');

    expect(await listIndexCaches()).toEqual([]);
  });

  it('returns nothing when the cache base does not exist', async () => {
    process.env.HYBINDEX_CACHE_DIR = join(cacheDir, 'absent');
    expect(await listIndexCaches()).toEqual([]);
  });
});

describe('pruneIndexCaches', () => {
  it('removes an old schema version and keeps the current one', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    await saveIndex(libraryPath, await buildIndex(libraryPath));
    const old3 = await fakeCache(SCHEMA_VERSION - 2, 'w-1', { libraryPath });
    const old4 = await fakeCache(SCHEMA_VERSION - 1, 'w-1', { libraryPath });

    const removed = await pruneIndexCaches();

    expect(removed.map((e) => e.dir)).toEqual([old3, old4]);
    expect(await exists(getIndexDir(libraryPath))).toBe(true);
    // The emptied v<N> directories go too.
    expect(await exists(join(cacheDir, `v${SCHEMA_VERSION - 2}`))).toBe(false);
    expect(await exists(join(cacheDir, `v${SCHEMA_VERSION - 1}`))).toBe(false);
  });

  it('never touches a version higher than SCHEMA_VERSION', async () => {
    const newer = await fakeCache(SCHEMA_VERSION + 1, 'w-1', { libraryPath: join(root, 'gone') });
    await fs.mkdir(join(cacheDir, `v${SCHEMA_VERSION + 2}`));

    expect(await pruneIndexCaches()).toEqual([]);
    expect(await exists(newer)).toBe(true);
    // Not even an empty one.
    expect(await exists(join(cacheDir, `v${SCHEMA_VERSION + 2}`))).toBe(true);
  });

  it('removes a missingWorld cache and keeps the v<N> that still holds a live one', async () => {
    await saveIndex(libraryPath, await buildIndex(libraryPath));
    const gone = await fakeCache(SCHEMA_VERSION, 'gone-1', { libraryPath: join(root, 'gone') });

    const removed = await pruneIndexCaches();

    expect(removed.map((e) => e.worldKey)).toEqual(['gone-1']);
    expect(await exists(gone)).toBe(false);
    expect(await exists(getIndexDir(libraryPath))).toBe(true);
  });

  it('with dryRun, returns the same list and removes nothing', async () => {
    const old = await fakeCache(SCHEMA_VERSION - 1, 'w-1', { libraryPath });
    const gone = await fakeCache(SCHEMA_VERSION, 'gone-1', null);

    const planned = await pruneIndexCaches({ dryRun: true });

    expect(planned.map((e) => [e.dir, e.removeReason])).toEqual([
      [old, 'oldSchema'],
      [gone, 'missingWorld'],
    ]);
    expect(await exists(old)).toBe(true);
    expect(await exists(gone)).toBe(true);
    expect(await pruneIndexCaches()).toEqual(planned);
  });

  it('keeps the cache base itself, even when it is empty', async () => {
    await fakeCache(SCHEMA_VERSION - 1, 'w-1', { libraryPath });

    await pruneIndexCaches();

    expect(await exists(cacheDir)).toBe(true);
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });
});

// The previous base exists only on POSIX, and only without HYBINDEX_CACHE_DIR.
// `os.homedir()` reads $HOME on POSIX, so the test runs against a temp home.
describe.skipIf(process.platform === 'win32')('the previous cache base', () => {
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

  it('lists and removes old caches under the previous base, then the emptied base', async () => {
    // An app on an older version wrote here after the current base existed,
    // so migrateLegacyCacheBase did not move it.
    const legacy = getLegacyCacheBase()!;
    await fs.mkdir(resolveCacheBase(), { recursive: true });
    const stranded = await fakeCache(SCHEMA_VERSION - 1, 'w-1', { libraryPath }, legacy);

    const entries = await listIndexCaches();
    expect(entries.map((e) => [e.dir, e.removeReason])).toEqual([[stranded, 'oldSchema']]);

    await pruneIndexCaches();

    expect(await exists(legacy)).toBe(false);
    expect(await exists(resolveCacheBase())).toBe(true);
  });
});
