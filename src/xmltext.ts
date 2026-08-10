/**
 * XML text semantics for the scrape.
 *
 * The builder reads world XML with regexes, not a parser, so entity references
 * arrive as literal text: a `<Name>` of `The Crow &amp; Cask` captures the nine
 * characters `&amp;` rather than one `&`. The server reads the same file
 * through `XmlSerializer`, which decodes it, so an index that keeps the raw form
 * holds a different string than the server holds.
 *
 * That difference is not cosmetic. A consumer picks the name out of an
 * index-backed list, writes it back through an XML escaper, and the escaper
 * escapes the `&` a second time — `&amp;amp;`. The value then decodes to
 * `The Crow &amp; Cask`, which matches no map, so the warp is dead.
 *
 * Decode once, here, so every consumer sees the string the server sees.
 */

/** The five entities XML predefines. Everything else must be declared. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Resolve a numeric character reference, or return the reference unchanged. */
function fromCodePoint(value: number, original: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return original;
  try {
    return String.fromCodePoint(value);
  } catch {
    return original;
  }
}

/**
 * Decode the five predefined XML entities and numeric character references
 * (`&#38;`, `&#x26;`).
 *
 * One pass, not a loop: `&amp;lt;` decodes to the four characters `&lt;`, which
 * is what the file means, and not to `<`. An entity this function does not know
 * is left exactly as it stands — a custom entity is declared in a DTD the scrape
 * never reads, so guessing at it would be worse than passing it through.
 */
export function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g,
    (match: string, dec?: string, hex?: string, name?: string): string => {
      if (dec != null) return fromCodePoint(parseInt(dec, 10), match);
      if (hex != null) return fromCodePoint(parseInt(hex, 16), match);
      return (name != null ? NAMED_ENTITIES[name] : undefined) ?? match;
    },
  );
}

/**
 * Decode entities, then trim. Every value the scrape captures out of XML text
 * or an XML attribute goes through this — names first, but also categories,
 * shop tabs, element names, localization strings and every cross-reference key,
 * because each of those is compared against or written back beside a name.
 *
 * Accepts the `string | undefined` a regex group yields so callers do not have
 * to write the nullish guard at every site.
 */
export function xmlText(raw: string | null | undefined): string {
  if (raw == null) return '';
  return decodeXmlEntities(raw).trim();
}
