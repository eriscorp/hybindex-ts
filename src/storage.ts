import { promises as fs } from 'fs';
import type { IndexType, WorldIndex } from './types.js';
import { INDEX_TYPES } from './types.js';
import {
  SCHEMA_VERSION,
  getIndexDir,
  getIndexFilePath,
  getInWorldIndexFilePath,
  getLegacyIndexPath,
} from './paths.js';
import {
  computeFileCache,
  fileCacheEqual,
  loadFileCache,
  writeFileCache,
  type FileCache,
} from './filecache.js';

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
  castableRequiredLevels: 'castables',

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
  itemWeaponDamage: 'items',

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
  archivedLocalizations: 'localizations',
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
  archivedServerconfigs: 'serverconfigs',
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

/** Keys not part of the persisted index (computed scaffolding). */
const NON_PERSISTED_KEYS = new Set(['__fileCache']);

/** WorldIndex field keys owned by a given type's per-type file. */
export function fieldsForType(type: IndexType): string[] {
  return Object.keys(FIELD_TO_FILE).filter((key) => FIELD_TO_FILE[key] === type);
}

/** Group fields by their owning file. */
function splitByFile(index: WorldIndex): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(index)) {
    if (NON_PERSISTED_KEYS.has(key)) continue;
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

// ── In-world cleanup (pre-0.3.0 → 0.3.0 relocation) ──────────────────────────

/**
 * Best-effort removal of the stale pre-0.3.0 index that lived in the git-tracked
 * `world/.creidhne/`. Deletes only files this package owns — the legacy single
 * `index.json`, every per-type `*.json`, `_meta.json`, and any `_filecache.json`
 * — leaving authoritative `constants.json` / `formulas.json` untouched. Idempotent.
 */
export async function cleanupInWorldIndex(libraryPath: string): Promise<void> {
  const names = [...INDEX_FILES, '_filecache'];
  await Promise.all([
    fs.unlink(getLegacyIndexPath(libraryPath)).catch(() => { /* gone */ }),
    ...names.map((name) =>
      fs.unlink(getInWorldIndexFilePath(libraryPath, name)).catch(() => { /* gone */ }),
    ),
  ]);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the world index from the local cache. Returns null when no cache exists
 * (e.g. a fresh clone, or first run after the 0.3.0 relocation) — callers
 * (re)build in that case. The index is derived and rebuildable, so there is no
 * migration of the old in-world copy: it is cleaned up on the next save.
 */
export async function loadIndex(libraryPath: string): Promise<WorldIndex | null> {
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

/**
 * Save the full world index to the local cache, splitting by field-to-file
 * mapping. Also persists the `_filecache.json` build signature (for incremental
 * rebuilds) and clears any stale pre-0.3.0 index from the world folder.
 */
export async function saveIndex(libraryPath: string, index: WorldIndex): Promise<void> {
  await fs.mkdir(getIndexDir(libraryPath), { recursive: true });
  const groups = splitByFile(index);
  for (const [fileName, data] of Object.entries(groups)) {
    await writeJson(getIndexFilePath(libraryPath, fileName), data);
  }
  // Persist the build signature — prefer the one computed during buildIndex,
  // else compute fresh so the cache reflects on-disk state at save time.
  const fileCache =
    ((index as unknown as Record<string, unknown>).__fileCache as FileCache | undefined) ??
    (await computeFileCache(libraryPath));
  await writeFileCache(libraryPath, fileCache);
  // Index has moved out of the git world folder — remove the old copy.
  await cleanupInWorldIndex(libraryPath);
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
  await fs.mkdir(getIndexDir(libraryPath), { recursive: true });
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

  // Refresh the build signature for just this section so a subsequent
  // buildIndex sees it as up to date. Other sections keep their prior entries.
  const prior = (await loadFileCache(libraryPath)) ?? {};
  const fresh = await computeFileCache(libraryPath);
  const sig = fresh[type];
  if (sig) prior[type] = sig;
  await writeFileCache(libraryPath, prior);
}

/**
 * Remove all index files from the local cache (and any stale in-world copy).
 * Authoritative constants.json / formulas.json in the world folder are untouched.
 */
export async function deleteIndex(libraryPath: string): Promise<void> {
  await Promise.all([
    ...INDEX_FILES.map((name) =>
      fs.unlink(getIndexFilePath(libraryPath, name)).catch(() => { /* ignore */ }),
    ),
    fs.unlink(getIndexFilePath(libraryPath, '_filecache')).catch(() => { /* ignore */ }),
  ]);
  await cleanupInWorldIndex(libraryPath);
}

/**
 * Report whether a cached index exists and whether it is stale (the world's
 * files no longer match the build signature). `stale` drives auto-rebuild on
 * load. A missing cache reports `exists: false` (callers treat that as "build").
 */
export async function getIndexStatus(
  libraryPath: string,
): Promise<{ exists: boolean; builtAt?: string; stale?: boolean }> {
  let builtAt: string | undefined;
  try {
    const raw = await fs.readFile(getIndexFilePath(libraryPath, '_meta'), 'utf-8');
    const parsed = JSON.parse(raw) as { builtAt?: string };
    builtAt = parsed.builtAt;
  } catch {
    return { exists: false };
  }
  const prior = await loadFileCache(libraryPath);
  const current = await computeFileCache(libraryPath);
  const stale = !fileCacheEqual(prior, current);
  return { exists: true, stale, ...(builtAt ? { builtAt } : {}) };
}

/** Ensure the local cache directory for this library exists. */
export async function ensureCreidhneDir(libraryPath: string): Promise<void> {
  await fs.mkdir(getIndexDir(libraryPath), { recursive: true });
}
