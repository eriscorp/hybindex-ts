import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildIndex, buildSection, saveIndex } from '../src/index.js';
import {
  castableXml,
  castableXmlWithRequirement,
  cleanup,
  creatureXml,
  itemXml,
  localizationXml,
  lootSetXml,
  makeWorldTemp,
  mapXml,
  npcXml,
  serverConfigXml,
  spawnGroupXml,
  statusXml,
  statusXmlWithMeta,
  writeArchivedXml,
  writeLua,
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

  it('scans archived files into archived<Type> and keys them under .ignore/', async () => {
    await writeXml(libraryPath, 'castables', 'active.xml', castableXml('Active Spell'));
    await writeArchivedXml(libraryPath, 'castables', 'archived.xml', castableXml('Archived Spell'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).toEqual(['Active Spell']);
    expect(index.archivedCastables).toEqual(['Archived Spell']);
    expect(index.castablesNamesByFilename['active.xml']).toBe('Active Spell');
    // Archived entries share the map but carry their `.ignore/` prefix — that
    // prefix is what flags them as content the server never loads.
    expect(index.castablesNamesByFilename['.ignore/archived.xml']).toBe('Archived Spell');
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

  it('extracts castable icon ids and books by name', async () => {
    await writeXml(libraryPath, 'castables', 'srad.xml', castableXml('Srad', { icon: 42 }));
    await writeXml(libraryPath, 'castables', 'plain.xml', castableXml('Plain'));
    const index = await buildIndex(libraryPath);
    expect(index.castableIcons.Srad).toBe(42);
    // No Icon attr → absent from the map (not 0).
    expect(index.castableIcons.Plain).toBeUndefined();
    // The fixture sets Book="PrimarySpell" on every castable.
    expect(index.castableBooks.Srad).toBe('PrimarySpell');
  });

  it('resolves castableCategoryMembers to the full, uncapped, deduped member list', async () => {
    // usedBy is capped at 5; castableCategoryMembers must list every member.
    for (let i = 1; i <= 7; i++) {
      await writeXml(libraryPath, 'castables', `nuke${i}.xml`, castableXml(`Nuke ${i}`, { categories: ['aoe'] }));
    }
    await writeXml(libraryPath, 'castables', 'zap.xml', castableXml('Zap', { categories: ['aoe', 'single'] }));
    const index = await buildIndex(libraryPath);

    // usedBy stays a capped sample (emptied once count >= 5).
    const aoeDetail = index.castableCategoryDetails.find((c) => c.name === 'aoe');
    expect(aoeDetail!.count).toBe(8);
    expect(aoeDetail!.usedBy).toEqual([]);

    // members is the complete, sorted list — all 8 in 'aoe', 'Zap' in both.
    expect(index.castableCategoryMembers.aoe).toEqual([
      'Nuke 1', 'Nuke 2', 'Nuke 3', 'Nuke 4', 'Nuke 5', 'Nuke 6', 'Nuke 7', 'Zap',
    ]);
    expect(index.castableCategoryMembers.single).toEqual(['Zap']);
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

// ── Formula reverse index ───────────────────────────────────────────────────

describe('formula reverse index', () => {
  it('extracts healFormulaName + damageFormulaName from castable meta', async () => {
    await writeXml(libraryPath, 'castables', 'heal.xml', castableXml('Heal Spell', { healFormulaName: 'big_heal' }));
    await writeXml(libraryPath, 'castables', 'nuke.xml', castableXml('Nuke', { damageFormulaName: 'fire_damage' }));
    await writeXml(libraryPath, 'castables', 'hybrid.xml', castableXml('Hybrid', {
      healFormulaName: 'big_heal',
      damageFormulaName: 'fire_damage',
    }));

    const index = await buildIndex(libraryPath);

    // readdir() order is platform-dependent, so sort before compare.
    const sorted = Object.fromEntries(
      Object.entries(index.formulaUsedByCastables).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(sorted).toEqual({
      big_heal: ['Heal Spell', 'Hybrid'],
      fire_damage: ['Hybrid', 'Nuke'],
    });
  });

  it('ignores castables with no meta annotation', async () => {
    await writeXml(libraryPath, 'castables', 'plain.xml', castableXml('Plain Spell'));
    const index = await buildIndex(libraryPath);
    expect(index.formulaUsedByCastables).toEqual({});
  });

  it('extracts nested formulaNames from status meta across onApply/onTick/onRemove', async () => {
    await writeXml(libraryPath, 'statuses', 'poison.xml', statusXmlWithMeta('Poisoned', {
      onTick: { damage: 'dot_tick' },
      onRemove: { heal: 'end_heal' },
    }));
    await writeXml(libraryPath, 'statuses', 'regen.xml', statusXmlWithMeta('Regen', {
      onTick: { heal: 'end_heal' },
    }));

    const index = await buildIndex(libraryPath);

    const sorted = Object.fromEntries(
      Object.entries(index.formulaUsedByStatuses).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(sorted).toEqual({
      dot_tick: ['Poisoned'],
      end_heal: ['Poisoned', 'Regen'],
    });
  });
});

// ── Castable required levels ────────────────────────────────────────────────

describe('castable required levels', () => {
  it('extracts <Level Min> from the FIRST <Requirement>', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXmlWithRequirement('Clobber', 23, 'Warrior'));
    await writeXml(libraryPath, 'castables', 'b.xml', castableXmlWithRequirement('Heal', 5, 'Priest'));

    const index = await buildIndex(libraryPath);

    expect(index.castableRequiredLevels).toEqual({ Clobber: 23, Heal: 5 });
  });

  it('omits castables with no Requirements element', async () => {
    await writeXml(libraryPath, 'castables', 'plain.xml', castableXml('Plain'));
    const index = await buildIndex(libraryPath);
    expect(index.castableRequiredLevels).toEqual({});
  });

  it('uses only the first Requirement when multiple are declared', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Castable xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02"
          Book="PrimarySpell" Elements="Fire" Class="Wizard"
          IsAssail="false" Reflectable="false" BreakStealth="false"
          IncludeInMetafile="true" PvpOnly="false">
  <Name>Multi</Name>
  <Requirements>
    <Requirement Class="Warrior"><Level Min="10" Max="99"/></Requirement>
    <Requirement Class="Wizard"><Level Min="50" Max="99"/></Requirement>
  </Requirements>
</Castable>`;
    await writeXml(libraryPath, 'castables', 'm.xml', xml);
    const index = await buildIndex(libraryPath);
    expect(index.castableRequiredLevels).toEqual({ Multi: 10 });
  });
});

// ── Item weapon damage ──────────────────────────────────────────────────────

describe('item weapon damage', () => {
  it('extracts SmallMin/SmallMax/LargeMin/LargeMax when present', async () => {
    await writeXml(libraryPath, 'items', 'amber.xml', itemXml('Amber Saber', {
      damage: { smallMin: 374, smallMax: 604, largeMin: 404, largeMax: 734 },
    }));
    const index = await buildIndex(libraryPath);
    expect(index.itemWeaponDamage).toEqual({
      'Amber Saber': { smallMin: 374, smallMax: 604, largeMin: 404, largeMax: 734 },
    });
  });

  it('omits non-weapon items entirely', async () => {
    await writeXml(libraryPath, 'items', 'potion.xml', itemXml('Potion'));
    const index = await buildIndex(libraryPath);
    expect(index.itemWeaponDamage).toEqual({});
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

  it('emits a terminal done event keyed by type', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('A'));
    const events: string[] = [];
    await buildSection(libraryPath, 'castables', {
      onProgress: (e) => events.push(`${e.phase}:${e.type ?? '-'}`),
    });
    expect(events.at(-1)).toBe('done:castables');
  });
});

// ── Loot set cross-references ──────────────────────────────────────────────

describe('itemLootSets', () => {
  it('reverse-indexes <Item> entries inside <Items> blocks of loot sets', async () => {
    await writeXml(libraryPath, 'lootsets', 'forest.xml', lootSetXml('forest', ['Apple', 'Stick']));
    await writeXml(libraryPath, 'lootsets', 'cave.xml', lootSetXml('cave', ['Apple']));

    const index = await buildIndex(libraryPath);

    // Keys are lowercased (matches existing itemVendors / castableTrainers convention).
    const sorted = Object.fromEntries(
      Object.entries(index.itemLootSets).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(sorted).toEqual({
      apple: ['cave', 'forest'],
      stick: ['forest'],
    });
  });

  it('is empty when no loot sets reference items', async () => {
    await writeXml(libraryPath, 'lootsets', 'empty.xml', lootSetXml('empty', []));
    const index = await buildIndex(libraryPath);
    expect(index.itemLootSets).toEqual({});
  });
});

// ── Archive scans for serverconfigs / localizations ────────────────────────

describe('archive scans for serverconfigs and localizations', () => {
  it('scans .ignore/ XML for serverconfigs by Name attribute', async () => {
    await writeArchivedXml(libraryPath, 'serverconfigs', 'old.xml', serverConfigXml('OldConfig'));
    const index = await buildIndex(libraryPath);
    expect(index.archivedServerconfigs).toEqual(['OldConfig']);
  });

  it('scans .ignore/ XML for localizations by Locale attribute', async () => {
    await writeArchivedXml(libraryPath, 'localizations', 'old.xml', localizationXml('de_DE'));
    const index = await buildIndex(libraryPath);
    expect(index.archivedLocalizations).toEqual(['de_DE']);
  });
});

// ── Incremental rebuilds (A5) ───────────────────────────────────────────────

describe('incremental buildIndex', () => {
  // A field-by-field comparison ignoring builtAt (timestamp) and __fileCache.
  const sameIndex = (a: Record<string, unknown>, b: Record<string, unknown>): void => {
    const strip = (x: Record<string, unknown>): Record<string, unknown> => {
      const { builtAt, __fileCache, ...rest } = x as Record<string, unknown>;
      void builtAt; void __fileCache;
      return rest;
    };
    expect(strip(a)).toEqual(strip(b));
  };

  it('a no-change rebuild reproduces the same index', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword', { shopTab: 'Weapons', category: 'Blades' }));
    await writeXml(libraryPath, 'statuses', 'poison.xml', statusXml('Poisoned'));

    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);

    const second = await buildIndex(libraryPath);
    sameIndex(first as unknown as Record<string, unknown>, second as unknown as Record<string, unknown>);
  });

  it('reuses unchanged sections and picks up a changed one', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'items', 'sword.xml', itemXml('Sword'));

    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);

    // Change only castables.
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Beag Sal'));
    const second = await buildIndex(libraryPath);

    expect(second.castables).toEqual(['Ard Sal', 'Beag Sal']);
    expect(second.items).toEqual(['Sword']); // unchanged section, reused
  });

  it('rescans a section when a file is deleted', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    await writeXml(libraryPath, 'castables', 'b.xml', castableXml('Beag Sal'));
    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);

    await fs.unlink(join(libraryPath, 'castables', 'b.xml'));
    const second = await buildIndex(libraryPath);
    expect(second.castables).toEqual(['Ard Sal']);
  });

  it('folded category/vendor aggregates match a from-scratch build', async () => {
    await writeXml(libraryPath, 'items', 's.xml', itemXml('Sword', { shopTab: 'Weapons', category: 'Blades' }));
    await writeXml(libraryPath, 'items', 'p.xml', itemXml('Potion', { shopTab: 'Consumables', category: 'Drinks' }));

    const built = await buildIndex(libraryPath);
    expect(built.vendorTabs).toEqual(['Consumables', 'Weapons']);
    expect(built.itemCategories).toEqual(['Blades', 'Drinks']);
    expect(built.itemCategoryDetails.map((c) => c.name)).toEqual(['Blades', 'Drinks']);
  });

  // The regression that matters most: if the builder scans subdirectories but
  // the file cache signature does not, an edit down there never invalidates and
  // the index freezes at its first build — silently, forever.
  it('an edit in a subdirectory invalidates the cache and rescans', async () => {
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Blast'));
    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);
    expect(first.castables).toEqual(['Blast']);

    await new Promise((r) => setTimeout(r, 10));
    // Different length, so `size` alone is enough to invalidate.
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Blast Renamed'));

    const second = await buildIndex(libraryPath);
    expect(second.castables).toEqual(['Blast Renamed']);
  });

  it('a same-size edit in a subdirectory still invalidates (mtime is tracked)', async () => {
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Blast Aaaa'));
    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);

    await new Promise((r) => setTimeout(r, 10));
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Blast Bbbb'));

    const second = await buildIndex(libraryPath);
    expect(second.castables).toEqual(['Blast Bbbb']);
  });

  it('a new file in a subdirectory invalidates the cache', async () => {
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Ard Sal'));
    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);

    await writeXml(libraryPath, 'castables', 'fire/new.xml', castableXml('Beag Sal'));
    const second = await buildIndex(libraryPath);
    expect(second.castables).toEqual(['Ard Sal', 'Beag Sal']);
  });

  it('an edit under a nested .ignore invalidates the cache', async () => {
    await writeArchivedXml(libraryPath, 'castables', 'old/a.xml', castableXml('Old One'));
    const first = await buildIndex(libraryPath);
    await saveIndex(libraryPath, first);
    expect(first.archivedCastables).toEqual(['Old One']);

    await new Promise((r) => setTimeout(r, 10));
    await writeArchivedXml(libraryPath, 'castables', 'old/a.xml', castableXml('Old One Renamed'));

    const second = await buildIndex(libraryPath);
    expect(second.archivedCastables).toEqual(['Old One Renamed']);
  });
});

// ── Recursive scanning ──────────────────────────────────────────────────────

describe('recursive scanning', () => {
  it('indexes active files in subdirectories, keyed by type-relative path', async () => {
    await writeXml(libraryPath, 'castables', 'flat.xml', castableXml('Flat'));
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Blast'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).toEqual(['Blast', 'Flat']);
    expect(index.castablesNamesByFilename['fire/blast.xml']).toBe('Blast');
    expect(index.castableFilenames['Blast']).toBe('fire/blast.xml');
  });

  it('keeps both files when two subdirectories share a basename', async () => {
    await writeXml(libraryPath, 'castables', 'fire/blast.xml', castableXml('Fire Blast'));
    await writeXml(libraryPath, 'castables', 'ice/blast.xml', castableXml('Ice Blast'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).toEqual(['Fire Blast', 'Ice Blast']);
    expect(index.castablesNamesByFilename['fire/blast.xml']).toBe('Fire Blast');
    expect(index.castablesNamesByFilename['ice/blast.xml']).toBe('Ice Blast');
  });

  it('indexes archived files nested inside .ignore subdirectories', async () => {
    // Mirrors the real world data, which parks 76 files under
    // `spawngroups/.ignore/Deprecated Spawngroups/`.
    await writeArchivedXml(libraryPath, 'spawngroups', 'Deprecated/old.xml', spawnGroupXml('Old Group'));

    const index = await buildIndex(libraryPath);
    expect(index.archivedSpawngroups).toEqual(['Old Group']);
    expect(index.spawngroupsNamesByFilename['.ignore/Deprecated/old.xml']).toBe('Old Group');
  });

  it('treats .ignore as archived at any depth', async () => {
    await writeXml(libraryPath, 'castables', 'sub/.ignore/deep.xml', castableXml('Deep'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).not.toContain('Deep');
    expect(index.archivedCastables).toContain('Deep');
  });

  it('does not treat a filename merely containing .ignore as archived', async () => {
    // The server would skip this (it substring-matches the whole path); we do
    // not. No such file exists in the world data — see scan.ts for the rationale.
    await writeXml(libraryPath, 'castables', 'my.ignore.xml', castableXml('Tricky'));

    const index = await buildIndex(libraryPath);
    expect(index.castables).toContain('Tricky');
    expect(index.archivedCastables).not.toContain('Tricky');
  });

  it('an archived file no longer clobbers an active file with the same basename', async () => {
    await writeXml(libraryPath, 'castables', 'dup.xml', castableXml('Active One'));
    await writeArchivedXml(libraryPath, 'castables', 'dup.xml', castableXml('Archived One'));

    const index = await buildIndex(libraryPath);
    expect(index.castablesNamesByFilename['dup.xml']).toBe('Active One');
    expect(index.castablesNamesByFilename['.ignore/dup.xml']).toBe('Archived One');
    expect(index.castableFilenames['Archived One']).toBeUndefined();
  });

  it('keeps an active castable whose name also exists in the archive', async () => {
    // castableFilenames used to exclude by NAME, so the active file was wrongly
    // dropped whenever an archived file happened to share its name.
    await writeXml(libraryPath, 'castables', 'a.xml', castableXml('Shared'));
    await writeArchivedXml(libraryPath, 'castables', 'old.xml', castableXml('Shared'));

    const index = await buildIndex(libraryPath);
    expect(index.castableFilenames['Shared']).toBe('a.xml');
  });

  it('carries type-relative filenames in mapDetails and ignoredMapDetails', async () => {
    // The real world data has maps/DarsDarkMagicShop.xml colliding with an
    // identically named file in maps/.ignore/.
    await writeXml(libraryPath, 'maps', 'dup.xml', mapXml('Active Map', 1, 10, 20));
    await writeArchivedXml(libraryPath, 'maps', 'dup.xml', mapXml('Archived Map', 2, 30, 40));

    const index = await buildIndex(libraryPath);
    expect(index.mapDetails).toEqual([
      { id: 1, name: 'Active Map', filename: 'dup.xml', x: 10, y: 20 },
    ]);
    expect(index.ignoredMapDetails).toEqual([
      { id: 2, name: 'Archived Map', filename: '.ignore/dup.xml', x: 30, y: 40 },
    ]);
  });

  it('derives npcJobs from basenames regardless of subdirectory', async () => {
    await writeXml(libraryPath, 'npcs', 'town/vendor_bob.xml', npcXml('Bob'));

    const index = await buildIndex(libraryPath);
    expect(index.npcJobs).toEqual(['vendor']);
  });

  it('scans lua scripts and cookies in subdirectories', async () => {
    await writeLua(libraryPath, 'quests/deep/q.lua', 'player.setcookie("deep_cookie")');

    const index = await buildIndex(libraryPath);
    expect(index.scripts).toContain('quests/deep/q');
    expect(index.cookieNames).toContain('deep_cookie');
  });

  it('orders usedBy deterministically by file path, not readdir order', async () => {
    await writeXml(libraryPath, 'items', 'b.xml', itemXml('Bravo', { category: 'Weapon' }));
    await writeXml(libraryPath, 'items', 'a.xml', itemXml('Alpha', { category: 'Weapon' }));

    const index = await buildIndex(libraryPath);
    expect(index.itemCategoryDetails[0]?.usedBy).toEqual(['Alpha', 'Bravo']);
  });
});
