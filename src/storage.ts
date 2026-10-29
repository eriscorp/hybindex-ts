import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { IndexType, WorldIndex } from './types.js';
import { INDEX_TYPES } from './types.js';
import {
  SCHEMA_VERSION,
  getIndexDir,
  getIndexFilePath,
  getInWorldIndexFilePath,
  getLegacyCacheBase,
  getLegacyIndexPath,
  resolveCacheBase,
} from './paths.js';
import {
  computeFileCache,
  fileCacheEqual,
  loadFileCache,
  sectionSignature,
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
  castablesDuplicateNames: 'castables',
  castableFilenames: 'castables',
  castableClasses: 'castables',
  castableIcons: 'castables',
  castableBooks: 'castables',
  statusCasters: 'castables',
  castableCategories: 'castables',
  castableCategoryDetails: 'castables',
  castableCategoryMembers: 'castables',
  formulaUsedByCastables: 'castables',
  castableRequiredLevels: 'castables',

  // statuses
  statuses: 'statuses',
  archivedStatuses: 'statuses',
  statusesNamesByFilename: 'statuses',
  statusesDuplicateNames: 'statuses',
  statusCategories: 'statuses',
  statusCategoryDetails: 'statuses',
  formulaUsedByStatuses: 'statuses',

  // items
  items: 'items',
  archivedItems: 'items',
  itemsNamesByFilename: 'items',
  itemsDuplicateNames: 'items',
  itemCategories: 'items',
  itemCategoryDetails: 'items',
  vendorTabs: 'items',
  itemWeaponDamage: 'items',

  // creatures
  creatures: 'creatures',
  archivedCreatures: 'creatures',
  creaturesNamesByFilename: 'creatures',
  creaturesDuplicateNames: 'creatures',
  creatureTypes: 'creatures',
  creatureFamilies: 'creatures',

  // npcs
  npcs: 'npcs',
  archivedNpcs: 'npcs',
  npcsNamesByFilename: 'npcs',
  npcsDuplicateNames: 'npcs',
  npcJobs: 'npcs',
  castableTrainers: 'npcs',
  itemVendors: 'npcs',

  // nations
  nations: 'nations',
  archivedNations: 'nations',
  nationsNamesByFilename: 'nations',
  nationsDuplicateNames: 'nations',

  // lootsets
  lootsets: 'lootsets',
  archivedLootsets: 'lootsets',
  lootsetsNamesByFilename: 'lootsets',
  lootsetsDuplicateNames: 'lootsets',
  itemLootSets: 'lootsets',

  // recipes
  recipes: 'recipes',
  archivedRecipes: 'recipes',
  recipesNamesByFilename: 'recipes',
  recipesDuplicateNames: 'recipes',

  // variantgroups
  variantgroups: 'variantgroups',
  archivedVariantgroups: 'variantgroups',
  variantgroupsNamesByFilename: 'variantgroups',
  variantgroupsDuplicateNames: 'variantgroups',

  // localizations
  localizations: 'localizations',
  archivedLocalizations: 'localizations',
  localizationsNamesByFilename: 'localizations',
  localizationsDuplicateNames: 'localizations',
  npcResponseCalls: 'localizations',
  npcStringKeys: 'localizations',

  // elementtables
  elementtables: 'elementtables',
  archivedElementtables: 'elementtables',
  elementtablesNamesByFilename: 'elementtables',
  elementtablesDuplicateNames: 'elementtables',
  elementnames: 'elementtables',
  elementTables: 'elementtables',

  // creaturebehaviorsets
  creaturebehaviorsets: 'creaturebehaviorsets',
  archivedCreaturebehaviorsets: 'creaturebehaviorsets',
  creaturebehaviorsetsNamesByFilename: 'creaturebehaviorsets',
  creaturebehaviorsetsDuplicateNames: 'creaturebehaviorsets',

  // spawngroups
  spawngroups: 'spawngroups',
  archivedSpawngroups: 'spawngroups',
  spawngroupsNamesByFilename: 'spawngroups',
  spawngroupsDuplicateNames: 'spawngroups',

  // serverconfigs
  serverconfigs: 'serverconfigs',
  archivedServerconfigs: 'serverconfigs',
  serverconfigsNamesByFilename: 'serverconfigs',
  serverconfigsDuplicateNames: 'serverconfigs',
  serverconfigElementTables: 'serverconfigs',

  // traits
  traits: 'traits',
  archivedTraits: 'traits',
  traitsNamesByFilename: 'traits',
  traitsDuplicateNames: 'traits',
  traitCategories: 'traits',
  traitExclusiveGroups: 'traits',

  // species
  species: 'species',
  archivedSpecies: 'species',
  speciesNamesByFilename: 'species',
  speciesDuplicateNames: 'species',
  speciesDetails: 'species',
  speciesBodyIds: 'species',

  // maps
  maps: 'maps',
  mapsDuplicateNames: 'maps',
  mapDetails: 'maps',
  ignoredMapDetails: 'maps',

  // worldmaps
  worldmaps: 'worldmaps',
  worldmapsNamesByFilename: 'worldmaps',
  worldmapsDuplicateNames: 'worldmaps',

  // _meta (catch-all)
  libraryPath: '_meta',
  builtAt: '_meta',
  scripts: '_meta',
  cookieNames: '_meta',
};

/** All unique file names in the per-type layout, including `_meta`. */
const INDEX_FILES: readonly string[] = ['_meta', ...INDEX_TYPES];

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

// ── Previous cache base migration (Linux 1.1.0, macOS 1.2.0) ─────────────────

/**
 * Move the previous cache base (`getLegacyCacheBase`) to the current one:
 *
 * - Linux: the pre-1.1.0 lowercase vendor directory to the capitalized spelling
 *   the rest of the house uses: `~/.config/erisco/hybindex` →
 *   `~/.config/Erisco/hybindex`.
 * - macOS: the pre-1.2.0 base to the base the other Erisco tools use:
 *   `~/.config/Erisco/hybindex` → `~/Library/Application Support/Erisco/hybindex`.
 *   The moved tree holds only old schema versions, which `pruneIndexCaches`
 *   removes.
 *
 * Windows never moves anything: it never used another base.
 *
 * Skips when the current base already exists, which is also the state during
 * the window where one consumer has upgraded and the other has not: both
 * directories stand, and each app reads its own. `pruneIndexCaches` removes
 * the old schema versions from both bases.
 *
 * Best effort and idempotent. The index is a rebuildable cache, so a failed
 * rename costs a rebuild and nothing else. Called automatically wherever this
 * package creates its cache directory; exported so an app can also run it once
 * at startup.
 */
export async function migrateLegacyCacheBase(): Promise<void> {
  const legacy = getLegacyCacheBase();
  if (legacy === null) return;
  const current = resolveCacheBase();
  if (legacy === current) return;
  try {
    await fs.stat(legacy);
  } catch {
    return; // nothing to move
  }
  try {
    await fs.stat(current);
    return; // destination in use — leave both alone
  } catch { /* absent, so the rename is unambiguous */ }
  try {
    await fs.mkdir(dirname(current), { recursive: true });
    await fs.rename(legacy, current);
    // Drop the now-empty old vendor directory. rmdir refuses a non-empty one,
    // so anything else that lives there is safe.
    await fs.rmdir(dirname(legacy)).catch(() => { /* not empty, or gone */ });
  } catch { /* best effort */ }
}

/** Create this library's cache directory, migrating the vendor dir case first. */
async function ensureIndexDir(libraryPath: string): Promise<void> {
  await migrateLegacyCacheBase();
  await fs.mkdir(getIndexDir(libraryPath), { recursive: true });
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
  await ensureIndexDir(libraryPath);
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
  await ensureIndexDir(libraryPath);
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
  prior[type] = await sectionSignature(libraryPath, type);
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
  await ensureIndexDir(libraryPath);
}
