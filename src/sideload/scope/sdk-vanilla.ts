/**
 * The dashboard's pinned copy of the framework-agnostic `@gridmason/sdk/vanilla`
 * helper adapter, re-exported for the **dev-sideload import scope** (issue #40) —
 * **dev server only**. Same mechanism and rationale as `./sdk`: a vanilla
 * scaffold-template widget that imports the `/vanilla` adapter by bare specifier
 * resolves here to the dashboard's installed copy, Vite-transformed so it carries
 * no bare specifier of its own. Framework adapters (`/react`, `/vue`) are **not**
 * mapped: their widgets also import their framework (`react`/`vue`) by bare
 * specifier, which is out of scope for this issue (docs/sideload.md).
 */
export * from '@gridmason/sdk/vanilla';
