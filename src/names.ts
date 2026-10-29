/**
 * Name identity, as far as the server's keys allow.
 *
 * A `<Name>` in world XML is a key, not a label. The server resolves a warp
 * destination out of a name-keyed index (`Warp.cs` → `TryGetValueByIndex`) that
 * keeps the first map registered under a name. A second map with that name is
 * unreachable by name, and a warp meant for it silently lands on the first.
 * Nothing in the XML prevents it, so the index reports it.
 */

import type { DuplicateNames, IndexType, WorldIndex } from './types.js';

/**
 * The collision key: a name normalized to NFC and lower-cased with the
 * locale-independent `toLowerCase`. Collision reports are grouped by it.
 *
 * It matches the server's map key (short of culture-specific casing) and
 * approximates every other type, so a report is a warning: it can name a pair the server keeps apart,
 * and rarely miss one the server merges. How the server keys and looks up each
 * type, and why references are not uniformly case-insensitive, is in the
 * README under "Duplicate names".
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
