import { join } from 'path';
import type {
  BuildOptions,
  CategoryDetail,
  DuplicateNames,
  IndexType,
  MapDetail,
  NpcStringKey,
  WorldIndex,
} from './types.js';
import { INDEX_TYPES } from './types.js';
import { duplicateNamesKey, nameCollisionKey } from './names.js';
import { xmlText } from './xmltext.js';
import { fieldsForType, loadIndex } from './storage.js';
import {
  SCRIPTS_KEY,
  computeFileCache,
  loadFileCache,
  sectionSigEqual,
  type FileCache,
} from './filecache.js';
import { listLuaFiles, listSectionFiles, readAllInOrder } from './scan.js';

/**
 * Last segment of a type-relative path. Paths from scan.ts are always
 * forward-slashed, so this is platform-independent (unlike `path.basename`,
 * which only treats `/` as a separator on POSIX).
 */
const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

/**
 * Accumulate <Categories> usage from one file's content into `catMap`. Mirrors
 * the former standalone scanCategoryDetails so output stays identical — but runs
 * inside the single read pass instead of re-reading every file.
 */
function accumulateCategories(
  content: string,
  fallbackName: string,
  catMap: Record<string, { count: number; usedBy: string[]; members: string[] }>,
): void {
  const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content) || /\bName="([^"]+)"/.exec(content);
  const itemName = xmlText(nameMatch?.[1]) || fallbackName;
  const catSection = /<Categories[^>]*>([\s\S]*?)<\/Categories>/.exec(content);
  if (!catSection || !catSection[1]) return;
  const body = catSection[1];
  const record = (c: string): void => {
    if (!c) return;
    if (!catMap[c]) catMap[c] = { count: 0, usedBy: [], members: [] };
    catMap[c].count++;
    // usedBy stays a capped sample; members is the full, uncapped list.
    if (catMap[c].usedBy.length < 5) catMap[c].usedBy.push(itemName);
    catMap[c].members.push(itemName);
  };
  const catElemRegex = /<Category\b[^>]*>([^<]+)<\/Category>/g;
  const catAttrRegex = /<Category\b[^>]*\bName="([^"]+)"/g;
  let m;
  while ((m = catElemRegex.exec(body)) !== null) record(xmlText(m[1]));
  while ((m = catAttrRegex.exec(body)) !== null) record(xmlText(m[1]));
}

/** Build the sorted CategoryDetail[] from an accumulated category map. */
function categoryDetailsFrom(
  catMap: Record<string, { count: number; usedBy: string[]; members: string[] }>,
): CategoryDetail[] {
  return Object.entries(catMap)
    .map(([name, { count, usedBy }]) => ({ name, count, usedBy: count < 5 ? usedBy : [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build a category name -> full member-name list from an accumulated category
 * map. Unlike CategoryDetail.usedBy (a 5-item sample), this is the complete,
 * deduped, sorted member list — used to resolve a category to every castable in
 * it (e.g. spellbook expansion in Creidhne).
 */
function categoryMembersFrom(
  catMap: Record<string, { count: number; usedBy: string[]; members: string[] }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, { members }] of Object.entries(catMap)) {
    out[name] = [...new Set(members)].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/** Types whose identifier is an XML attribute on the root element. */
const ATTR_NAME_MAP: Partial<Record<IndexType, string>> = {
  statuses: 'Name',
  creatures: 'Name',
  creaturebehaviorsets: 'Name',
  elementtables: 'Name',
  lootsets: 'Name',
  serverconfigs: 'Name',
  spawngroups: 'Name',
  localizations: 'Locale',
};

/** Regex used to extract identifier from archived (.ignore) files per type. */
const ARCHIVED_NAME_REGEX: Partial<Record<IndexType, RegExp>> = {
  castables: /<Name>([^<]+)<\/Name>/,
  creatures: /\bName="([^"]+)"/,
  creaturebehaviorsets: /\bName="([^"]+)"/,
  elementtables: /\bName="([^"]+)"/,
  items: /<Name>([^<]+)<\/Name>/,
  localizations: /\bLocale="([^"]+)"/,
  lootsets: /\bName="([^"]+)"/,
  nations: /<Name>([^<]+)<\/Name>/,
  npcs: /<Name>([^<]+)<\/Name>/,
  recipes: /<Name>([^<]+)<\/Name>/,
  serverconfigs: /\bName="([^"]+)"/,
  spawngroups: /\bName="([^"]+)"/,
  statuses: /\bName="([^"]+)"/,
  variantgroups: /<Name>([^<]+)<\/Name>/,
};

const archivedKey = (type: IndexType): string =>
  `archived${type.charAt(0).toUpperCase()}${type.slice(1)}`;

const namesByFilenameKey = (type: IndexType): string => `${type}NamesByFilename`;

/**
 * Extract the `<!-- creidhne:meta {...} -->` comment payload as a raw object.
 * Returns null when the comment is missing or malformed. Regex-based so we
 * don't have to parse the full XML just to read the annotation.
 */
function readCreidhneMeta(content: string): Record<string, unknown> | null {
  const m = /<!--\s*creidhne:meta\s+({.*?})\s*-->/.exec(content);
  if (!m || !m[1]) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function addReverseRef(
  map: Record<string, string[]>,
  formulaName: unknown,
  entityName: string,
): void {
  if (typeof formulaName !== 'string' || !formulaName) return;
  if (!map[formulaName]) map[formulaName] = [];
  if (!map[formulaName].includes(entityName)) map[formulaName].push(entityName);
}

// ── File utilities ──────────────────────────────────────────────────────────

/**
 * Extract names from a type's archived (`.ignore/`) files. Archived entries are
 * a name catalog only — the full cross-reference extraction below applies to
 * active files, since the server never loads anything under `.ignore/`.
 *
 * `rels` are the pre-enumerated archived paths from `listSectionFiles`, so the
 * returned `namesByFilename` is keyed by `.ignore/`-prefixed relative path and
 * cannot collide with the active map.
 */
async function readArchived(
  dir: string,
  rels: string[],
  nameRegex: RegExp,
): Promise<{ names: string[]; namesByFilename: Record<string, string> }> {
  const names: string[] = [];
  const nameSet = new Set<string>();
  const namesByFilename: Record<string, string> = {};
  const contents = await readAllInOrder(dir, rels);
  for (let i = 0; i < rels.length; i++) {
    const content = contents[i];
    if (content == null) continue;
    const n = xmlText(nameRegex.exec(content)?.[1]);
    if (!n) continue;
    if (!nameSet.has(n)) {
      nameSet.add(n);
      names.push(n);
    }
    namesByFilename[rels[i]!] = n;
  }
  return { names: names.sort(), namesByFilename };
}

/**
 * Extract a map's id/coords. Shared by the active scan and the archived scan so
 * both agree on what a MapDetail is. `name` is optional here: the active branch
 * gates on a non-empty <Name> itself (it needs one to register the map), while
 * archived maps are catalogued even when unnamed.
 */
function parseMapDetail(content: string, rel: string): MapDetail | null {
  const idMatch = /\bId="(\d+)"/.exec(content);
  const xMatch = /\bX="(\d+)"/.exec(content);
  const yMatch = /\bY="(\d+)"/.exec(content);
  if (!idMatch?.[1] || !xMatch?.[1] || !yMatch?.[1]) return null;
  const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
  return {
    id: parseInt(idMatch[1], 10),
    name: xmlText(nameMatch?.[1]),
    filename: rel,
    x: parseInt(xMatch[1], 10),
    y: parseInt(yMatch[1], 10),
  };
}

/** An `xs:float` attribute value, including the `.5` and `1e2` spellings. */
const FLOAT = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;

const damageAttr = (name: string, attrs: string): number | null => {
  const m = new RegExp(String.raw`\b${name}="(${FLOAT})"`).exec(attrs);
  if (!m?.[1]) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
};

/**
 * Read an item's `<Damage>` attributes. Returns null for an item that has no
 * `<Damage>` element — most items — and for one whose required attributes are
 * missing or unparsable.
 *
 * Three rules here, each of which used to drop a weapon out of the index
 * silently, with no error and no way to tell an absent weapon from a
 * non-weapon:
 *
 * - **Both element forms count.** `<Damage …/>` and `<Damage …></Damage>` are
 *   the same element. `ItemDamage` in Item.xsd declares attributes and no child
 *   content, so an editor may write either.
 * - **A zero is a value.** `SmallMin="0"` captures the string `"0"`, which is
 *   falsy — a truthiness guard drops any weapon whose minimum is legitimately 0.
 *   Presence is what matters, so every test here is against null.
 * - **Only SmallMin/SmallMax are required.** Item.xsd marks LargeMin/LargeMax
 *   optional with a default of 0.0, and `world` has a weapon that relies on it
 *   (`weapon_oak-stick.xml`). Requiring all four dropped it.
 */
function parseItemDamage(
  content: string,
): { smallMin: number; smallMax: number; largeMin: number; largeMax: number } | null {
  const dmgMatch = /<Damage\b([^>]*?)\/?>/.exec(content);
  if (!dmgMatch || dmgMatch[1] == null) return null;
  const attrs = dmgMatch[1];
  const smallMin = damageAttr('SmallMin', attrs);
  const smallMax = damageAttr('SmallMax', attrs);
  if (smallMin == null || smallMax == null) return null;
  return {
    smallMin,
    smallMax,
    largeMin: damageAttr('LargeMin', attrs) ?? 0,
    largeMax: damageAttr('LargeMax', attrs) ?? 0,
  };
}

// ── Per-type scan ───────────────────────────────────────────────────────────

/**
 * Result of scanning one type's directory. `fields` contains every
 * WorldIndex field populated by this scan (name list, namesByFilename,
 * cross-refs, aggregates). A buildSection call for a given type replaces
 * exactly these fields.
 */
export interface SectionResult {
  type: IndexType;
  fields: Record<string, unknown>;
}

/**
 * Scan a single type's directory (active + archived) plus any aggregates this
 * type's scan uniquely contributes (category details, vendor tabs, etc.).
 * Used by both `buildIndex` (running all types) and `buildSection` (one type).
 */
export async function buildSection(
  libraryPath: string,
  type: IndexType,
  options: BuildOptions = {},
): Promise<SectionResult> {
  const { onProgress } = options;
  const names: string[] = [];
  const nameSet = new Set<string>();
  const namesByFilename: Record<string, string> = {};
  const attrName = ATTR_NAME_MAP[type];
  // Hoisted out of the per-file loop (was rebuilt per file before).
  const attrNameRegex = attrName ? new RegExp(`\\b${attrName}="([^"]+)"`) : null;
  const localizationSections: [string, RegExp][] = [
    ['Common', /<Common>[\s\S]*?<\/Common>/],
    ['Merchant', /<Merchant>[\s\S]*?<\/Merchant>/],
    ['Monster', /<MonsterSpeak>[\s\S]*?<\/MonsterSpeak>/],
  ];
  const shopTabRegex = /\bShopTab="([^"]+)"/g;
  const elementRegex = /<Source[^>]+Element="([^"]+)"/g;

  // Cross-refs + aggregates this scan may populate
  const castableClasses: Record<string, string> = {};
  const castableIcons: Record<string, number> = {};
  const castableBooks: Record<string, string> = {};
  const statusCasters: Record<string, string[]> = {};
  const npcResponseCalls: Record<string, string> = {};
  const npcStringKeys: NpcStringKey[] = [];
  const npcStringKeySet = new Set<string>();
  const creatureTypes: string[] = [];
  const creatureTypesSet = new Set<string>();
  const castableTrainers: Record<string, string[]> = {};
  const itemVendors: Record<string, string[]> = {};
  const itemLootSets: Record<string, string[]> = {};
  const mapDetails: MapDetail[] = [];
  const formulaUsedByCastables: Record<string, string[]> = {};
  const formulaUsedByStatuses: Record<string, string[]> = {};
  const castableRequiredLevels: Record<string, number> = {};
  const itemWeaponDamage: Record<string, { smallMin: number; smallMax: number; largeMin: number; largeMax: number }> = {};
  // Aggregates folded into this single read pass (formerly separate re-reads of
  // every file): category usage, vendor tabs, element names.
  const catMap: Record<string, { count: number; usedBy: string[]; members: string[] }> = {};
  const vendorTabSet = new Set<string>();
  const elementNameSet = new Set<string>();
  const addName = (name: string): boolean => {
    if (nameSet.has(name)) return false;
    nameSet.add(name);
    names.push(name);
    return true;
  };
  // Collision key → the active files claiming that name. Recorded BEFORE the
  // dedup guards below, which drop a repeat name silently — the drop is exactly
  // the condition being reported. Keyed by `nameCollisionKey`, which matches the
  // server's map key and approximates its keys for other types (see its docs);
  // `names` itself stays case-sensitive and unchanged.
  const claimsByName = new Map<string, string[]>();
  const claimName = (name: string, rel: string): void => {
    const key = nameCollisionKey(name);
    const claims = claimsByName.get(key);
    if (!claims) claimsByName.set(key, [rel]);
    else if (!claims.includes(rel)) claims.push(rel);
  };

  // Recursive: subdirectories under a type dir are legal on disk (the server
  // loads them). `active`/`archived` are type-relative paths — `fire/blast.xml`,
  // `.ignore/old.xml` — which is what namesByFilename is keyed by.
  const { dir: dirPath, active, archived } = await listSectionFiles(libraryPath, type);
  // Phase 1: read all files concurrently (bounded). Phase 2 (below) parses them
  // in enumeration order so order-sensitive accumulators stay deterministic.
  const contents = await readAllInOrder(dirPath, active);
  let scanned = 0;

  for (let fi = 0; fi < active.length; fi++) {
    const rel = active[fi]!;
    const content = contents[fi];
    if (content == null) {
      scanned += 1;
      onProgress?.({ phase: 'scan', type, current: scanned, total: active.length });
      continue;
    }
    const recordName = (name: string): void => {
      addName(name);
      namesByFilename[rel] = name;
    };

    // Folded aggregates (run for every file of the type, matching the old
    // standalone scans which did not dedup by name).
    if (type === 'castables' || type === 'statuses' || type === 'items') {
      // Fallback display name only — a basename, not an index key.
      accumulateCategories(content, baseName(rel).replace(/\.xml$/i, ''), catMap);
    }
    if (type === 'items') {
      shopTabRegex.lastIndex = 0;
      let vt;
      while ((vt = shopTabRegex.exec(content)) !== null) {
        const v = xmlText(vt[1]);
        if (v) vendorTabSet.add(v);
      }
    }
    if (type === 'elementtables') {
      elementRegex.lastIndex = 0;
      let em;
      while ((em = elementRegex.exec(content)) !== null) {
        const v = xmlText(em[1]);
        if (v) elementNameSet.add(v);
      }
    }

    if (type === 'castables') {
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = xmlText(nameMatch[1]);
        if (name) claimName(name, rel);
        if (name && !nameSet.has(name)) {
          recordName(name);
          const classMatch = /<Castable[^>]+Class="([^"]*)"/.exec(content);
          if (classMatch && classMatch[1] != null) castableClasses[name] = xmlText(classMatch[1]);
          // Icon id + Book (root attrs) — used to render castable icons in UIs
          // that only have the name to hand (e.g. Creidhne's spellbook preview).
          const iconMatch = /<Castable[^>]+\bIcon="(\d+)"/.exec(content);
          if (iconMatch && iconMatch[1] != null) castableIcons[name] = parseInt(iconMatch[1], 10);
          const bookMatch = /<Castable[^>]+\bBook="([^"]*)"/.exec(content);
          if (bookMatch && bookMatch[1] != null) castableBooks[name] = xmlText(bookMatch[1]);
          const statusesMatch = /<Statuses>([\s\S]*?)<\/Statuses>/.exec(content);
          if (statusesMatch && statusesMatch[1]) {
            const addRegex = /<Add[^>]*>([^<]+)<\/Add>/g;
            let am;
            while ((am = addRegex.exec(statusesMatch[1])) !== null) {
              const key = xmlText(am[1]).toLowerCase();
              if (key) {
                if (!statusCasters[key]) statusCasters[key] = [];
                if (!statusCasters[key].includes(name)) statusCasters[key].push(name);
              }
            }
          }
          // Formula reverse index — extract named formula references from meta.
          const meta = readCreidhneMeta(content);
          if (meta) {
            addReverseRef(formulaUsedByCastables, meta.healFormulaName, name);
            addReverseRef(formulaUsedByCastables, meta.damageFormulaName, name);
          }
          // First <Requirement>'s <Level Min="N"/> — castables can declare
          // multiple Requirement blocks per class, but only the first is
          // used in practice (see DamageCalculator auto-populate).
          const firstReqMatch = /<Requirements>([\s\S]*?)<\/Requirements>/.exec(content);
          if (firstReqMatch && firstReqMatch[1]) {
            const reqBlock = /<Requirement\b[^>]*>([\s\S]*?)<\/Requirement>/.exec(firstReqMatch[1]);
            if (reqBlock && reqBlock[1]) {
              const levelMatch = /<Level\b[^>]*\bMin="(\d+)"/.exec(reqBlock[1]);
              if (levelMatch && levelMatch[1]) {
                castableRequiredLevels[name] = parseInt(levelMatch[1], 10);
              }
            }
          }
        }
      }
    } else if (type === 'localizations') {
      const localeMatch = /\bLocale="([^"]+)"/.exec(content);
      if (localeMatch && localeMatch[1]) {
        const name = xmlText(localeMatch[1]);
        if (name) {
          claimName(name, rel);
          recordName(name);
        }
      }
      const npcCallRegex = /<Response[^>]+Call="([^"]+)"[^>]*>([^<]*)<\/Response>/g;
      let callMatch;
      while ((callMatch = npcCallRegex.exec(content)) !== null) {
        const call = xmlText(callMatch[1]);
        if (call) npcResponseCalls[call] = xmlText(callMatch[2]);
      }
      for (const [label, sectionRegex] of localizationSections) {
        const sectionMatch = sectionRegex.exec(content);
        if (!sectionMatch) continue;
        const strRegex = /<String[^>]+Key="([^"]+)"[^>]*>([^<]*)<\/String>/g;
        let sm;
        while ((sm = strRegex.exec(sectionMatch[0])) !== null) {
          const key = xmlText(sm[1]);
          const message = xmlText(sm[2]);
          if (!key) continue;
          const seenKey = `${label}\u0000${key}`;
          if (!npcStringKeySet.has(seenKey)) {
            npcStringKeySet.add(seenKey);
            npcStringKeys.push({ key, message, category: label });
          }
        }
      }
    } else if (type === 'creatures') {
      const nameMatch = /\bName="([^"]+)"/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = xmlText(nameMatch[1]);
        if (name) claimName(name, rel);
        if (name && !nameSet.has(name)) recordName(name);
      }
      const typeRegex = /<Type[^>]+Name="([^"]+)"/g;
      let tm;
      while ((tm = typeRegex.exec(content)) !== null) {
        const tn = xmlText(tm[1]);
        if (tn && !creatureTypesSet.has(tn)) {
          creatureTypesSet.add(tn);
          creatureTypes.push(tn);
        }
      }
    } else if (type === 'maps') {
      // Maps don't need namesByFilename — mapDetails already carries filename
      // per entry. Keep the names list sorted for the `index.maps` field.
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = xmlText(nameMatch[1]);
        if (name) {
          claimName(name, rel);
          addName(name);
          const detail = parseMapDetail(content, rel);
          if (detail) mapDetails.push(detail);
        }
      }
    } else if (attrNameRegex) {
      const match = attrNameRegex.exec(content);
      if (match && match[1]) {
        const name = xmlText(match[1]);
        if (name) claimName(name, rel);
        if (name && !nameSet.has(name)) recordName(name);
        // Statuses encode formula references under meta.formulaNames per block
        // (onApply/onTick/onRemove × heal/damage). Extract and reverse-index.
        if (type === 'statuses' && name) {
          const meta = readCreidhneMeta(content);
          const fnByBlock = meta && typeof meta.formulaNames === 'object' ? meta.formulaNames as Record<string, unknown> : null;
          if (fnByBlock) {
            for (const block of ['onApply', 'onTick', 'onRemove']) {
              const fn = fnByBlock[block];
              if (fn && typeof fn === 'object') {
                const fnEntries = fn as Record<string, unknown>;
                addReverseRef(formulaUsedByStatuses, fnEntries.heal, name);
                addReverseRef(formulaUsedByStatuses, fnEntries.damage, name);
              }
            }
          }
        }
        // Lootsets: every <Item> inside an <Items> block is reverse-indexed
        // so the items editor can show "appears in loot set X".
        if (type === 'lootsets' && name) {
          const itemsBlockRegex = /<Items[^>]*>([\s\S]*?)<\/Items>/g;
          let ib;
          while ((ib = itemsBlockRegex.exec(content)) !== null) {
            const body = ib[1] ?? '';
            const itemRegex = /<Item[^>]*>([^<]+)<\/Item>/g;
            let im;
            while ((im = itemRegex.exec(body)) !== null) {
              const key = xmlText(im[1]).toLowerCase();
              if (key) {
                if (!itemLootSets[key]) itemLootSets[key] = [];
                if (!itemLootSets[key].includes(name)) itemLootSets[key].push(name);
              }
            }
          }
        }
      }
    } else if (type === 'npcs') {
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const npcName = xmlText(nameMatch[1]);
        if (npcName) claimName(npcName, rel);
        if (npcName && !nameSet.has(npcName)) {
          recordName(npcName);
          const trainMatch = /<Train>([\s\S]*?)<\/Train>/.exec(content);
          if (trainMatch && trainMatch[1]) {
            const castableRegex = /<Castable[^>]+Name="([^"]+)"/g;
            let cm;
            while ((cm = castableRegex.exec(trainMatch[1])) !== null) {
              const key = xmlText(cm[1]).toLowerCase();
              if (key) {
                if (!castableTrainers[key]) castableTrainers[key] = [];
                if (!castableTrainers[key].includes(npcName)) castableTrainers[key].push(npcName);
              }
            }
          }
          const vendMatch = /<Vend>([\s\S]*?)<\/Vend>/.exec(content);
          if (vendMatch && vendMatch[1]) {
            const vendItemRegex = /<Item[^>]+Name="([^"]+)"/g;
            let vm;
            while ((vm = vendItemRegex.exec(vendMatch[1])) !== null) {
              const key = xmlText(vm[1]).toLowerCase();
              if (key) {
                if (!itemVendors[key]) itemVendors[key] = [];
                if (!itemVendors[key].includes(npcName)) itemVendors[key].push(npcName);
              }
            }
          }
        }
      }
    } else if (type === 'variantgroups' || type === 'worldmaps') {
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = xmlText(nameMatch[1]);
        if (name) claimName(name, rel);
        if (name && !nameSet.has(name)) recordName(name);
      }
    } else {
      // nations, items, recipes — use all <Name> child elements; first one is
      // the file's identifier for namesByFilename, the rest may still be added
      // to the names array (e.g. nations have multiple named regions).
      const nameRegex = /<Name>([^<]+)<\/Name>/g;
      let match;
      let firstName: string | null = null;
      while ((match = nameRegex.exec(content)) !== null) {
        const name = xmlText(match[1]);
        if (name) addName(name);
        if (name && firstName === null) firstName = name;
      }
      if (firstName) {
        claimName(firstName, rel);
        namesByFilename[rel] = firstName;
      }

      // Items: capture <Damage SmallMin/SmallMax/LargeMin/LargeMax/> attrs
      // when present (only weapons have it). Used by the damage calculator
      // to auto-populate weapon ranges from a referenced item.
      if (type === 'items' && firstName) {
        const damage = parseItemDamage(content);
        if (damage) itemWeaponDamage[firstName] = damage;
      }
    }

    scanned += 1;
    onProgress?.({ phase: 'scan', type, current: scanned, total: active.length });
  }

  names.sort();

  // Archived scan. Keys are `.ignore/`-prefixed, so this cannot overwrite an
  // active entry that happens to share a basename.
  const archRegex = ARCHIVED_NAME_REGEX[type];
  let archivedNames: string[] = [];
  if (archRegex) {
    const result = await readArchived(dirPath, archived, archRegex);
    archivedNames = result.names;
    Object.assign(namesByFilename, result.namesByFilename);
  }

  // Build the field dict for this type's scan. Maps carry their filename in
  // mapDetails, so they have no namesByFilename map (and it is not in
  // FIELD_TO_FILE) — emitting an empty one would desync from the reuse path.
  const fields: Record<string, unknown> = { [type]: names };
  if (type !== 'maps') fields[namesByFilenameKey(type)] = namesByFilename;
  if (archRegex) fields[archivedKey(type)] = archivedNames;

  // Collision report. A grouping over names already in memory, so it costs
  // nothing beyond the map itself, and it is emitted for every type — including
  // the ones whose name is an attribute, which a survey by <Name> element
  // cannot see.
  const duplicateNames: DuplicateNames = {};
  for (const [key, claims] of claimsByName) {
    if (claims.length > 1) duplicateNames[key] = claims;
  }
  fields[duplicateNamesKey(type)] = duplicateNames;

  if (type === 'castables') {
    fields.castableClasses = castableClasses;
    fields.castableIcons = castableIcons;
    fields.castableBooks = castableBooks;
    fields.statusCasters = statusCasters;
    fields.formulaUsedByCastables = formulaUsedByCastables;
    fields.castableRequiredLevels = castableRequiredLevels;
    // name → filename map (inverse of namesByFilename, kept for backward compat).
    // Driven off the active list so archived files are excluded by where they
    // live, not by name — an active castable whose name also appears somewhere
    // in the archive still belongs here.
    const castableFilenames: Record<string, string> = {};
    for (const rel of active) {
      const n = namesByFilename[rel];
      if (n) castableFilenames[n] = rel;
    }
    fields.castableFilenames = castableFilenames;
    const details = categoryDetailsFrom(catMap);
    fields.castableCategories = details.map((c) => c.name);
    fields.castableCategoryDetails = details;
    fields.castableCategoryMembers = categoryMembersFrom(catMap);
  } else if (type === 'statuses') {
    fields.formulaUsedByStatuses = formulaUsedByStatuses;
    const details = categoryDetailsFrom(catMap);
    fields.statusCategories = details.map((c) => c.name);
    fields.statusCategoryDetails = details;
  } else if (type === 'items') {
    const details = categoryDetailsFrom(catMap);
    fields.itemCategories = details.map((c) => c.name);
    fields.itemCategoryDetails = details;
    fields.vendorTabs = [...vendorTabSet].sort();
    fields.itemWeaponDamage = itemWeaponDamage;
  } else if (type === 'creatures') {
    fields.creatureTypes = creatureTypes.sort();
    fields.creatureFamilies = filenamePrefixes(active);
  } else if (type === 'npcs') {
    fields.castableTrainers = castableTrainers;
    fields.itemVendors = itemVendors;
    fields.npcJobs = filenamePrefixes(active, (p) => p.toLowerCase() !== 'npc');
  } else if (type === 'lootsets') {
    fields.itemLootSets = itemLootSets;
  } else if (type === 'localizations') {
    fields.npcResponseCalls = npcResponseCalls;
    fields.npcStringKeys = npcStringKeys;
  } else if (type === 'elementtables') {
    fields.elementnames = [...elementNameSet].sort();
  } else if (type === 'maps') {
    mapDetails.sort((a, b) => a.id - b.id);
    fields.mapDetails = mapDetails;
    fields.ignoredMapDetails = await readIgnoredMapDetails(dirPath, archived);
  }

  onProgress?.({ phase: 'done', type });
  return { type, fields };
}

// ── Supporting scans ────────────────────────────────────────────────────────

/**
 * Derive the `<prefix>_rest.xml` naming convention (npc jobs, creature families)
 * from already-enumerated files. Keyed off the basename, so a file's
 * subdirectory has no bearing on its prefix.
 */
function filenamePrefixes(
  rels: string[],
  filter: (prefix: string) => boolean = () => true,
): string[] {
  const prefixes = new Set<string>();
  for (const rel of rels) {
    const namePart = baseName(rel).replace(/\.xml$/i, '');
    const idx = namePart.indexOf('_');
    if (idx > 0) {
      const prefix = namePart.slice(0, idx);
      if (prefix && filter(prefix)) prefixes.add(prefix);
    }
  }
  return [...prefixes].sort();
}

/** Map details for a type's archived files (maps has no ARCHIVED_NAME_REGEX). */
async function readIgnoredMapDetails(dir: string, rels: string[]): Promise<MapDetail[]> {
  const contents = await readAllInOrder(dir, rels);
  const list: MapDetail[] = [];
  for (let i = 0; i < rels.length; i++) {
    const content = contents[i];
    if (content == null) continue;
    const detail = parseMapDetail(content, rels[i]!);
    if (detail) list.push(detail);
  }
  list.sort((a, b) => a.id - b.id);
  return list;
}

/** Global scans that are not tied to a specific INDEX_TYPE scan. */
async function scanScriptsAndCookies(libraryPath: string): Promise<{
  scripts: string[];
  cookieNames: string[];
}> {
  const scriptsDir = join(libraryPath, '..', 'scripts');
  const rels = await listLuaFiles(scriptsDir);
  // `index.scripts` holds extensionless paths; the enumeration keeps the
  // extension so the file cache can stat what it lists.
  const scripts = rels.map((rel) => rel.replace(/\.[^.]+$/, ''));

  const cookies = new Set<string>();
  const cookieRegex = /\w+\.setcookie\s*\(\s*"([^"]+)"/gi;
  const contents = await readAllInOrder(scriptsDir, rels);
  for (const content of contents) {
    if (content == null) continue;
    cookieRegex.lastIndex = 0;
    let m;
    while ((m = cookieRegex.exec(content)) !== null) {
      if (m[1]) cookies.add(m[1]);
    }
  }
  return { scripts, cookieNames: [...cookies].sort() };
}

// ── Full build ──────────────────────────────────────────────────────────────

function emptyWorldIndex(libraryPath: string): WorldIndex {
  return {
    libraryPath,
    builtAt: new Date().toISOString(),
    castables: [], creatures: [], creaturebehaviorsets: [], elementtables: [], items: [],
    localizations: [], lootsets: [], maps: [], nations: [], npcs: [], recipes: [],
    serverconfigs: [], spawngroups: [], statuses: [], variantgroups: [], worldmaps: [],
    archivedCastables: [], archivedCreatures: [], archivedCreaturebehaviorsets: [],
    archivedElementtables: [], archivedItems: [], archivedLocalizations: [],
    archivedLootsets: [], archivedNations: [], archivedNpcs: [], archivedRecipes: [],
    archivedServerconfigs: [], archivedSpawngroups: [], archivedStatuses: [],
    archivedVariantgroups: [],
    castablesNamesByFilename: {}, statusesNamesByFilename: {}, itemsNamesByFilename: {},
    creaturesNamesByFilename: {}, npcsNamesByFilename: {}, nationsNamesByFilename: {},
    lootsetsNamesByFilename: {}, recipesNamesByFilename: {}, variantgroupsNamesByFilename: {},
    localizationsNamesByFilename: {}, elementtablesNamesByFilename: {},
    creaturebehaviorsetsNamesByFilename: {}, spawngroupsNamesByFilename: {},
    serverconfigsNamesByFilename: {}, worldmapsNamesByFilename: {},
    castablesDuplicateNames: {}, creaturesDuplicateNames: {},
    creaturebehaviorsetsDuplicateNames: {}, elementtablesDuplicateNames: {},
    itemsDuplicateNames: {}, localizationsDuplicateNames: {},
    lootsetsDuplicateNames: {}, mapsDuplicateNames: {}, nationsDuplicateNames: {},
    npcsDuplicateNames: {}, recipesDuplicateNames: {}, serverconfigsDuplicateNames: {},
    spawngroupsDuplicateNames: {}, statusesDuplicateNames: {},
    variantgroupsDuplicateNames: {}, worldmapsDuplicateNames: {},
    castableFilenames: {}, castableClasses: {}, castableIcons: {}, castableBooks: {}, statusCasters: {},
    castableTrainers: {}, itemVendors: {}, itemLootSets: {},
    formulaUsedByCastables: {}, formulaUsedByStatuses: {},
    castableRequiredLevels: {}, itemWeaponDamage: {},
    npcResponseCalls: {}, npcStringKeys: [],
    creatureTypes: [], elementnames: [], scripts: [], cookieNames: [],
    vendorTabs: [], npcJobs: [], creatureFamilies: [],
    itemCategories: [], castableCategories: [], statusCategories: [],
    itemCategoryDetails: [], castableCategoryDetails: [], statusCategoryDetails: [],
    castableCategoryMembers: {},
    mapDetails: [], ignoredMapDetails: [],
  };
}

/**
 * Build the complete world index by scanning every type.
 *
 * Incremental: a per-section build signature (`_filecache.json`) is compared
 * against the current on-disk state. Types whose files are unchanged reuse their
 * fields from the previously persisted index instead of re-reading and
 * re-parsing — so a no-change rebuild is O(stat) and editing one type rescans
 * only that type. The computed signature is attached to the returned index as
 * `__fileCache` so `saveIndex` can persist it without recomputing.
 */
export async function buildIndex(
  libraryPath: string,
  options: BuildOptions = {},
): Promise<WorldIndex> {
  const { onProgress } = options;
  const index = emptyWorldIndex(libraryPath);
  const indexRecord = index as unknown as Record<string, unknown>;

  const current = await computeFileCache(libraryPath);
  const prior = await loadFileCache(libraryPath);
  // Only load the prior index if there's a cache to reuse from.
  const priorIndex = prior ? await loadIndex(libraryPath) : null;
  const priorRecord = priorIndex as unknown as Record<string, unknown> | null;

  for (const type of INDEX_TYPES) {
    const reusable =
      priorRecord && prior && sectionSigEqual(current[type], prior[type]);
    if (reusable) {
      // Copy this type's owned fields straight from the prior index.
      for (const key of fieldsForType(type)) {
        if (key in priorRecord) indexRecord[key] = priorRecord[key];
      }
      onProgress?.({ phase: 'done', type });
    } else {
      const { fields } = await buildSection(libraryPath, type, options);
      Object.assign(indexRecord, fields);
    }
  }

  onProgress?.({ phase: 'cross-ref' });
  if (priorRecord && prior && sectionSigEqual(current[SCRIPTS_KEY], prior[SCRIPTS_KEY])) {
    index.scripts = (priorRecord.scripts as string[]) ?? [];
    index.cookieNames = (priorRecord.cookieNames as string[]) ?? [];
  } else {
    const { scripts, cookieNames } = await scanScriptsAndCookies(libraryPath);
    index.scripts = scripts;
    index.cookieNames = cookieNames;
  }

  indexRecord.__fileCache = current as unknown as FileCache;
  onProgress?.({ phase: 'done' });
  return index;
}
