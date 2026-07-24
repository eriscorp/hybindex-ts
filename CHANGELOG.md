# Changelog

All notable changes to `@eriscorp/hybindex-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
