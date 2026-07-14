/**
 * The reference governance adapter (docs/SPEC.md §5/§6, FR-4). See
 * {@link ApiGovernance} for the API-backed org-publication store and
 * {@link GovernanceAdapter} for the interface a host implements.
 */
export { ApiGovernance, GovernanceError } from './api-governance';
export type {
  ApiGovernanceOptions,
  GovernanceAdapter,
  OrgPublication,
} from './api-governance';
