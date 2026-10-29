import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildIndex, buildSection, loadIndex, resolveElementTable, saveIndex } from '../src/index.js';
import {
  cleanup,
  elementTableXml,
  makeWorldTemp,
  oldElementTableXml,
  serverConfigXml,
  spawnGroupXml,
  writeArchivedXml,
  writeXml,
} from './helpers.js';

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

// ── elementTables ───────────────────────────────────────────────────────────

describe('elementTables', () => {
  it('reads a table in the old format from its Source rows', async () => {
    await writeXml(libraryPath, 'elementtables', 'table.xml', oldElementTableXml('HybElements', ['Fire', 'Water', 'Fire']));

    const index = await buildIndex(libraryPath);

    expect(index.elementTables).toEqual({
      HybElements: { elements: ['Fire', 'Water'], groups: {}, defaultElement: null },
    });
    expect(index.elementnames).toEqual(['Fire', 'Water']);
  });

  it('reads Elements, Groups and the default element of a table in the HXML-24 format', async () => {
    await writeXml(
      libraryPath,
      'elementtables',
      'table.xml',
      elementTableXml(
        'HybElements2',
        [
          { key: 'Force', id: 0, default: true, name: 'Pure Force' },
          { key: 'Fire', id: 1 },
          { key: 'Wind', id: 2 },
        ],
        { Cardinal: 'Fire  Wind', Weighted: 'Fire Fire Wind' },
      ),
    );

    const index = await buildIndex(libraryPath);

    expect(index.elementTables.HybElements2).toEqual({
      elements: ['Force', 'Fire', 'Wind'],
      groups: { Cardinal: ['Fire', 'Wind'], Weighted: ['Fire', 'Fire', 'Wind'] },
      defaultElement: 'Force',
    });
    // The display Name of an element is not the table name.
    expect(index.elementtables).toEqual(['HybElements2']);
  });

  it('takes elementnames from Element keys, not from Source rows, in the new format', async () => {
    // The Source row names only the first element. The table has three.
    await writeXml(
      libraryPath,
      'elementtables',
      'table.xml',
      elementTableXml('T', [{ key: 'Light', id: 0 }, { key: 'Dark', id: 1 }, { key: 'Void', id: 2 }]),
    );

    const index = await buildIndex(libraryPath);
    expect(index.elementnames).toEqual(['Dark', 'Light', 'Void']);
  });

  it('keeps two tables apart, and elementnames is their union', async () => {
    await writeXml(libraryPath, 'elementtables', 'a.xml', oldElementTableXml('Retail', ['Fire', 'Water']));
    await writeXml(
      libraryPath,
      'elementtables',
      'b.xml',
      elementTableXml('Brigid', [{ key: 'Fire', id: 1 }, { key: 'Arcane', id: 10 }]),
    );

    const index = await buildIndex(libraryPath);

    expect(index.elementTables.Retail?.elements).toEqual(['Fire', 'Water']);
    expect(index.elementTables.Brigid?.elements).toEqual(['Fire', 'Arcane']);
    expect(index.elementnames).toEqual(['Arcane', 'Fire', 'Water']);
  });

  it('names a table without a Name attribute "default", as the server does', async () => {
    await writeXml(libraryPath, 'elementtables', 'table.xml', oldElementTableXml(null, ['Fire']));

    const index = await buildIndex(libraryPath);

    expect(index.elementtables).toEqual(['default']);
    expect(Object.keys(index.elementTables)).toEqual(['default']);
  });

  it('keeps the first table when two files claim one name', async () => {
    await writeXml(libraryPath, 'elementtables', 'a.xml', oldElementTableXml('T', ['Fire']));
    await writeXml(libraryPath, 'elementtables', 'b.xml', oldElementTableXml('T', ['Water']));

    const index = await buildIndex(libraryPath);

    expect(index.elementTables.T?.elements).toEqual(['Fire']);
    expect(index.elementtablesDuplicateNames).toEqual({ t: ['a.xml', 'b.xml'] });
    // Every file adds to the union, as before 1.2.0.
    expect(index.elementnames).toEqual(['Fire', 'Water']);
  });

  it('decodes entities in element keys and group members', async () => {
    await writeXml(
      libraryPath,
      'elementtables',
      'table.xml',
      elementTableXml('T', [{ key: 'Fire&amp;Ice', id: 0, default: true }, { key: 'Wind', id: 1 }], {
        'Mixed&amp;Matched': 'Fire&amp;Ice Wind',
      }),
    );

    const index = await buildIndex(libraryPath);

    expect(index.elementTables.T).toEqual({
      elements: ['Fire&Ice', 'Wind'],
      groups: { 'Mixed&Matched': ['Fire&Ice', 'Wind'] },
      defaultElement: 'Fire&Ice',
    });
  });

  it('indexes a table or a group whose name is an Object property, such as constructor', async () => {
    await writeXml(
      libraryPath,
      'elementtables',
      'table.xml',
      elementTableXml('constructor', [{ key: 'Fire', id: 1 }], { toString: 'Fire', constructor: 'Fire Fire' }),
    );

    const index = await buildIndex(libraryPath);

    expect(Object.keys(index.elementTables)).toEqual(['constructor']);
    expect(index.elementTables.constructor?.groups).toEqual({ toString: ['Fire'], constructor: ['Fire', 'Fire'] });
  });

  it('survives a save and a load', async () => {
    await writeXml(libraryPath, 'elementtables', 'table.xml', elementTableXml('T', [{ key: 'Fire', id: 1, default: true }]));
    await writeXml(libraryPath, 'serverconfigs', 'config.xml', serverConfigXml('qa', { elementTable: 'T' }));

    await saveIndex(libraryPath, await buildIndex(libraryPath));
    const loaded = await loadIndex(libraryPath);

    expect(loaded?.elementTables.T?.defaultElement).toBe('Fire');
    expect(loaded?.serverconfigElementTables).toEqual({ qa: 'T' });
  });
});

// ── serverconfigElementTables ───────────────────────────────────────────────

describe('serverconfigElementTables', () => {
  it('records the ElementTable attribute of each server config, or null', async () => {
    await writeXml(libraryPath, 'serverconfigs', 'qa.xml', serverConfigXml('qa', { elementTable: 'HybElements2' }));
    await writeXml(libraryPath, 'serverconfigs', 'local.xml', serverConfigXml('local'));

    const { fields } = await buildSection(libraryPath, 'serverconfigs');

    expect(fields.serverconfigElementTables).toEqual({ qa: 'HybElements2', local: null });
  });

  it('names a server config without a root Name "default", not after a child element', async () => {
    // world's config.xml was indexed as "Danaan", the name of one of its Ages.
    await writeXml(
      libraryPath,
      'serverconfigs',
      'config.xml',
      serverConfigXml(null, {
        body: '  <Time><Ages><Age Name="Danaan" StartDate="1640-01-03T01:00:00Z"/></Ages></Time>',
      }),
    );

    const index = await buildIndex(libraryPath);

    expect(index.serverconfigs).toEqual(['default']);
    expect(index.serverconfigsNamesByFilename).toEqual({ 'config.xml': 'default' });
    expect(index.serverconfigElementTables).toEqual({ default: null });
  });

  it('reads the root element only, past a comment that holds a tag', async () => {
    const xml = serverConfigXml('qa').replace(
      '<ServerConfig',
      '<!-- <ServerConfig Name="commented"/> -->\n<ServerConfig',
    );
    await writeXml(libraryPath, 'serverconfigs', 'qa.xml', xml);

    const index = await buildIndex(libraryPath);
    expect(index.serverconfigs).toEqual(['qa']);
  });

  it('gives an archived spawn group without a root Name no name', async () => {
    // world has 582 such files. Before 1.2.0 each took the name of its first <Map>.
    await writeArchivedXml(
      libraryPath,
      'spawngroups',
      'old.xml',
      `<?xml version="1.0" encoding="utf-8"?>
<SpawnGroup xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02">
  <Maps><Map Name="Abel Grotto 1-1" MinSpawn="2"/></Maps>
</SpawnGroup>`,
    );
    await writeArchivedXml(libraryPath, 'spawngroups', 'named.xml', spawnGroupXml('Named'));

    const index = await buildIndex(libraryPath);

    expect(index.archivedSpawngroups).toEqual(['Named']);
    expect(index.spawngroupsNamesByFilename).toEqual({ '.ignore/named.xml': 'Named' });
  });
});

// ── resolveElementTable ─────────────────────────────────────────────────────

describe('resolveElementTable', () => {
  const table = { elements: [], groups: {}, defaultElement: null };

  it('returns the table that the server config names, when it exists', () => {
    const index = {
      elementTables: { Retail: table, Brigid: table },
      serverconfigElementTables: { qa: 'Brigid', local: 'Retail' },
    };
    expect(resolveElementTable(index, 'qa')).toBe('Brigid');
    expect(resolveElementTable(index, 'local')).toBe('Retail');
  });

  it('falls back to the only table when the named table does not exist', () => {
    const index = { elementTables: { HybElements: table }, serverconfigElementTables: { qa: 'Missing' } };
    expect(resolveElementTable(index, 'qa')).toBe('HybElements');
  });

  it('falls back to the only table when the server config has no ElementTable attribute', () => {
    const index = { elementTables: { HybElements: table }, serverconfigElementTables: { qa: null } };
    expect(resolveElementTable(index, 'qa')).toBe('HybElements');
  });

  it('selects the table named "default" for a server config without the attribute', () => {
    const index = {
      elementTables: { default: table, Other: table },
      serverconfigElementTables: { qa: null },
    };
    expect(resolveElementTable(index, 'qa')).toBe('default');
  });

  it('returns null when two tables exist and none matches', () => {
    const index = {
      elementTables: { Retail: table, Brigid: table },
      serverconfigElementTables: { qa: 'Missing', local: null },
    };
    expect(resolveElementTable(index, 'qa')).toBeNull();
    expect(resolveElementTable(index, 'local')).toBeNull();
    expect(resolveElementTable(index, 'unknown')).toBeNull();
    expect(resolveElementTable(index)).toBeNull();
  });

  it('returns the only table when no server config is given', () => {
    expect(resolveElementTable({ elementTables: { T: table }, serverconfigElementTables: {} })).toBe('T');
  });

  it('does not take an inherited property for a table or a server config', () => {
    const index = { elementTables: { T: table, U: table }, serverconfigElementTables: { qa: 'constructor' } };
    expect(resolveElementTable(index, 'qa')).toBeNull();
    expect(resolveElementTable(index, 'toString')).toBeNull();
  });

  it('returns null for an index built before 1.2.0, which has no table fields', () => {
    const old = {} as Parameters<typeof resolveElementTable>[0];
    expect(resolveElementTable(old, 'qa')).toBeNull();
  });

  it('agrees with the server for a built world', async () => {
    await writeXml(libraryPath, 'elementtables', 'table.xml', oldElementTableXml('HybElements', ['Fire']));
    await writeXml(libraryPath, 'serverconfigs', 'config.xml', serverConfigXml(null));
    await writeXml(libraryPath, 'serverconfigs', 'qa.xml', serverConfigXml('qa', { elementTable: 'Nope' }));

    const index = await buildIndex(libraryPath);

    expect(resolveElementTable(index, 'default')).toBe('HybElements');
    expect(resolveElementTable(index, 'qa')).toBe('HybElements');
  });
});
