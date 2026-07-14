/**
 * The reference persistence adapter (docs/SPEC.md §6, FR-5). See
 * {@link ApiLayoutPersistence} for the API-backed layout store and
 * {@link LayoutPersistenceAdapter} for the interface a host implements.
 */
export {
  ApiLayoutPersistence,
  LayoutPersistenceError,
  ownerToScope,
} from './api-layout-persistence';
export type {
  ApiLayoutPersistenceOptions,
  LayoutPersistenceAdapter,
} from './api-layout-persistence';
