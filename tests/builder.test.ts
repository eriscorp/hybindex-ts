import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildIndex, buildSection } from '../src/index.js';
import {
  castableXml,
  cleanup,
  creatureXml,
  itemXml,
  localizationXml,
  makeWorldTemp,
  mapXml,
  npcXml,
  statusXml,
  writeArchivedXml,
  writeLua,
  writeXml,
} from './helpers.js';

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

// ── buildIndex ──────────────────────────────────────────────────────────────

describe('buildIndex', () => {
  it('produces an empty index when the library has no XML', async () => {
    const index = await buildIndex(libraryPath);
    expect(index.castables).toEqual([]);
    expect(index.items).toEqual([]);
    expect(index.libraryPath).toBe(libraryPath);
    expect(typeof index.builtAt).toBe('string');
  });

  it('extracts names and filename maps for castables (element-based Name)', async () => {
    await writeXml(libraryPath, 'castables', 'wizard_psp_ard-sal.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'castables', 'rogue_psk_blindside.xml', castableXml('Blindside', { class: 'Rogue' }));

    const index = await buildIndex(libraryPath);

    expect(index.castables).toEqual(['Ard Sal', 'Blindside']);
    expect(index.castablesNamesByFilename['wizard_psp_ard-sal.xml']).toBe('Ard Sal');
    expect(index.castablesNamesByFilename['rogue_psk_blindside.xml']).toBe('Blindside');
    expect(index.castableFilenames['Ard Sal']).toBe('wizard_psp_ard-sal.xml');
    expect(index.castableClasses['Blindside']).toBe('Rogue');
  });

  it('extracts attribute-based names for statuses and creatures', async () => {
    await writeXml(libraryPath, 'statuses', 'poison.xml', statusXml('Poisoned'));
    await writeXml(libraryPath, 'creatures', 'goblin.xml', creatureXml('Goblin'));

    const index = await buildIndex(libraryPath);
    expect(index.statuses).toEqual(['Poisoned']);
    expect(index.statusesNamesByFilename['poison.xml']).toBe('Poisoned');
    expect(index.creatures).toEqual(['Goblin']);
    expect(index.creaturesNamesByFilename['goblin.xml']).toBe('Goblin');
  });

  it('uses Locale for localizations (not Name)', async () => {
    await writeXml(libraryPath, 'localizations', 'en_US.xml', localizationXml('en_US'));
    const index = await buildIndex(libraryPath);
    expect(index.localizations).toEqual(['en_US']);
    expect(index.localizationsNamesByFilename['en_US.xml']).toBe('en_US');
  });

  it('extracts first <Name> as filename identifier for items/nations/recipes', async () => {
    await writeXml(libraryPath, 'items', 'stick.xml', itemXml('Stick'));
    const index = await buildIndex(libraryPath);
    expect(index.items).toEqual(['Stick']);
    expect(index.itemsNamesByFilename['stick.xml']).toBe('Stick');
  });

  it('populates mapDetails for maps with id/x/y', async () => {
    await writeXml(libraryPath, 'maps', 'piet.xml', mapXml('Piet', 500, 10, 20));
    const index = await buildIndex(libraryPath);
    expect(index.maps).toEqual(['Piet']);
    expect(index.mapDetails).toEqual([{ id: 500, name: 'Piet', filename: 'piet.xml', x: 10, y: 20 }]);
  });

  it('scans archived files into archived<Type> and merges names into NamesByFilename', async () => {
    await writeXml(libraryPath, 'castables', 'active.xml', castableXml('Active Spell'));
    await writeArchivedXml(libraryPath, 'castables', 'archived.xml', castableXml('Archived Spell'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).toEqual(['Active Spell']);
    expect(index.archivedCastables).toEqual(['Archived Spell']);
    expect(index.castablesNamesByFilename['active.xml']).toBe('Active Spell');
    expect(index.castablesNamesByFilename['archived.xml']).toBe('Archived Spell');
    // castableFilenames is active-only
    expect(index.castableFilenames['Archived Spell']).toBeUndefined();
  });

  it('builds category lists and details from items/castables/statuses', async () => {
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword', { category: 'Weapon' }));
    await writeXml(libraryPath, 'items', 'shield.xml', itemXml('Shield', { category: 'Weapon' }));
    const index = await buildIndex(libraryPath);
    expect(index.itemCategories).toEqual(['Weapon']);
    expect(index.itemCategoryDetails).toHaveLength(1);
    expect(index.itemCategoryDetails[0]!.name).toBe('Weapon');
    expect(index.itemCategoryDetails[0]!.count).toBe(2);
    // usedBy order depends on readdir(), so sort before compare
    expect([...index.itemCategoryDetails[0]!.usedBy].sort()).toEqual(['Shield', 'Sword']);
  });

  it('scans vendor tabs from items', async () => {
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword', { shopTab: 'Weapons' }));
    await writeXml(libraryPath, 'items', 'potion.xml', itemXml('Potion', { shopTab: 'Potions' }));
    const index = await buildIndex(libraryPath);
    expect(index.vendorTabs).toEqual(['Potions', 'Weapons']);
  });

  it('scans NPC job prefixes from filenames', async () => {
    await writeXml(libraryPath, 'npcs', 'vendor_bob.xml', npcXml('Bob'));
    await writeXml(libraryPath, 'npcs', 'guard_alice.xml', npcXml('Alice'));
    const index = await buildIndex(libraryPath);
    expect(index.npcJobs).toEqual(['guard', 'vendor']);
  });

  it('scans Lua scripts and extracts cookie names', async () => {
    // cookieRegex matches dot notation (player.setcookie). Lua colon syntax
    // (player:setcookie) is intentionally not matched — mirrors Creidhne/Taliesin.
    await writeLua(libraryPath, 'hello.lua', 'player.setcookie("questA", 1)\nnpc.setcookie ( "questB" , 2)');
    const index = await buildIndex(libraryPath);
    expect(index.scripts).toContain('hello');
    expect(index.cookieNames.sort()).toEqual(['questA', 'questB']);
  });

  it('emits progress events during scan', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('B'));
    const events: string[] = [];
    await buildIndex(libraryPath, {
      onProgress: (e) => events.push(`${e.phase}:${e.type ?? '-'}`),
    });
    expect(events).toContain('done:-');
    expect(events.some((e) => e.startsWith('scan:castables'))).toBe(true);
  });
});

// ── buildSection ────────────────────────────────────────────────────────────

describe('buildSection', () => {
  it('returns only the fields owned by that section', async () => {
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword', { shopTab: 'Weapons', category: 'Weapon' }));
    const { fields } = await buildSection(libraryPath, 'items');
    expect(fields.items).toEqual(['Sword']);
    expect(fields.itemsNamesByFilename).toEqual({ 'sword.xml': 'Sword' });
    expect(fields.vendorTabs).toEqual(['Weapons']);
    expect(fields.itemCategories).toEqual(['Weapon']);
    // Does NOT touch other types' fields
    expect(fields.castables).toBeUndefined();
  });

  it('includes archived names for types that support archiving', async () => {
    await writeArchivedXml(libraryPath, 'statuses', 'old.xml', statusXml('Old Status'));
    const { fields } = await buildSection(libraryPath, 'statuses');
    expect(fields.archivedStatuses).toEqual(['Old Status']);
  });
});
