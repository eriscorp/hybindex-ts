# @eriscorp/hybindex-ts

World index builder for Hybrasyl XML libraries. Shared between [Creidhne](https://github.com/hybrasyl/creidhne) (XML editor) and Taliesin (asset viewer) so the index shape stays authoritative in one place.

## What it does

Scans a `world/xml/` directory tree and produces a `WorldIndex` — a JSON shape describing every XML entity in the library, plus cross-references (status → castables that apply it, item → NPCs that vendor it, etc.), category lists, map coordinates, Lua script cookies, and more.

On disk the index is stored as per-type files inside `world/.creidhne/`, flat alongside the existing `constants.json` / `formulas.json`:

```
.creidhne/
├── constants.json          # (owned by Creidhne, not this package)
├── formulas.json           # (owned by Creidhne, not this package)
├── _meta.json              # schema version + builtAt + scripts + cookieNames
├── castables.json          # castables list + filename map + cross-refs
├── items.json
├── statuses.json
├── npcs.json
├── …                       # one file per INDEX_TYPES entry
```

Legacy single-file `index.json` is migrated silently on first load and deleted.

## Install

```sh
npm install @eriscorp/hybindex-ts
```

(Currently consumed as `file:../hybindex-ts` by Creidhne + Taliesin until formally published.)

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

// Read whatever's on disk (migrates legacy index.json if needed)
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
| `loadIndex(libraryPath)` | Read index from disk, migrate legacy if present, return `WorldIndex` or `null`. |
| `saveIndex(libraryPath, index)` | Write the full index as per-type files (atomic renames). |
| `saveSection(libraryPath, type, fields)` | Write only the specified section's fields, bump `_meta.builtAt`. |
| `deleteIndex(libraryPath)` | Remove all index files (legacy + per-type). Leaves other `.creidhne/` files (constants, formulas) alone. |
| `getIndexStatus(libraryPath)` | `{ exists, builtAt? }` — works with either layout. |

## Development

```sh
npm install
npm test         # vitest
npm run build    # tsup → dist/ (ESM + CJS + .d.ts)
npm run lint     # tsc --noEmit
```

## License

MIT
