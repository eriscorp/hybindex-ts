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

export {
  loadIndex,
  saveIndex,
  saveSection,
  deleteIndex,
  getIndexStatus,
  ensureCreidhneDir,
  cleanupInWorldIndex,
  fieldsForType,
} from './storage.js';

export {
  SCHEMA_VERSION,
  resolveCacheBase,
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
  MapDetail,
  CategoryDetail,
  NpcStringKey,
  BuildOptions,
  ProgressEvent,
} from './types.js';

export { INDEX_TYPES } from './types.js';
