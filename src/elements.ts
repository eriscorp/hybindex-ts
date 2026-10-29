/**
 * Element table selection (HXML-24).
 *
 * A world can have more than one element table. Each server config selects one
 * with its `ElementTable` attribute. The server uses that table when it exists.
 * When it does not exist, and only one table is loaded, the server uses that
 * one table.
 */

import type { WorldIndex } from './types.js';

/**
 * The table name that a server config selects when it has no `ElementTable`
 * attribute. The generated xml class starts the attribute at this value.
 */
export const DEFAULT_ELEMENT_TABLE = 'default';

const hasOwn = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * The name of the element table that the server uses, or null when the index
 * cannot tell.
 *
 * 1. When `serverConfigName` names a server config, and the table that it
 *    selects exists, the result is that table. A server config without an
 *    `ElementTable` attribute selects `default`.
 * 2. When only one table exists, the result is that table.
 * 3. Otherwise the result is null.
 *
 * An index built before 1.2.0 has no table fields, so the result is null.
 */
export function resolveElementTable(
  index: Pick<WorldIndex, 'elementTables' | 'serverconfigElementTables'>,
  serverConfigName?: string,
): string | null {
  const tables = index.elementTables ?? {};
  const configs = index.serverconfigElementTables ?? {};
  if (serverConfigName != null && hasOwn(configs, serverConfigName)) {
    const selected = configs[serverConfigName] ?? DEFAULT_ELEMENT_TABLE;
    if (hasOwn(tables, selected)) return selected;
  }
  const names = Object.keys(tables);
  return names.length === 1 ? names[0]! : null;
}
