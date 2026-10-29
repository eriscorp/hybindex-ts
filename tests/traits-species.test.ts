import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildIndex, buildSection, duplicateNamesFor, INDEX_TYPES, loadIndex, saveIndex } from '../src/index.js';
import { cleanup, makeWorldTemp, speciesXml, traitXml, writeArchivedXml, writeXml } from './helpers.js';

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

it('indexes traits and species, in the directories the xml package reads', () => {
  // WorldDataDirectory.NameFor: `traits`, and `species` (an invariant plural).
  expect(INDEX_TYPES).toContain('traits');
  expect(INDEX_TYPES).toContain('species');
});

// ── traits ──────────────────────────────────────────────────────────────────

describe('traits', () => {
  beforeEach(async () => {
    await writeXml(libraryPath, 'traits', 'night-eyes.xml', traitXml('Night Eyes', { category: 'Senses', exclusiveGroup: 'Eyes' }));
    await writeXml(
      libraryPath,
      'traits',
      'hawk-eyes.xml',
      traitXml('Hawk Eyes', { category: 'Senses', exclusiveGroup: 'Eyes', policy: 'Replace', conflicts: ['Night Eyes'] }),
    );
    await writeXml(libraryPath, 'traits', 'iron-gut.xml', traitXml('Iron Gut', { exclusiveGroup: 'Stomach' }));
    await writeArchivedXml(libraryPath, 'traits', 'old.xml', traitXml('Glass Jaw', { category: 'Flaws' }));
  });

  it('lists the active and archived trait names by their Name attribute', async () => {
    const index = await buildIndex(libraryPath);

    expect(index.traits).toEqual(['Hawk Eyes', 'Iron Gut', 'Night Eyes']);
    expect(index.archivedTraits).toEqual(['Glass Jaw']);
    expect(index.traitsNamesByFilename).toEqual({
      'hawk-eyes.xml': 'Hawk Eyes',
      'iron-gut.xml': 'Iron Gut',
      'night-eyes.xml': 'Night Eyes',
      '.ignore/old.xml': 'Glass Jaw',
    });
  });

  it('collects each Category of the active traits, sorted', async () => {
    const index = await buildIndex(libraryPath);
    expect(index.traitCategories).toEqual(['Senses']);
  });

  it('maps each ExclusiveGroup to its traits, in file order', async () => {
    const index = await buildIndex(libraryPath);
    expect(index.traitExclusiveGroups).toEqual({
      Eyes: ['Hawk Eyes', 'Night Eyes'],
      Stomach: ['Iron Gut'],
    });
  });

  it('accepts an ExclusiveGroup whose name is an Object property, such as constructor', async () => {
    await writeXml(libraryPath, 'traits', 'odd.xml', traitXml('Odd', { exclusiveGroup: 'constructor' }));

    const index = await buildIndex(libraryPath);
    expect(index.traitExclusiveGroups.constructor).toEqual(['Odd']);
  });

  it('reports two trait files with one name', async () => {
    await writeXml(libraryPath, 'traits', 'copy.xml', traitXml('night eyes'));

    const index = await buildIndex(libraryPath);

    expect(index.traitsDuplicateNames).toEqual({ 'night eyes': ['copy.xml', 'night-eyes.xml'] });
    expect(duplicateNamesFor(index, 'traits')).toBe(index.traitsDuplicateNames);
  });

  it('emits every trait field from buildSection', async () => {
    const { fields } = await buildSection(libraryPath, 'traits');
    expect(Object.keys(fields).sort()).toEqual([
      'archivedTraits',
      'traitCategories',
      'traitExclusiveGroups',
      'traits',
      'traitsDuplicateNames',
      'traitsNamesByFilename',
    ]);
  });
});

// ── species ─────────────────────────────────────────────────────────────────

describe('species', () => {
  beforeEach(async () => {
    await writeXml(libraryPath, 'species', 'fae.xml', speciesXml('Fae', { id: 3, playerOption: 'ByBranch' }));
    await writeXml(
      libraryPath,
      'species',
      'sidhe.xml',
      speciesXml('Sidhe', {
        id: 4,
        branchOf: 'Fae',
        bodies: [{ key: 'Pale', id: 10, default: true }, { key: 'Dusk', id: 11 }],
      }),
    );
    await writeXml(
      libraryPath,
      'species',
      'human/human.xml',
      speciesXml('Human', { id: 1, bodies: [{ key: 'Fair', id: 1, default: true }, { key: 'Tan', id: 11 }] }),
    );
    await writeArchivedXml(libraryPath, 'species', 'old.xml', speciesXml('Giant', { playerOption: 'Locked' }));
  });

  it('lists the active and archived species by their Key attribute', async () => {
    const index = await buildIndex(libraryPath);

    expect(index.species).toEqual(['Fae', 'Human', 'Sidhe']);
    expect(index.archivedSpecies).toEqual(['Giant']);
    expect(index.speciesNamesByFilename['human/human.xml']).toBe('Human');
    expect(index.speciesNamesByFilename['.ignore/old.xml']).toBe('Giant');
  });

  it('records the Id, BranchOf, PlayerOption and bodies of each species', async () => {
    const index = await buildIndex(libraryPath);

    expect(index.speciesDetails).toEqual({
      Fae: { id: 3, branchOf: null, playerOption: 'ByBranch', bodies: [] },
      Human: {
        id: 1,
        branchOf: null,
        playerOption: 'Starter',
        bodies: [{ key: 'Fair', id: 1, default: true }, { key: 'Tan', id: 11, default: false }],
      },
      Sidhe: {
        id: 4,
        branchOf: 'Fae',
        playerOption: 'Starter',
        bodies: [{ key: 'Pale', id: 10, default: true }, { key: 'Dusk', id: 11, default: false }],
      },
    });
  });

  it('shows each body Id claim, so a claim in another file is visible', async () => {
    const index = await buildIndex(libraryPath);

    expect(index.speciesBodyIds).toEqual({
      '1': [{ species: 'Human', body: 'Fair', filename: 'human/human.xml' }],
      '10': [{ species: 'Sidhe', body: 'Pale', filename: 'sidhe.xml' }],
      '11': [
        { species: 'Human', body: 'Tan', filename: 'human/human.xml' },
        { species: 'Sidhe', body: 'Dusk', filename: 'sidhe.xml' },
      ],
    });
  });

  it('does not read a body Key or the Names element as the species key', async () => {
    // The root has no Key, so the file has no key. A <Body Key> must not stand in.
    await writeXml(
      libraryPath,
      'species',
      'broken.xml',
      speciesXml('Broken', { bodies: [{ key: 'Body', id: 50 }] }).replace(' Key="Broken"', ''),
    );

    const index = await buildIndex(libraryPath);

    expect(index.species).not.toContain('Body');
    expect(index.speciesBodyIds['50']).toBeUndefined();
  });

  it('records null for a missing or non-numeric Id', async () => {
    await writeXml(
      libraryPath,
      'species',
      'odd.xml',
      speciesXml('Odd', { bodies: [{ key: 'B', id: 60 }] }).replace('Id="1"', 'Id="x"').replace('Id="60"', 'Id=""'),
    );

    const index = await buildIndex(libraryPath);

    expect(index.speciesDetails.Odd).toEqual({
      id: null,
      branchOf: null,
      playerOption: 'Starter',
      bodies: [{ key: 'B', id: null, default: false }],
    });
  });

  it('reports two species files with one key, and both files claim their bodies', async () => {
    await writeXml(libraryPath, 'species', 'human-copy.xml', speciesXml('Human', { id: 9, bodies: [{ key: 'Fair', id: 1 }] }));

    const index = await buildIndex(libraryPath);

    expect(index.speciesDuplicateNames).toEqual({ human: ['human-copy.xml', 'human/human.xml'] });
    // The detail is the first file in path order.
    expect(index.speciesDetails.Human?.id).toBe(9);
    expect(index.speciesBodyIds['1']).toEqual([
      { species: 'Human', body: 'Fair', filename: 'human-copy.xml' },
      { species: 'Human', body: 'Fair', filename: 'human/human.xml' },
    ]);
  });

  it('survives a save and a load', async () => {
    await saveIndex(libraryPath, await buildIndex(libraryPath));
    const loaded = await loadIndex(libraryPath);

    expect(loaded?.species).toEqual(['Fae', 'Human', 'Sidhe']);
    expect(loaded?.speciesDetails.Sidhe?.branchOf).toBe('Fae');
    expect(loaded?.speciesBodyIds['11']).toHaveLength(2);
  });
});
