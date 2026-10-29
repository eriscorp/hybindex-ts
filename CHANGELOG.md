# Changelog

All notable changes to `@eriscorp/hybindex-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-29

### Added

- **Element tables (HTOO-582, HXML-24).** `elementTables` maps each element table name to its element keys, its groups and its default element. `serverconfigElementTables` maps each server config to its `ElementTable` attribute, or to null when the attribute is not set.
  - `resolveElementTable(index, serverConfigName?)` returns the table that the server uses: the table that the server config selects, when it exists, and otherwise the only table. A server config without the attribute selects `default`. `DEFAULT_ELEMENT_TABLE` is exported.
  - A table without an `<Elements>` block is in the old format. Its elements are its `<Source>` rows, it has no groups, and its default is null. `world` and `ceridwen` keep this format until the HS-1239 content migration.
- **Traits (HTOO-616, HXML-28).** `traits`, `archivedTraits`, `traitsNamesByFilename` and `traitsDuplicateNames`, keyed by the `Name` attribute. `traitCategories` lists each `Category`. `traitExclusiveGroups` maps each `ExclusiveGroup` to its traits.
- **Species (HTOO-616, HXML-37).** `species`, `archivedSpecies`, `speciesNamesByFilename` and `speciesDuplicateNames`, keyed by the `Key` attribute. `speciesDetails` holds the `Id`, `BranchOf`, `PlayerOption` and bodies of each species. `speciesBodyIds` maps each body `Id` to every body that claims it, with the file, because a body `Id` must be unique across all species.
- **`listIndexCaches` and `pruneIndexCaches` (HTOO-583).** They find and remove cache directories of an old schema version, and cache directories whose world no longer exists. `dryRun` returns the list and removes nothing. A version higher than `SCHEMA_VERSION` is never touched. Nothing calls them automatically.

### Changed

- **The macOS cache base is `~/Library/Application Support/Erisco/hybindex` (HTOO-586).** It was `~/.config/Erisco/hybindex`, the Linux base. Every other Erisco tool on a Mac uses `Application Support`. `migrateLegacyCacheBase` moves the old base on the first save. Windows and Linux do not change.
- **`SCHEMA_VERSION` is now `5`.** The first build after this release rebuilds from source into `v5/`. `pruneIndexCaches` removes the old `v4/`.
- **`elementnames` is deprecated.** It is the union of all tables. In a table with an `<Elements>` block it now comes from the `<Element Key>` values, not from the `<Source>` rows. A later major version removes it, after Creidhne uses `elementTables`.

### Fixed

- **An attribute-keyed file is named by its root element only.** The scrape took the first `Name="…"` anywhere in the file. A file without a root `Name` took the name of a child element.
  - `world`'s `serverconfigs/config.xml` was indexed as `Danaan`, the name of one of its `<Age>` elements, and `ceridwen`'s as `discuss`, the name of a `<Board>`. The server names both `default`, and so does the index now. An element table without a root `Name` is also `default`.
  - The new element format gives each `<Element>` a `Name` attribute, so without this fix an element table without a root `Name` took the name of its first element.
  - `world` has 582 archived spawn groups in an old format with no root `Name`. Each was listed under the name of its first `<Map>`. They now have no name, and `archivedSpawngroups` drops from 574 names to 1.

### Tooling

- Update `vitest` and `@vitest/coverage-v8` to `^4.1.12`, and run `npm audit fix`. The CI audit step failed on advisories in the dev dependencies (vitest, vite, esbuild, source-map-js). The published package has no runtime dependencies, so a consumer was not affected.

## [1.1.0] - 2026-08-09

### Fixed

- **Names are decoded, so a consumer cannot escape them twice.** The scrape read
  raw file text, so a `<Name>` of `The Crow &amp; Cask` entered the index with
  the entity intact. The server decodes it through `XmlSerializer`, so the index
  held a different string than the server held. A consumer that picked the name
  out of an index-backed list and wrote it back through an XML escaper produced
  `&amp;amp;` — a value that matches no map, so the warp was dead. Every value
  the scrape captures is now decoded: the five predefined entities and numeric
  character references, in one pass, so `&amp;lt;` stays the text `&lt;`. An
  undeclared entity is left exactly as written.
- **`itemWeaponDamage` no longer drops weapons.** Three rules, each of which
  removed a weapon from the index with no error and no way to tell it apart from
  an item that is not a weapon:
  - The regex matched the self-closing `<Damage …/>` only, so a weapon written
    with the paired `<Damage …></Damage>` contributed nothing.
  - The guard tested truthiness, so `SmallMin="0"` — the string `"0"` — dropped
    any weapon whose minimum damage is legitimately 0.
  - The guard required all four attributes. `Item.xsd` marks LargeMin/LargeMax
    optional with a default of 0.0, and `world` has a weapon that relies on it,
    so requiring them dropped it. Against `world` the weapon count rises from
    156 to 157: `weapon_oak-stick.xml` was the missing one.

### Added

- **`<type>DuplicateNames`** — one field per indexed type, reporting names
  claimed by more than one active file as `collision key → filenames`. A `<Name>`
  is a server index key, not a label: `Warp.cs` resolves a destination out of a
  name-keyed index, and such an index holds one entry per key, so two files
  sharing a name leaves one of them unreachable by name. Emitted as data, never
  thrown — a world with a collision must still open. `world` is clean across all
  sixteen types as of this release.
  - The comparison matches the server's. Hybrasyl sanitizes every index key with
    `key.ToString().Normalize().ToLower()`, so the check is Unicode-normalized
    and case-insensitive. Whitespace is kept: the docstring beside `Sanitize`
    claims it is removed, but the code does not remove it.
  - Archived (`.ignore/`) files never appear. The server does not load them, so
    an archived copy of a live file is not a collision — `world` has two, and a
    check that reported them on day one would be ignored thereafter.
  - Types whose name is an XML attribute rather than a `<Name>` element are
    covered, because the report is built from the same extraction the rest of the
    scrape uses.
- **`nameCollisionKey`, `duplicateNamesFor`, `duplicateNamesKey`** — probe a
  collision report the way it was built rather than lowercasing by hand, and read
  it with the type as a variable rather than through sixteen field names.
- **`decodeXmlEntities`, `xmlText`** — exported for a consumer that scrapes XML
  of its own and has to agree with the index about what a name is.
- **`migrateLegacyCacheBase`** — see below. Called automatically wherever this
  package creates its cache directory; exported so an app can also run it once at
  startup.

### Changed

- **The vendor directory is `Erisco` on every platform.** Off Windows the base
  was `~/.config/erisco/hybindex`, and hybindex was the only thing in the house
  that lowercased it. It was invisible until somebody used Linux: NTFS and APFS
  are case-insensitive, so the two spellings are one directory on Windows and
  macOS, while Linux gave the same user two sibling vendor directories. No data
  was ever lost by it.
  - The old directory is renamed into place once, and the emptied lowercase
    vendor directory is removed. Only Linux ever moves anything: on macOS the
    destination already exists, so the guard declines, which is correct because
    the two names are one directory. The rename is best effort — the index is a
    rebuildable cache, so a failure costs a rebuild and nothing else.
  - Taliesin's own lowercase `erisco` in `assetPacks.ts` is a different
    application's convention and is not affected by this.
- **`SCHEMA_VERSION` is now `4`.** The cache directory is namespaced by it, so
  the first build after this release rebuilds from source. That is what
  populates the collision reports and replaces names that still carry undecoded
  entities.
- The docstring in `paths.ts` claimed that Creidhne and Taliesin share one cache.
  The base is shared; the cache under it is namespaced by `SCHEMA_VERSION`, so
  two apps share a cache only while they are on the same schema. Corrected.

## [1.0.0] - 2026-07-24

First stable release. Earlier `0.x` release notes live in the GitHub Releases.

### Added

- **`castableIcons`** — maps each castable name to its icon id (the root `Icon`
  attribute). A castable without an `Icon` attribute is absent from the map.
- **`castableBooks`** — maps each castable name to its `Book` value (the root
  `Book` attribute). This value drives the icon type in the client.
- **`castableCategoryMembers`** — maps each castable category to the full,
  deduped, sorted list of member names. Unlike `castableCategoryDetails.usedBy`
  (a 5-item sample), this list resolves a category to every castable in it. It
  supports spellbook expansion in Creidhne.

### Changed

- **`SCHEMA_VERSION` is now `3`.** The cache directory is namespaced by this
  value, so the first build after this release rebuilds the index from source.
  This step makes sure the new castable fields are populated. It replaces any
  stale `v2` cache that does not have the new fields.

### Tooling

- Add Vitest v8 coverage with a floor gate (`npm run test:coverage`).
- Add a CI workflow that runs the typecheck, the coverage gate, the build, and
  an audit on every pull request and every push to `main`.
- Add a `.gitattributes` file that forces LF line endings.
