# @eriscorp/hybindex-ts

World index builder for Hybrasyl XML libraries. Shared between [Creidhne](https://github.com/hybrasyl/creidhne) (XML editor) and [Taliesin](https://github.com/hybrasyl/taliesin) (asset viewer) so the index shape stays authoritative in one place.

## What it does

Scans a `world/xml/` directory tree and produces a `WorldIndex` — a JSON shape describing every XML entity in the library, plus cross-references (status → castables that apply it, item → NPCs that vendor it, etc.), category lists, map coordinates, Lua script cookies, and more.

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
  phase: 'scan' | 'cross-ref' | 'write' | 'done';
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

## Development

```sh
npm install
npm test         # vitest
npm run build    # tsup → dist/ (ESM + CJS + .d.ts)
npm run lint     # tsc --noEmit
```

## License

MIT
