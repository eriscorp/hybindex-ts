# Changelog

All notable changes to `@eriscorp/hybindex-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The collision key's docs said every type keys case-insensitively.** Only
  maps, and the `Name.ToLower()` keys of items, castables and statuses, do.
  Every other XML type is keyed on its exact `Name`, so for those a case-only
  collision is one the server does not have, and a reference must match the
  name's case exactly. `nameCollisionKey` is unchanged: it is the strictest key
  the server applies, so it still reports every real collision.

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
