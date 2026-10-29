/**
 * Core types for the Hybrasyl world index.
 *
 * `WorldIndex` is the full merged shape consumed by Creidhne + Taliesin.
 * On disk the data is split into per-type files (see storage.ts) but callers
 * always receive a single merged object.
 */

/** Every scannable type, ordered to match the on-disk directory names. */
export const INDEX_TYPES = [
  'castables',
  'creatures',
  'creaturebehaviorsets',
  'elementtables',
  'items',
  'localizations',
  'lootsets',
  'maps',
  'nations',
  'npcs',
  'recipes',
  'serverconfigs',
  'spawngroups',
  'species',
  'statuses',
  'traits',
  'variantgroups',
  'worldmaps',
] as const;

export type IndexType = (typeof INDEX_TYPES)[number];

export interface MapDetail {
  id: number;
  name: string;
  /** Path relative to `maps/`, forward-slashed. `.ignore/`-prefixed when archived. */
  filename: string;
  x: number;
  y: number;
}

export interface CategoryDetail {
  name: string;
  count: number;
  usedBy: string[];
}

export interface NpcStringKey {
  key: string;
  message: string;
  category: string;
}

/**
 * The element structure of one element table (HXML-24).
 *
 * A table in the HXML-24 format has an `<Elements>` block. A table in the old
 * format has no `<Elements>` block: its elements are the `Element` values of its
 * `<Source>` rows, it has no groups, and it has no default element.
 */
export interface ElementTableIndex {
  /** The `Key` of each `<Element>`, in file order. Old format: the `<Source>` row elements. */
  elements: string[];
  /**
   * Each `<Group Key>` and its `Members`, in file order. A member can occur
   * more than one time: each occurrence is one chance in a random pick.
   */
  groups: Record<string, string[]>;
  /** The key of the element with `Default="true"`, or null when no element has it. */
  defaultElement: string | null;
}

/** One `<Body>` of a species. */
export interface SpeciesBodyDetail {
  key: string;
  /** The body `Id`, or null when it is missing or is not a number. */
  id: number | null;
  default: boolean;
}

/** The root attributes and the bodies of one species (HXML-37). */
export interface SpeciesDetail {
  /** The species `Id`, or null when it is missing or is not a number. */
  id: number | null;
  /** The key of the parent species, or null for a species that is not a branch. */
  branchOf: string | null;
  /** `Locked`, `Starter`, `Unlockable` or `ByBranch`, as written. Null when it is missing. */
  playerOption: string | null;
  bodies: SpeciesBodyDetail[];
}

/** One body that claims a body `Id`. */
export interface SpeciesBodyClaim {
  species: string;
  body: string;
  /** The type-relative path of the species file. */
  filename: string;
}

/**
 * One type's name collisions: collision key → every active, type-relative
 * filename claiming that name. A name claimed once is absent, so an empty
 * object means the type is clean.
 *
 * The key is `nameCollisionKey(name)`, Unicode-normalized and lowercased. It
 * matches the server's map key and approximates the others (see its docs).
 * Probe it with the same function rather than with the raw name.
 *
 * Archived (`.ignore/`) files never appear here: the server does not load them,
 * so an archived copy of a live file is not a collision.
 */
export type DuplicateNames = Record<string, string[]>;

/**
 * Full merged world index. On disk this is split into per-type JSON files
 * plus a `_meta.json`; consumers always see the merged shape.
 *
 * Field grouping (which per-type file a field lives in) is defined by
 * `FIELD_TO_FILE` in storage.ts — keep these in sync when adding fields.
 */
export interface WorldIndex {
  // Meta
  libraryPath: string;
  builtAt: string;

  // Entity name lists (sorted)
  castables: string[];
  creatures: string[];
  creaturebehaviorsets: string[];
  elementtables: string[];
  items: string[];
  localizations: string[];
  lootsets: string[];
  maps: string[];
  nations: string[];
  npcs: string[];
  recipes: string[];
  serverconfigs: string[];
  spawngroups: string[];
  species: string[];
  statuses: string[];
  traits: string[];
  variantgroups: string[];
  worldmaps: string[];

  // Archived name lists
  archivedCastables: string[];
  archivedCreatures: string[];
  archivedCreaturebehaviorsets: string[];
  archivedElementtables: string[];
  archivedItems: string[];
  archivedLocalizations: string[];
  archivedLootsets: string[];
  archivedNations: string[];
  archivedNpcs: string[];
  archivedRecipes: string[];
  archivedServerconfigs: string[];
  archivedSpawngroups: string[];
  archivedSpecies: string[];
  archivedStatuses: string[];
  archivedTraits: string[];
  archivedVariantgroups: string[];

  // Filename → display name maps (filter by Name in editor file lists).
  //
  // Keys are paths RELATIVE TO THE TYPE DIRECTORY, forward-slashed: `blast.xml`
  // for a file at the top level, `fire/blast.xml` in a subdirectory, and
  // `.ignore/old.xml` for an archived one. Archived entries share these maps
  // with active ones; the `.ignore/` prefix is what distinguishes them (see
  // `isArchivedPath`), and it is why the two can no longer collide on basename.
  castablesNamesByFilename: Record<string, string>;
  statusesNamesByFilename: Record<string, string>;
  itemsNamesByFilename: Record<string, string>;
  creaturesNamesByFilename: Record<string, string>;
  npcsNamesByFilename: Record<string, string>;
  nationsNamesByFilename: Record<string, string>;
  lootsetsNamesByFilename: Record<string, string>;
  recipesNamesByFilename: Record<string, string>;
  variantgroupsNamesByFilename: Record<string, string>;
  localizationsNamesByFilename: Record<string, string>;
  elementtablesNamesByFilename: Record<string, string>;
  creaturebehaviorsetsNamesByFilename: Record<string, string>;
  spawngroupsNamesByFilename: Record<string, string>;
  serverconfigsNamesByFilename: Record<string, string>;
  worldmapsNamesByFilename: Record<string, string>;
  traitsNamesByFilename: Record<string, string>;
  speciesNamesByFilename: Record<string, string>; // species Key, not a name

  // Name collisions, per type, grouped by `nameCollisionKey`. A reported pair
  // may leave one file unreachable by name; see that function for where the
  // server's keys differ. Reported as data, never thrown: a world
  // with a collision must still open. Use
  // `duplicateNamesFor(index, type)` when the type is a variable.
  castablesDuplicateNames: DuplicateNames;
  creaturesDuplicateNames: DuplicateNames;
  creaturebehaviorsetsDuplicateNames: DuplicateNames;
  elementtablesDuplicateNames: DuplicateNames;
  itemsDuplicateNames: DuplicateNames;
  localizationsDuplicateNames: DuplicateNames;
  lootsetsDuplicateNames: DuplicateNames;
  mapsDuplicateNames: DuplicateNames;
  nationsDuplicateNames: DuplicateNames;
  npcsDuplicateNames: DuplicateNames;
  recipesDuplicateNames: DuplicateNames;
  serverconfigsDuplicateNames: DuplicateNames;
  spawngroupsDuplicateNames: DuplicateNames;
  speciesDuplicateNames: DuplicateNames;
  statusesDuplicateNames: DuplicateNames;
  traitsDuplicateNames: DuplicateNames;
  variantgroupsDuplicateNames: DuplicateNames;
  worldmapsDuplicateNames: DuplicateNames;

  // Castable-specific cross-references
  castableFilenames: Record<string, string>; // display name → filename (active only)
  castableClasses: Record<string, string>; // castable name → space-separated class list
  castableIcons: Record<string, number>; // castable name → icon id (root Icon attr)
  castableBooks: Record<string, string>; // castable name → Book (root Book attr; drives icon type)
  statusCasters: Record<string, string[]>; // status name (lowercased) → castables that add it

  // NPC-specific cross-references
  castableTrainers: Record<string, string[]>; // castable name (lowercased) → NPCs that train it
  itemVendors: Record<string, string[]>; // item name (lowercased) → NPCs that sell it

  // Loot cross-reference
  itemLootSets: Record<string, string[]>; // item name (lowercased) → loot sets referencing it

  // Formula reverse index — extracted from the `<!-- creidhne:meta -->`
  // annotation on castable/status XML. Maps formula name → entity names that
  // reference it. Populated alongside castable/status scans respectively.
  formulaUsedByCastables: Record<string, string[]>;
  formulaUsedByStatuses: Record<string, string[]>;

  // Per-castable required minimum level — extracted from the FIRST
  // <Requirement>'s <Level Min="N"/> inside <Requirements>. Castables can
  // declare multiple Requirement blocks (per class), but only the first is
  // used in practice. Maps castable display name → number. Castables with no
  // Requirements element are absent from the map.
  castableRequiredLevels: Record<string, number>;

  // Per-item weapon damage — present on every item that declares a <Damage>
  // element under <Properties>, in either the self-closing or the paired form.
  // Used by the damage calculator to auto-populate weapon ranges from a
  // referenced weapon. Items without the element are absent from the map.
  //
  // SmallMin/SmallMax are required by the schema; LargeMin/LargeMax are
  // optional and default to 0, matching `ItemDamage` in Item.xsd. A value of 0
  // is a value, not a missing field — the weapon is present with a 0 in it.
  itemWeaponDamage: Record<string, {
    smallMin: number;
    smallMax: number;
    largeMin: number;
    largeMax: number;
  }>;

  // Element tables (HXML-24). Use `resolveElementTable(index, serverConfigName)`
  // to find the table that the server uses.
  elementTables: Record<string, ElementTableIndex>; // table Name → its elements, groups and default
  // Server config Name → its `ElementTable` attribute, or null when the
  // attribute is not set. The server then selects the table named `default`.
  serverconfigElementTables: Record<string, string | null>;

  // Traits (HXML-28)
  traitCategories: string[]; // each `Category` value, sorted
  traitExclusiveGroups: Record<string, string[]>; // ExclusiveGroup → the traits in it, in file order

  // Species (HXML-37). Keyed by the species `Key`.
  speciesDetails: Record<string, SpeciesDetail>;
  // Body `Id` → every body that claims it, in file order. The xml package
  // requires a body Id to be unique across all species, so more than one claim
  // is an error in the content.
  speciesBodyIds: Record<string, SpeciesBodyClaim[]>;

  // Localization cross-references
  npcResponseCalls: Record<string, string>; // Call attribute → response text
  npcStringKeys: NpcStringKey[];

  // Aggregated catalogs
  creatureTypes: string[];
  /**
   * The union of the elements of all element tables, sorted.
   *
   * @deprecated Use `elementTables` and `resolveElementTable`. This list does
   * not say which table an element is in. A later major version removes it.
   */
  elementnames: string[];
  scripts: string[]; // relative paths of .lua files under world/scripts/
  cookieNames: string[]; // extracted from Lua via setcookie("…")
  vendorTabs: string[];
  npcJobs: string[];
  creatureFamilies: string[];

  // Category lists + usage detail
  itemCategories: string[];
  castableCategories: string[];
  statusCategories: string[];
  itemCategoryDetails: CategoryDetail[];
  castableCategoryDetails: CategoryDetail[];
  statusCategoryDetails: CategoryDetail[];
  // Castable category -> full, uncapped member-name list. Unlike
  // castableCategoryDetails.usedBy (a 5-item sample), this resolves a category
  // to every castable in it. Consumed by spellbook expansion in Creidhne.
  castableCategoryMembers: Record<string, string[]>;

  // Map extended data
  mapDetails: MapDetail[];
  ignoredMapDetails: MapDetail[];
}

/** Progress callback payload emitted by buildIndex while scanning. */
export interface ProgressEvent {
  phase: 'scan' | 'cross-ref' | 'done';
  type?: IndexType;
  current?: number;
  total?: number;
}

export interface BuildOptions {
  onProgress?: (event: ProgressEvent) => void;
}
