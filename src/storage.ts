import { promises as fs } from 'fs';
import type { IndexType, WorldIndex } from './types.js';
import { INDEX_TYPES } from './types.js';
import { getCreidhneDir, getIndexFilePath, getLegacyIndexPath } from './paths.js';

const SCHEMA_VERSION = 1;

/**
 * Which per-type file owns each WorldIndex field. Fields not in this map live
 * in `_meta.json`. Populators are documented inline.
 *
 * Keep in sync with `buildSection` output in builder.ts.
 */
const FIELD_TO_FILE: Record<string, string> = {
  // castables
  castables: 'castables',
  archivedCastables: 'castables',
  castablesNamesByFilename: 'castables',
  castableFilenames: 'castables',
  castableClasses: 'castables',
  statusCasters: 'castables',
  castableCategories: 'castables',
  castableCategoryDetails: 'castables',
  formulaUsedByCastables: 'castables',

  // statuses
  statuses: 'statuses',
  archivedStatuses: 'statuses',
  statusesNamesByFilename: 'statuses',
  statusCategories: 'statuses',
  statusCategoryDetails: 'statuses',
  formulaUsedByStatuses: 'statuses',

  // items
  items: 'items',
  archivedItems: 'items',
  itemsNamesByFilename: 'items',
  itemCategories: 'items',
  itemCategoryDetails: 'items',
  vendorTabs: 'items',

  // creatures
  creatures: 'creatures',
  archivedCreatures: 'creatures',
  creaturesNamesByFilename: 'creatures',
  creatureTypes: 'creatures',
  creatureFamilies: 'creatures',

  // npcs
  npcs: 'npcs',
  archivedNpcs: 'npcs',
  npcsNamesByFilename: 'npcs',
  npcJobs: 'npcs',
  castableTrainers: 'npcs',
  itemVendors: 'npcs',

  // nations
  nations: 'nations',
  archivedNations: 'nations',
  nationsNamesByFilename: 'nations',

  // lootsets
  lootsets: 'lootsets',
  archivedLootsets: 'lootsets',
  lootsetsNamesByFilename: 'lootsets',
  itemLootSets: 'lootsets',

  // recipes
  recipes: 'recipes',
  archivedRecipes: 'recipes',
  recipesNamesByFilename: 'recipes',

  // variantgroups
  variantgroups: 'variantgroups',
  archivedVariantgroups: 'variantgroups',
  variantgroupsNamesByFilename: 'variantgroups',

  // localizations
  localizations: 'localizations',
  localizationsNamesByFilename: 'localizations',
  npcResponseCalls: 'localizations',
  npcStringKeys: 'localizations',

  // elementtables
  elementtables: 'elementtables',
  archivedElementtables: 'elementtables',
  elementtablesNamesByFilename: 'elementtables',
  elementnames: 'elementtables',

  // creaturebehaviorsets
  creaturebehaviorsets: 'creaturebehaviorsets',
  archivedCreaturebehaviorsets: 'creaturebehaviorsets',
  creaturebehaviorsetsNamesByFilename: 'creaturebehaviorsets',

  // spawngroups
  spawngroups: 'spawngroups',
  archivedSpawngroups: 'spawngroups',
  spawngroupsNamesByFilename: 'spawngroups',

  // serverconfigs
  serverconfigs: 'serverconfigs',
  serverconfigsNamesByFilename: 'serverconfigs',

  // maps
  maps: 'maps',
  mapDetails: 'maps',
  ignoredMapDetails: 'maps',

  // worldmaps
  worldmaps: 'worldmaps',
  worldmapsNamesByFilename: 'worldmaps',

  // _meta (catch-all)
  libraryPath: '_meta',
  builtAt: '_meta',
  scripts: '_meta',
  cookieNames: '_meta',
};

/** All unique file names in the per-type layout, including `_meta`. */
const INDEX_FILES: readonly string[] = [
  '_meta',
  ...INDEX_TYPES.filter((t) => t !== 'serverconfigs' && t !== 'worldmaps'),
  'serverconfigs',
  'worldmaps',
];

/** Group fields by their owning file. */
function splitByFile(index: WorldIndex): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(index)) {
    const file = FIELD_TO_FILE[key] ?? '_meta';
    if (!groups[file]) groups[file] = {};
    groups[file][key] = (index as unknown as Record<string, unknown>)[key];
  }
  // Ensure _meta carries the schema version.
  if (!groups._meta) groups._meta = {};
  groups._meta.version = SCHEMA_VERSION;
  return groups;
}

// ── Atomic write ────────────────────────────────────────────────────────────

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeAtomic(filePath, JSON.stringify(data, null, 2));
}

// ── Legacy migration ────────────────────────────────────────────────────────

async function readLegacyIndex(libraryPath: string): Promise<WorldIndex | null> {
  try {
    const raw = await fs.readFile(getLegacyIndexPath(libraryPath), 'utf-8');
    return JSON.parse(raw) as WorldIndex;
  } catch {
    return null;
  }
}

async function deleteLegacyIndex(libraryPath: string): Promise<void> {
  try {
    await fs.unlink(getLegacyIndexPath(libraryPath));
  } catch { /* already gone */ }
}

/**
 * Migrate a legacy `index.json` into the per-type layout and delete the
 * legacy file. Idempotent: if the new layout already exists with fresh data,
 * no migration happens. Returns the migrated index, or null if no legacy
 * index existed.
 */
async function migrateLegacyIfNeeded(libraryPath: string): Promise<WorldIndex | null> {
  // Skip migration if the new layout already has a _meta.json
  const metaPath = getIndexFilePath(libraryPath, '_meta');
  try {
    await fs.access(metaPath);
    // New layout exists. If legacy still sits beside it, remove it.
    await deleteLegacyIndex(libraryPath);
    return null;
  } catch { /* fall through */ }

  const legacy = await readLegacyIndex(libraryPath);
  if (!legacy) return null;

  await saveIndex(libraryPath, legacy);
  await deleteLegacyIndex(libraryPath);
  return legacy;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the world index. If a legacy `index.json` is present and no per-type
 * layout exists yet, migrates silently and deletes the legacy file.
 * Returns null when neither layout exists.
 */
export async function loadIndex(libraryPath: string): Promise<WorldIndex | null> {
  const migrated = await migrateLegacyIfNeeded(libraryPath);
  if (migrated) return migrated;

  // Read each file in the new layout, merge.
  const merged: Record<string, unknown> = {};
  let anyFound = false;
  for (const fileName of INDEX_FILES) {
    try {
      const raw = await fs.readFile(getIndexFilePath(libraryPath, fileName), 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const key of Object.keys(data)) {
        if (key === 'version') continue; // internal only
        merged[key] = data[key];
      }
      anyFound = true;
    } catch { /* file may not exist — that's OK */ }
  }
  return anyFound ? (merged as unknown as WorldIndex) : null;
}

/** Save the full world index, splitting by field-to-file mapping. */
export async function saveIndex(libraryPath: string, index: WorldIndex): Promise<void> {
  await fs.mkdir(getCreidhneDir(libraryPath), { recursive: true });
  const groups = splitByFile(index);
  for (const [fileName, data] of Object.entries(groups)) {
    await writeJson(getIndexFilePath(libraryPath, fileName), data);
  }
}

/**
 * Save only the fields owned by a specific section (type's file), plus bump
 * the `_meta.json` builtAt timestamp. Used by partial re-index triggered from
 * a single-file save in the editor.
 *
 * Input is the subset of WorldIndex fields produced by `buildSection` for this
 * type (and the aggregate fields that section owns — e.g. vendorTabs when
 * type='items').
 */
export async function saveSection(
  libraryPath: string,
  type: IndexType,
  fields: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(getCreidhneDir(libraryPath), { recursive: true });
  // Group the fields by owning file — a single section may touch more than
  // its own file (e.g. items owns items.json fields plus vendorTabs there).
  // Since FIELD_TO_FILE encodes the ownership, reuse it.
  const groups: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(fields)) {
    const file = FIELD_TO_FILE[key] ?? type;
    if (!groups[file]) groups[file] = {};
    groups[file][key] = value;
  }

  for (const [fileName, newData] of Object.entries(groups)) {
    // Merge with existing file so we don't clobber unrelated fields in the
    // same file (unlikely given 1:1 type-to-file, but defensive).
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(getIndexFilePath(libraryPath, fileName), 'utf-8');
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* no prior file */ }
    await writeJson(getIndexFilePath(libraryPath, fileName), { ...existing, ...newData });
  }

  // Bump _meta.builtAt
  const metaPath = getIndexFilePath(libraryPath, '_meta');
  let meta: Record<string, unknown> = { version: SCHEMA_VERSION, libraryPath };
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* no prior meta */ }
  meta.builtAt = new Date().toISOString();
  await writeJson(metaPath, meta);
}

/**
 * Remove all index files (legacy + new layout). Leaves other `.creidhne/`
 * files (constants.json, formulas.json) alone — only files owned by this
 * package are deleted.
 */
export async function deleteIndex(libraryPath: string): Promise<void> {
  await deleteLegacyIndex(libraryPath);
  await Promise.all(
    INDEX_FILES.map((name) =>
      fs.unlink(getIndexFilePath(libraryPath, name)).catch(() => { /* ignore */ }),
    ),
  );
}

/** Report whether any index data exists for this library. */
export async function getIndexStatus(
  libraryPath: string,
): Promise<{ exists: boolean; builtAt?: string }> {
  // Try new layout first
  try {
    const raw = await fs.readFile(getIndexFilePath(libraryPath, '_meta'), 'utf-8');
    const parsed = JSON.parse(raw) as { builtAt?: string };
    return { exists: true, ...(parsed.builtAt ? { builtAt: parsed.builtAt } : {}) };
  } catch { /* try legacy */ }
  try {
    const raw = await fs.readFile(getLegacyIndexPath(libraryPath), 'utf-8');
    const parsed = JSON.parse(raw) as { builtAt?: string };
    return { exists: true, ...(parsed.builtAt ? { builtAt: parsed.builtAt } : {}) };
  } catch { /* no index */ }
  return { exists: false };
}

/** Ensure the .creidhne directory exists (callers rarely need this directly). */
export async function ensureCreidhneDir(libraryPath: string): Promise<void> {
  await fs.mkdir(getCreidhneDir(libraryPath), { recursive: true });
}
