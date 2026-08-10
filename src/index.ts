/**
 * @eriscorp/hybindex-ts — world index builder for Hybrasyl XML libraries.
 *
 * Shared between Creidhne (XML editor) and Taliesin (asset viewer). Both
 * consume this package so the index shape stays authoritative in one place.
 *
 * ```ts
 * import { buildIndex, loadIndex, saveIndex, buildSection, saveSection } from '@eriscorp/hybindex-ts';
 *
 * const index = await buildIndex('/path/to/world/xml', {
 *   onProgress: (e) => console.log(e.phase, e.type, e.current, e.total),
 * });
 * await saveIndex('/path/to/world/xml', index);
 * ```
 */

export { buildIndex, buildSection } from './builder.js';
export type { SectionResult } from './builder.js';

// `listSectionFiles` is the single definition of "which files belong to section
// <type>". Consumers that enumerate a section (editor file lists, XML crawls,
// CSV reports) must go through it rather than their own readdir, or their file
// set drifts from the index's — see the module docstring in scan.ts.
export { isArchivedPath, listSectionFiles } from './scan.js';
export type { SectionFiles } from './scan.js';

export {
  loadIndex,
  saveIndex,
  saveSection,
  deleteIndex,
  getIndexStatus,
  ensureCreidhneDir,
  cleanupInWorldIndex,
  migrateLegacyCacheBase,
  fieldsForType,
} from './storage.js';

// Name identity. `nameCollisionKey` is the server's own index-key rule, so a
// consumer probing a collision report normalizes the same way the report was
// built — do not lowercase by hand at the call site.
export { duplicateNamesFor, duplicateNamesKey, nameCollisionKey } from './names.js';

// Entity decoding. The scrape applies `xmlText` to everything it captures, so a
// consumer normally never needs these; they are exported for a consumer that
// scrapes XML of its own and must agree with the index about what a name is.
export { decodeXmlEntities, xmlText } from './xmltext.js';

export {
  SCHEMA_VERSION,
  resolveCacheBase,
  getLegacyCacheBase,
  worldKey,
  getIndexDir,
  getIndexFilePath,
  getFileCachePath,
  getCreidhneDir,
  getLegacyIndexPath,
  getInWorldIndexFilePath,
} from './paths.js';

export type {
  WorldIndex,
  IndexType,
  DuplicateNames,
  MapDetail,
  CategoryDetail,
  NpcStringKey,
  BuildOptions,
  ProgressEvent,
} from './types.js';

export { INDEX_TYPES } from './types.js';
