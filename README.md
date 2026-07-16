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

- `cacheBase` is `%LOCALAPPDATA%\Erisco\hybindex` on Windows, `~/.config/erisco/hybindex` elsewhere. Set `HYBINDEX_CACHE_DIR` to override it (used by tests).
- `<worldKey>` is `<worldName>-<sha1(absolutePath)>`, so two libraries that share a folder name never collide. Both Creidhne and Taliesin resolve the same base, so one cache serves both.
- Builds are **incremental**: `_filecache.json` records a cheap stat-only signature per section, so a no-change rebuild is `O(stat)` and editing one type rescans only that type.

Pre-0.3.0 the index lived in-world under `world/.creidhne/`. There is no migration of that derived data — it is simply cleaned up (`cleanupInWorldIndex`) the next time the index is saved.

`SCHEMA_VERSION` namespaces the cache directory, so a schema bump simply rebuilds from scratch on next run rather than migrating. It is now `v2` — filename keys became type-relative paths, so a `v1` cache is not readable under the current semantics. Any `v1/` directory left behind is inert and can be deleted by hand.

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

## Development

```sh
npm install
npm test         # vitest
npm run build    # tsup → dist/ (ESM + CJS + .d.ts)
npm run lint     # tsc --noEmit
```

## License

MIT
