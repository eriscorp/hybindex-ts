# @eriscorp/hybindex-ts

World index builder for Hybrasyl XML libraries. Shared between [Creidhne](https://github.com/hybrasyl/creidhne) (XML editor) and [Taliesin](https://github.com/hybrasyl/taliesin) (asset viewer) so the index shape stays authoritative in one place.

## What it does

Scans a `world/xml/` directory tree and produces a `WorldIndex` — a JSON shape describing every XML entity in the library, plus cross-references (status → castables that apply it, item → NPCs that vendor it, etc.), category lists, map coordinates, Lua script cookies, and more.

## Directory layout

Scanning is **recursive**, matching the server: Hybrasyl loads world XML with `SearchOption.AllDirectories`, so subdirectories under a type directory are legal and do load.

```
world/xml/
├── castables/
│   ├── blast.xml               → key "blast.xml"
│   ├── fire/inferno.xml        → key "fire/inferno.xml"
│   └── .ignore/                → archived: the server never loads these
│       ├── old.xml             → key ".ignore/old.xml"
│       └── deprecated/x.xml    → key ".ignore/deprecated/x.xml"
```

**Filename keys are paths relative to the type directory, forward-slashed** — in `castablesNamesByFilename`, `castableFilenames`, `MapDetail.filename`, and friends. `join(libraryPath, type, key)` resolves any of them.

### Archived (`.ignore/`) content

A file is **archived** when any path segment is exactly `.ignore`, at any depth. Archived content is indexed but always distinguishable from live content:

- Active name lists (`index.castables`, …) contain **only** active entries. Archived names live in `archivedCastables`, `archivedStatuses`, and so on.
- `namesByFilename` maps cover both, and the `.ignore/` key prefix is what marks an entry archived. Use the exported `isArchivedPath` rather than hand-rolling the check:

```ts
import { isArchivedPath } from '@eriscorp/hybindex-ts';
const activeOnly = Object.keys(index.castablesNamesByFilename).filter((k) => !isArchivedPath(k));
```

- `castableFilenames` is active-only.
- Maps split into `mapDetails` (active) and `ignoredMapDetails` (archived).

> The server tests the whole path with `!x.Contains(".ignore")`, so it also skips `sword.ignore.xml` and `old.ignored/`. This package matches on path segments instead — the substring rule would blank an entire world checked out under a directory containing `.ignore`. No such filename exists in the world data.

The index is a **rebuildable, per-machine cache** — derived data, not source — so it lives in local app storage outside the (git-tracked) world folder. The authoritative `constants.json` / `formulas.json` stay in `world/.creidhne/`; only this package's index files moved out:

```
<cacheBase>/v<SCHEMA_VERSION>/<worldKey>/
├── _meta.json              # schema version + builtAt + scripts + cookieNames
├── castables.json          # castables list + filename map + cross-refs
├── items.json
├── statuses.json
├── npcs.json
├── …                       # one file per INDEX_TYPES entry
├── _filecache.json         # per-section build signature (incremental rebuilds)
```

- `cacheBase` is `%LOCALAPPDATA%\Erisco\hybindex` on Windows and `~/.config/Erisco/hybindex` elsewhere. Set `HYBINDEX_CACHE_DIR` to override it (used by tests).
- `<worldKey>` is `<worldName>-<sha1(absolutePath)>`, so two libraries that share a folder name never collide.
- Every consumer resolves the same base, but the cache under it is namespaced by `SCHEMA_VERSION` — so two apps share one cache only while they are on the same schema. An app a major version behind reads its own `v<n>` directory beside the current one and rebuilds.
- Builds are **incremental**: `_filecache.json` records a cheap stat-only signature per section, so a no-change rebuild is `O(stat)` and editing one type rescans only that type.

Pre-0.3.0 the index lived in-world under `world/.creidhne/`. There is no migration of that derived data — it is simply cleaned up (`cleanupInWorldIndex`) the next time the index is saved.

Before 1.1.0 the base off Windows was `~/.config/erisco/hybindex`, lowercased. Every other Erisco app writes `Erisco` on every platform, so this was the one exception — and only where it was invisible, since NTFS and APFS are case-insensitive and only Linux ever showed two vendor directories. `migrateLegacyCacheBase` renames the old one into place once; it runs automatically wherever this package creates its cache directory, and is exported so an app can also call it at startup.

`SCHEMA_VERSION` namespaces the cache directory, so a schema bump rebuilds from scratch on next run rather than migrating. It is now `v4`. Any older `v<n>/` directory left behind is inert and can be deleted by hand.

## Install

```sh
npm install @eriscorp/hybindex-ts
```

## Usage

```ts
import {
  buildIndex,
  buildSection,
  loadIndex,
  saveIndex,
  saveSection,
  type WorldIndex,
  type IndexType,
} from '@eriscorp/hybindex-ts';

// Full build
const index = await buildIndex('/path/to/world/xml', {
  onProgress: (e) => console.log(e.phase, e.type, e.current, e.total),
});
await saveIndex('/path/to/world/xml', index);

// Partial re-index after a single-file save
const { fields } = await buildSection('/path/to/world/xml', 'castables');
await saveSection('/path/to/world/xml', 'castables', fields);

// Read the cached index (null if none has been built yet)
const loaded = await loadIndex('/path/to/world/xml');
```

### Names are decoded

The scrape reads XML with regexes, so entity references arrive as literal text. Every value it captures is decoded before it enters the index — the five predefined entities and numeric character references — so a `<Name>` of `The Crow &amp; Cask` indexes as `The Crow & Cask`, which is the string the server holds after `XmlSerializer` decodes the same file.

**Write it back through your own escaper, not around it.** The index value is decoded text; escaping it once on the way out is correct and produces the file's original form. Skipping the escape, or escaping a value you took from the index and assumed was still encoded, is what produced `&amp;amp;` — a name that matches nothing, so the warp is dead. `decodeXmlEntities` and `xmlText` are exported for a consumer that scrapes XML of its own and has to agree with the index about what a name is.

Decoding is one pass, so `&amp;lt;` stays the text `&lt;`. An entity this package does not know is left exactly as written, because a custom entity is declared in a DTD the scrape never reads.

### Duplicate names

A `<Name>` is a key, not a label. The server resolves a warp destination out of a name-keyed index, and such an index holds one entry per key — so two active files claiming one name leaves one of them unreachable by name, which shows up as a warp that does nothing and an error line in the server log. Nothing in the XML prevents it, so the index reports it:

```ts
import { duplicateNamesFor, nameCollisionKey } from '@eriscorp/hybindex-ts';

for (const [key, files] of Object.entries(index.mapsDuplicateNames)) {
  console.warn(`${files.length} maps claim ${key}: ${files.join(', ')}`);
}

// With the type as a variable, and probing one name:
const dupes = duplicateNamesFor(index, type);
const clash = dupes[nameCollisionKey(candidateName)];
```

- **It is data, not an error.** A world with a collision still builds and still opens. Warn in the editor, naming the other file; do not block, because a builder mid-rename passes through a colliding state legitimately and a hard block cannot fix the files that already exist.
- **The comparison is the server's.** Hybrasyl sanitizes every index key with `key.ToString().Normalize().ToLower()`, so the check is Unicode-normalized and case-insensitive. Probe with `nameCollisionKey` rather than lowercasing by hand. Whitespace is kept — the docstring beside the server's `Sanitize` says it is removed, but the code does not remove it.
- **Uniqueness is per type.** An item and a map may share a name.
- **Archived (`.ignore/`) files are never reported.** The server does not load them, so an archived copy of a live file is not a collision.

### Progress events

`buildIndex` and `buildSection` emit progress events for UI streaming:

```ts
interface ProgressEvent {
  phase: 'scan' | 'cross-ref' | 'done';
  type?: IndexType;      // set during `scan` phase
  current?: number;      // files processed so far
  total?: number;        // files in this type
}
```

## API

| Function | Purpose |
|---|---|
| `buildIndex(libraryPath, options?)` | Scan everything, return full `WorldIndex`. |
| `buildSection(libraryPath, type, options?)` | Scan a single type; returns `{ type, fields }` where `fields` is the subset of `WorldIndex` owned by that type. |
| `loadIndex(libraryPath)` | Read the cached index, return `WorldIndex` or `null` (no cache yet). |
| `saveIndex(libraryPath, index)` | Write the full index as per-type files (atomic renames) + `_filecache.json`; cleans up any stale in-world copy. |
| `saveSection(libraryPath, type, fields)` | Write only the specified section's fields, bump `_meta.builtAt`, refresh that section's signature. |
| `deleteIndex(libraryPath)` | Remove all cached index files (and any stale in-world copy). Authoritative `constants.json` / `formulas.json` are untouched. |
| `getIndexStatus(libraryPath)` | `{ exists, builtAt?, stale? }` — `stale` is true when the world's files no longer match the build signature. |
| `cleanupInWorldIndex(libraryPath)` | Remove the pre-0.3.0 in-world index files. Idempotent; called automatically by `saveIndex`. |
| `isArchivedPath(key)` | True when a filename key lives under an `.ignore/` archive — i.e. content the server never loads. |
| `listSectionFiles(libraryPath, type)` | `{ dir, active[], archived[] }` — the single definition of which files belong to a section. Enumerate a type directory with this rather than your own `readdir`, or your file list drifts from the index's keys. |
| `duplicateNamesFor(index, type)` | That type's collision report, `{}` when the type is clean or the cache predates 1.1.0. Use it when the type is a variable. |
| `nameCollisionKey(name)` | The server's own index-key rule. Probe a collision report with this, never with a hand-rolled `toLowerCase()`. |
| `decodeXmlEntities(raw)` / `xmlText(raw)` | Decode XML entities; `xmlText` also trims. The scrape applies these already — they are for a consumer scraping XML of its own. |
| `migrateLegacyCacheBase()` | Rename the pre-1.1.0 lowercase vendor directory. Idempotent, best effort, and already called wherever this package creates its cache directory. |

## Development

```sh
npm install
npm test         # vitest
npm run build    # tsup → dist/ (ESM + CJS + .d.ts)
npm run lint     # tsc --noEmit
```

## License

MIT
