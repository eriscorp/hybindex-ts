import { promises as fs, type Dirent } from 'fs';
import { join } from 'path';
import type {
  BuildOptions,
  CategoryDetail,
  IndexType,
  MapDetail,
  NpcStringKey,
  WorldIndex,
} from './types.js';
import { INDEX_TYPES } from './types.js';

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
  lootsets: /\bName="([^"]+)"/,
  nations: /<Name>([^<]+)<\/Name>/,
  npcs: /<Name>([^<]+)<\/Name>/,
  recipes: /<Name>([^<]+)<\/Name>/,
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

async function walkDir(
  dir: string,
  ext: string,
  base: string,
  results: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walkDir(full, ext, base, results);
      else if (e.isFile() && e.name.endsWith(ext)) {
        results.push(full.slice(base.length + 1).replace(/\\/g, '/').replace(/\.[^.]+$/, ''));
      }
    }
  } catch { /* dir may not exist */ }
  return results;
}

/**
 * Scan an archived `.ignore/` directory for names. Returns sorted array of
 * names and a filename→name map covering the archived files.
 */
async function readArchived(
  dirPath: string,
  nameRegex: RegExp,
): Promise<{ names: string[]; namesByFilename: Record<string, string> }> {
  const names: string[] = [];
  const namesByFilename: Record<string, string> = {};
  try {
    const ignoredDir = join(dirPath, '.ignore');
    const entries = await fs.readdir(ignoredDir, { withFileTypes: true });
    for (const file of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const content = await fs.readFile(join(ignoredDir, file.name), 'utf-8');
      const m = nameRegex.exec(content);
      if (m && m[1]) {
        const n = m[1].trim();
        if (n) {
          if (!names.includes(n)) names.push(n);
          namesByFilename[file.name] = n;
        }
      }
    }
  } catch { /* .ignore may not exist */ }
  return { names: names.sort(), namesByFilename };
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
  const dirPath = join(libraryPath, type);
  const names: string[] = [];
  const namesByFilename: Record<string, string> = {};
  const attrName = ATTR_NAME_MAP[type];

  // Cross-refs + aggregates this scan may populate
  const castableClasses: Record<string, string> = {};
  const statusCasters: Record<string, string[]> = {};
  const npcResponseCalls: Record<string, string> = {};
  const npcStringKeys: NpcStringKey[] = [];
  const creatureTypes: string[] = [];
  const castableTrainers: Record<string, string[]> = {};
  const itemVendors: Record<string, string[]> = {};
  const itemLootSets: Record<string, string[]> = {};
  const mapDetails: MapDetail[] = [];
  const formulaUsedByCastables: Record<string, string[]> = {};
  const formulaUsedByStatuses: Record<string, string[]> = {};
  const castableRequiredLevels: Record<string, number> = {};
  const itemWeaponDamage: Record<string, { smallMin: number; smallMax: number; largeMin: number; largeMax: number }> = {};

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch { /* dir may not exist */ }

  const xmlEntries = entries.filter((e) => e.isFile() && e.name.endsWith('.xml'));
  let scanned = 0;

  for (const file of xmlEntries) {
    const content = await fs.readFile(join(dirPath, file.name), 'utf-8');
    const recordName = (name: string): void => {
      if (!names.includes(name)) names.push(name);
      namesByFilename[file.name] = name;
    };

    if (type === 'castables') {
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1].trim();
        if (name && !names.includes(name)) {
          recordName(name);
          const classMatch = /<Castable[^>]+Class="([^"]*)"/.exec(content);
          if (classMatch && classMatch[1] != null) castableClasses[name] = classMatch[1].trim();
          const statusesMatch = /<Statuses>([\s\S]*?)<\/Statuses>/.exec(content);
          if (statusesMatch && statusesMatch[1]) {
            const addRegex = /<Add[^>]*>([^<]+)<\/Add>/g;
            let am;
            while ((am = addRegex.exec(statusesMatch[1])) !== null) {
              const key = (am[1] ?? '').trim().toLowerCase();
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
        const name = localeMatch[1].trim();
        if (name) recordName(name);
      }
      const npcCallRegex = /<Response[^>]+Call="([^"]+)"[^>]*>([^<]*)<\/Response>/g;
      let callMatch;
      while ((callMatch = npcCallRegex.exec(content)) !== null) {
        const call = (callMatch[1] ?? '').trim();
        if (call) npcResponseCalls[call] = (callMatch[2] ?? '').trim();
      }
      for (const [tag, label] of [
        ['Common', 'Common'],
        ['Merchant', 'Merchant'],
        ['MonsterSpeak', 'Monster'],
      ] as [string, string][]) {
        const sectionMatch = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`).exec(content);
        if (!sectionMatch) continue;
        const strRegex = /<String[^>]+Key="([^"]+)"[^>]*>([^<]*)<\/String>/g;
        let sm;
        while ((sm = strRegex.exec(sectionMatch[0])) !== null) {
          const key = (sm[1] ?? '').trim();
          const message = (sm[2] ?? '').trim();
          if (key && !npcStringKeys.some((s) => s.key === key && s.category === label)) {
            npcStringKeys.push({ key, message, category: label });
          }
        }
      }
    } else if (type === 'creatures') {
      const nameMatch = /\bName="([^"]+)"/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1].trim();
        if (name && !names.includes(name)) recordName(name);
      }
      const typeRegex = /<Type[^>]+Name="([^"]+)"/g;
      let tm;
      while ((tm = typeRegex.exec(content)) !== null) {
        const tn = (tm[1] ?? '').trim();
        if (tn && !creatureTypes.includes(tn)) creatureTypes.push(tn);
      }
    } else if (type === 'maps') {
      // Maps don't need namesByFilename — mapDetails already carries filename
      // per entry. Keep the names list sorted for the `index.maps` field.
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1].trim();
        if (name) {
          if (!names.includes(name)) names.push(name);
          const idMatch = /\bId="(\d+)"/.exec(content);
          const xMatch = /\bX="(\d+)"/.exec(content);
          const yMatch = /\bY="(\d+)"/.exec(content);
          if (idMatch?.[1] && xMatch?.[1] && yMatch?.[1]) {
            mapDetails.push({
              id: parseInt(idMatch[1], 10),
              name,
              filename: file.name,
              x: parseInt(xMatch[1], 10),
              y: parseInt(yMatch[1], 10),
            });
          }
        }
      }
    } else if (attrName) {
      const match = new RegExp(`\\b${attrName}="([^"]+)"`).exec(content);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name && !names.includes(name)) recordName(name);
        // Statuses encode formula references under meta.formulaNames per block
        // (onApply/onTick/onRemove × heal/damage). Extract and reverse-index.
        if (type === 'statuses' && name) {
          const meta = readCreidhneMeta(content);
          const fnByBlock = meta && typeof meta.formulaNames === 'object' ? meta.formulaNames as Record<string, unknown> : null;
          if (fnByBlock) {
            for (const block of ['onApply', 'onTick', 'onRemove']) {
              const fn = fnByBlock[block];
              if (fn && typeof fn === 'object') {
                const entries = fn as Record<string, unknown>;
                addReverseRef(formulaUsedByStatuses, entries.heal, name);
                addReverseRef(formulaUsedByStatuses, entries.damage, name);
              }
            }
          }
        }
      }
    } else if (type === 'npcs') {
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      if (nameMatch && nameMatch[1]) {
        const npcName = nameMatch[1].trim();
        if (npcName && !names.includes(npcName)) {
          recordName(npcName);
          const trainMatch = /<Train>([\s\S]*?)<\/Train>/.exec(content);
          if (trainMatch && trainMatch[1]) {
            const castableRegex = /<Castable[^>]+Name="([^"]+)"/g;
            let cm;
            while ((cm = castableRegex.exec(trainMatch[1])) !== null) {
              const key = (cm[1] ?? '').trim().toLowerCase();
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
              const key = (vm[1] ?? '').trim().toLowerCase();
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
        const name = nameMatch[1].trim();
        if (name && !names.includes(name)) recordName(name);
      }
    } else if (type === 'lootsets') {
      // lootsets is also caught by attrName above, but duplicate cross-ref wiring
      // here in case ATTR_NAME_MAP changes. itemLootSets collector is dead in
      // the existing Creidhne logic (attrName branch runs first); preserve
      // parity for now, flag for fix.
      const itemsBlockRegex = /<Items[^>]*>([\s\S]*?)<\/Items>/g;
      let ib;
      const lootSetName = namesByFilename[file.name] ?? '';
      if (lootSetName) {
        while ((ib = itemsBlockRegex.exec(content)) !== null) {
          const body = ib[1] ?? '';
          const itemRegex = /<Item[^>]*>([^<]+)<\/Item>/g;
          let im;
          while ((im = itemRegex.exec(body)) !== null) {
            const key = (im[1] ?? '').trim().toLowerCase();
            if (key) {
              if (!itemLootSets[key]) itemLootSets[key] = [];
              if (!itemLootSets[key].includes(lootSetName)) itemLootSets[key].push(lootSetName);
            }
          }
        }
      }
    } else {
      // nations, items, recipes — use all <Name> child elements; first one is
      // the file's identifier for namesByFilename, the rest may still be added
      // to the names array (e.g. nations have multiple named regions).
      const nameRegex = /<Name>([^<]+)<\/Name>/g;
      let match;
      let firstName: string | null = null;
      while ((match = nameRegex.exec(content)) !== null) {
        const name = (match[1] ?? '').trim();
        if (name && !names.includes(name)) names.push(name);
        if (name && firstName === null) firstName = name;
      }
      if (firstName) namesByFilename[file.name] = firstName;

      // Items: capture <Damage SmallMin/SmallMax/LargeMin/LargeMax/> attrs
      // when present (only weapons have it). Used by the damage calculator
      // to auto-populate weapon ranges from a referenced item.
      if (type === 'items' && firstName) {
        const dmgMatch = /<Damage\b([^>]*)\/>/.exec(content);
        if (dmgMatch && dmgMatch[1]) {
          const attrs = dmgMatch[1];
          const sMin = /\bSmallMin="(-?\d+(?:\.\d+)?)"/.exec(attrs);
          const sMax = /\bSmallMax="(-?\d+(?:\.\d+)?)"/.exec(attrs);
          const lMin = /\bLargeMin="(-?\d+(?:\.\d+)?)"/.exec(attrs);
          const lMax = /\bLargeMax="(-?\d+(?:\.\d+)?)"/.exec(attrs);
          if (sMin?.[1] && sMax?.[1] && lMin?.[1] && lMax?.[1]) {
            itemWeaponDamage[firstName] = {
              smallMin: Number(sMin[1]),
              smallMax: Number(sMax[1]),
              largeMin: Number(lMin[1]),
              largeMax: Number(lMax[1]),
            };
          }
        }
      }
    }

    scanned += 1;
    onProgress?.({ phase: 'scan', type, current: scanned, total: xmlEntries.length });
  }

  names.sort();

  // Archived scan
  const archRegex = ARCHIVED_NAME_REGEX[type];
  let archivedNames: string[] = [];
  if (archRegex) {
    const result = await readArchived(dirPath, archRegex);
    archivedNames = result.names;
    Object.assign(namesByFilename, result.namesByFilename);
  }

  // Build the field dict for this type's scan.
  const fields: Record<string, unknown> = {
    [type]: names,
    [namesByFilenameKey(type)]: namesByFilename,
  };
  if (archRegex) fields[archivedKey(type)] = archivedNames;

  if (type === 'castables') {
    fields.castableClasses = castableClasses;
    fields.statusCasters = statusCasters;
    fields.formulaUsedByCastables = formulaUsedByCastables;
    fields.castableRequiredLevels = castableRequiredLevels;
    // name → filename map (inverse of namesByFilename, kept for backward compat)
    const castableFilenames: Record<string, string> = {};
    for (const [fname, n] of Object.entries(namesByFilename)) {
      // Archived files also populate namesByFilename; keep castableFilenames
      // to active files only to match existing Creidhne semantics.
      if (!archivedNames.includes(n)) castableFilenames[n] = fname;
    }
    fields.castableFilenames = castableFilenames;
    Object.assign(fields, await scanCategoryContext(libraryPath, 'castables'));
  } else if (type === 'statuses') {
    fields.formulaUsedByStatuses = formulaUsedByStatuses;
    Object.assign(fields, await scanCategoryContext(libraryPath, 'statuses'));
  } else if (type === 'items') {
    Object.assign(fields, await scanCategoryContext(libraryPath, 'items'));
    fields.vendorTabs = await scanVendorTabs(libraryPath);
    fields.itemWeaponDamage = itemWeaponDamage;
  } else if (type === 'creatures') {
    fields.creatureTypes = creatureTypes.sort();
    fields.creatureFamilies = await scanFilenamePrefixes(libraryPath, 'creatures');
  } else if (type === 'npcs') {
    fields.castableTrainers = castableTrainers;
    fields.itemVendors = itemVendors;
    fields.npcJobs = await scanFilenamePrefixes(libraryPath, 'npcs', (p) => p.toLowerCase() !== 'npc');
  } else if (type === 'lootsets') {
    fields.itemLootSets = itemLootSets;
  } else if (type === 'localizations') {
    fields.npcResponseCalls = npcResponseCalls;
    fields.npcStringKeys = npcStringKeys;
  } else if (type === 'elementtables') {
    fields.elementnames = await scanElementNames(libraryPath);
  } else if (type === 'maps') {
    mapDetails.sort((a, b) => a.id - b.id);
    fields.mapDetails = mapDetails;
    fields.ignoredMapDetails = await scanIgnoredMapDetails(libraryPath);
  }

  return { type, fields };
}

// ── Supporting scans ────────────────────────────────────────────────────────

async function scanCategoryContext(
  libraryPath: string,
  type: 'castables' | 'items' | 'statuses',
): Promise<{ [key: string]: string[] | CategoryDetail[] }> {
  const dir = join(libraryPath, type);
  const details = await scanCategoryDetails(dir);
  const namesList = details.map((c) => c.name);
  if (type === 'castables') return { castableCategories: namesList, castableCategoryDetails: details };
  if (type === 'items') return { itemCategories: namesList, itemCategoryDetails: details };
  return { statusCategories: namesList, statusCategoryDetails: details };
}

async function scanCategoryDetails(dir: string): Promise<CategoryDetail[]> {
  const catMap: Record<string, { count: number; usedBy: string[] }> = {};
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const content = await fs.readFile(join(dir, entry.name), 'utf-8');
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content) || /\bName="([^"]+)"/.exec(content);
      const itemName = nameMatch && nameMatch[1] ? nameMatch[1].trim() : entry.name.replace(/\.xml$/i, '');
      const catSection = /<Categories[^>]*>([\s\S]*?)<\/Categories>/.exec(content);
      if (!catSection || !catSection[1]) continue;
      const body = catSection[1];
      const record = (c: string): void => {
        if (!c) return;
        if (!catMap[c]) catMap[c] = { count: 0, usedBy: [] };
        catMap[c].count++;
        if (catMap[c].usedBy.length < 5) catMap[c].usedBy.push(itemName);
      };
      const catElemRegex = /<Category\b[^>]*>([^<]+)<\/Category>/g;
      const catAttrRegex = /<Category\b[^>]*\bName="([^"]+)"/g;
      let m;
      while ((m = catElemRegex.exec(body)) !== null) record((m[1] ?? '').trim());
      while ((m = catAttrRegex.exec(body)) !== null) record((m[1] ?? '').trim());
    }
  } catch { /* dir may not exist */ }
  return Object.entries(catMap)
    .map(([name, { count, usedBy }]) => ({ name, count, usedBy: count < 5 ? usedBy : [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function scanVendorTabs(libraryPath: string): Promise<string[]> {
  const tabs = new Set<string>();
  try {
    const itemsDir = join(libraryPath, 'items');
    const entries = await fs.readdir(itemsDir, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const content = await fs.readFile(join(itemsDir, entry.name), 'utf-8');
      const shopTabRegex = /\bShopTab="([^"]+)"/g;
      let m;
      while ((m = shopTabRegex.exec(content)) !== null) {
        const v = (m[1] ?? '').trim();
        if (v) tabs.add(v);
      }
    }
  } catch { /* dir may not exist */ }
  return [...tabs].sort();
}

async function scanFilenamePrefixes(
  libraryPath: string,
  type: 'npcs' | 'creatures',
  filter: (prefix: string) => boolean = () => true,
): Promise<string[]> {
  const prefixes = new Set<string>();
  try {
    const dir = join(libraryPath, type);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const namePart = entry.name.replace(/\.xml$/i, '');
      const idx = namePart.indexOf('_');
      if (idx > 0) {
        const prefix = namePart.slice(0, idx);
        if (prefix && filter(prefix)) prefixes.add(prefix);
      }
    }
  } catch { /* dir may not exist */ }
  return [...prefixes].sort();
}

async function scanElementNames(libraryPath: string): Promise<string[]> {
  const set = new Set<string>();
  try {
    const etDir = join(libraryPath, 'elementtables');
    const entries = await fs.readdir(etDir, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const content = await fs.readFile(join(etDir, entry.name), 'utf-8');
      const elemRegex = /<Source[^>]+Element="([^"]+)"/g;
      let m;
      while ((m = elemRegex.exec(content)) !== null) {
        const v = (m[1] ?? '').trim();
        if (v) set.add(v);
      }
    }
  } catch { /* dir may not exist */ }
  return [...set].sort();
}

async function scanIgnoredMapDetails(libraryPath: string): Promise<MapDetail[]> {
  const list: MapDetail[] = [];
  try {
    const dir = join(libraryPath, 'maps', '.ignore');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const file of entries.filter((e) => e.isFile() && e.name.endsWith('.xml'))) {
      const content = await fs.readFile(join(dir, file.name), 'utf-8');
      const nameMatch = /<Name>([^<]+)<\/Name>/.exec(content);
      const idMatch = /\bId="(\d+)"/.exec(content);
      const xMatch = /\bX="(\d+)"/.exec(content);
      const yMatch = /\bY="(\d+)"/.exec(content);
      if (idMatch?.[1] && xMatch?.[1] && yMatch?.[1]) {
        list.push({
          id: parseInt(idMatch[1], 10),
          name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : '',
          filename: file.name,
          x: parseInt(xMatch[1], 10),
          y: parseInt(yMatch[1], 10),
        });
      }
    }
  } catch { /* .ignore may not exist */ }
  list.sort((a, b) => a.id - b.id);
  return list;
}

/** Global scans that are not tied to a specific INDEX_TYPE scan. */
async function scanScriptsAndCookies(libraryPath: string): Promise<{
  scripts: string[];
  cookieNames: string[];
}> {
  const scriptsDir = join(libraryPath, '..', 'scripts');
  const scripts = (await walkDir(scriptsDir, '.lua', scriptsDir)).sort();

  const cookies = new Set<string>();
  const cookieRegex = /\w+\.setcookie\s*\(\s*"([^"]+)"/gi;
  const scan = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await scan(full);
        else if (entry.isFile() && entry.name.endsWith('.lua')) {
          const content = await fs.readFile(full, 'utf-8');
          cookieRegex.lastIndex = 0;
          let m;
          while ((m = cookieRegex.exec(content)) !== null) {
            if (m[1]) cookies.add(m[1]);
          }
        }
      }
    } catch { /* dir may not exist */ }
  };
  await scan(scriptsDir);
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
    archivedElementtables: [], archivedItems: [], archivedLootsets: [], archivedNations: [],
    archivedNpcs: [], archivedRecipes: [], archivedSpawngroups: [], archivedStatuses: [],
    archivedVariantgroups: [],
    castablesNamesByFilename: {}, statusesNamesByFilename: {}, itemsNamesByFilename: {},
    creaturesNamesByFilename: {}, npcsNamesByFilename: {}, nationsNamesByFilename: {},
    lootsetsNamesByFilename: {}, recipesNamesByFilename: {}, variantgroupsNamesByFilename: {},
    localizationsNamesByFilename: {}, elementtablesNamesByFilename: {},
    creaturebehaviorsetsNamesByFilename: {}, spawngroupsNamesByFilename: {},
    serverconfigsNamesByFilename: {}, worldmapsNamesByFilename: {},
    castableFilenames: {}, castableClasses: {}, statusCasters: {},
    castableTrainers: {}, itemVendors: {}, itemLootSets: {},
    formulaUsedByCastables: {}, formulaUsedByStatuses: {},
    castableRequiredLevels: {}, itemWeaponDamage: {},
    npcResponseCalls: {}, npcStringKeys: [],
    creatureTypes: [], elementnames: [], scripts: [], cookieNames: [],
    vendorTabs: [], npcJobs: [], creatureFamilies: [],
    itemCategories: [], castableCategories: [], statusCategories: [],
    itemCategoryDetails: [], castableCategoryDetails: [], statusCategoryDetails: [],
    mapDetails: [], ignoredMapDetails: [],
  };
}

/** Build the complete world index by scanning every type. */
export async function buildIndex(
  libraryPath: string,
  options: BuildOptions = {},
): Promise<WorldIndex> {
  const { onProgress } = options;
  const index = emptyWorldIndex(libraryPath);

  for (const type of INDEX_TYPES) {
    const { fields } = await buildSection(libraryPath, type, options);
    Object.assign(index as unknown as Record<string, unknown>, fields);
  }

  onProgress?.({ phase: 'cross-ref' });
  const { scripts, cookieNames } = await scanScriptsAndCookies(libraryPath);
  index.scripts = scripts;
  index.cookieNames = cookieNames;

  onProgress?.({ phase: 'done' });
  return index;
}
