/**
 * Name identity, matched to the server's.
 *
 * A `<Name>` in world XML is a key, not a label. The server resolves a warp
 * destination out of a name-keyed index (`Warp.cs` → `TryGetValueByIndex`), and
 * a name-keyed index holds one entry per key. Two files claiming one name means
 * one of them is unreachable by name: the warp does nothing and the server logs
 * an error. Nothing in the XML prevents it, so the index reports it.
 */

import type { DuplicateNames, IndexType, WorldIndex } from './types.js';

/**
 * Normalize a name the way the server normalizes an index key, so a collision
 * reported here is a collision the server actually has.
 *
 * Hybrasyl sanitizes every index key with `key.ToString().Normalize().ToLower()`
 * — `WorldStateStore.Sanitize` for maps, and the identical line in the XML
 * package's `XmlManager` for the rest. So the comparison is Unicode-normalized
 * (NFC) and case-insensitive: `Tagor Tavern` and `tagor tavern` are one key.
 *
 * Whitespace is kept. The docstring beside `Sanitize` claims it removes
 * whitespace — `MiLeTh InN RoOm 1` → `milethinnroom1` — but `Normalize()` is
 * Unicode normalization and does no such thing. The code is what runs, and a
 * check looser than the server's would report collisions the server does not
 * have. Surrounding whitespace is already gone: the scrape trims every name.
 */
export function nameCollisionKey(name: string): string {
  return name.normalize().toLowerCase();
}

/** WorldIndex field holding one type's collision report. */
export function duplicateNamesKey(type: IndexType): string {
  return `${type}DuplicateNames`;
}

/**
 * One type's collision report: collision key → every active file claiming it.
 * Empty when the type is clean, and empty for an index built before 1.1.0.
 *
 * Reach for this rather than the field name when the type is a variable — an
 * editor validating whichever type is open has one call site, not sixteen.
 */
export function duplicateNamesFor(index: WorldIndex, type: IndexType): DuplicateNames {
  const record = index as unknown as Record<string, DuplicateNames | undefined>;
  return record[duplicateNamesKey(type)] ?? {};
}
