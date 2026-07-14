/**
 * The dashboard's pinned copy of `@gridmason/protocol`, re-exported for the
 * **dev-sideload import scope** (issue #40) — **dev server only**. Same mechanism
 * and rationale as `./sdk`: a scaffold-template widget that imports author-facing
 * protocol types/values (`WidgetID`, the capability grammar, …) by bare specifier
 * resolves here to the dashboard's installed copy. Mapping protocol as well as the
 * SDK keeps a single protocol instance across the widget, the served SDK, and the
 * app (all resolve to the same Vite-optimized dep).
 */
export * from '@gridmason/protocol';
