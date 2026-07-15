/**
 * The reference persistence adapters (docs/SPEC.md §6, FR-5). See
 * {@link ApiLayoutPersistence} for the API-backed layout store,
 * {@link LocalLayoutPersistence} for the `localStorage`-backed static-demo store,
 * and {@link LayoutPersistenceAdapter} for the interface a host implements.
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
export {
  LocalLayoutPersistence,
  DEFAULT_LAYOUT_NAMESPACE,
} from './local-layout-persistence';
export type { LocalLayoutPersistenceOptions } from './local-layout-persistence';
