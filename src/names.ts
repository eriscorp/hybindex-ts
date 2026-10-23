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
 * The collision key: a name normalized to NFC and lower-cased. It is the
 * strictest key the server applies to a name, so no collision the server has
 * goes unreported. It is not the key every type is looked up by:
 *
 * - Maps are indexed through `WorldStateStore.Sanitize`,
 *   `key.ToString().Normalize().ToLower()`, and items, castables and statuses
 *   also register `Name.ToLower()`. For these `Tagor Tavern` and
 *   `tagor tavern` are one key.
 * - Every other type in the XML package (npcs, creatures, lootsets,
 *   spawngroups and the rest) is keyed on its exact `Name` in `XmlStore`:
 *   case-sensitive, not normalized. Two names differing only in case are two
 *   entries there, so this key over-reports for those types, and a reference
 *   to one must match its case exactly.
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
