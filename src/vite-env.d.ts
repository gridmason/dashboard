/// <reference types="vite/client" />

/**
 * The deploy's sideload posture (`off` | `dev` | `acknowledged`), injected as a
 * Vite `define` from `GRIDMASON_SIDELOAD_MODE` at build/serve time. Absent under
 * Vitest and anywhere the env is unset — read it through the `typeof` guard in
 * `src/sideload/policy.ts`, which defaults an undefined value to `off`.
 */
declare const __GM_SIDELOAD_MODE__: string | undefined;
