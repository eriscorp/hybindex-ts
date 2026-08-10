import { describe, expect, it } from 'vitest';
import { decodeXmlEntities, nameCollisionKey, xmlText } from '../src/index.js';

describe('decodeXmlEntities', () => {
  it('decodes the five predefined entities', () => {
    expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe(`&<>"'`);
  });

  it('decodes decimal and hexadecimal character references', () => {
    expect(decodeXmlEntities('&#38;')).toBe('&');
    expect(decodeXmlEntities('&#x26;')).toBe('&');
    expect(decodeXmlEntities('&#X26;')).toBe('&');
    expect(decodeXmlEntities('caf&#233;')).toBe('café');
  });

  it('decodes a reference outside the basic plane', () => {
    expect(decodeXmlEntities('&#x1F600;')).toBe('\u{1F600}');
  });

  it('decodes in one pass, so &amp;lt; becomes the text &lt;', () => {
    // A second pass would turn this into `<`, which is not what the file says.
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeXmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves an undeclared entity untouched', () => {
    expect(decodeXmlEntities('a &nbsp; b')).toBe('a &nbsp; b');
    expect(decodeXmlEntities('Q&A')).toBe('Q&A');
    expect(decodeXmlEntities('&amp')).toBe('&amp');
  });

  it('leaves an out-of-range character reference untouched', () => {
    expect(decodeXmlEntities('&#1114112;')).toBe('&#1114112;');
    expect(decodeXmlEntities('&#x110000;')).toBe('&#x110000;');
  });

  it('returns text with no ampersand unchanged', () => {
    expect(decodeXmlEntities('The Crow Cask')).toBe('The Crow Cask');
  });
});

describe('xmlText', () => {
  it('decodes and then trims', () => {
    expect(xmlText('  The Crow &amp; Cask \n')).toBe('The Crow & Cask');
  });

  it('maps a missing regex group to the empty string', () => {
    expect(xmlText(undefined)).toBe('');
    expect(xmlText(null)).toBe('');
  });
});

describe('nameCollisionKey', () => {
  it('lowercases, matching the server sanitizer', () => {
    expect(nameCollisionKey('Tagor Tavern')).toBe(nameCollisionKey('tagor tavern'));
  });

  it('keeps interior whitespace — Sanitize does not remove it, whatever its docstring says', () => {
    expect(nameCollisionKey('Mileth Inn Room 1')).toBe('mileth inn room 1');
  });

  it('normalizes to NFC, so a composed and a decomposed e-acute are one key', () => {
    const composed = 'café'; // e-acute as one code point
    const decomposed = 'café'; // e followed by a combining acute
    expect(composed).not.toBe(decomposed);
    expect(nameCollisionKey(composed)).toBe(nameCollisionKey(decomposed));
  });
});
