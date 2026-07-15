/// <reference types="vite/client" />

/**
 * The deploy's sideload posture (`off` | `dev` | `acknowledged`), injected as a
 * Vite `define` from `GRIDMASON_SIDELOAD_MODE` at build/serve time. Absent under
 * Vitest and anywhere the env is unset — read it through the `typeof` guard in
 * `src/sideload/policy.ts`, which defaults an undefined value to `off`.
 */
declare const __GM_SIDELOAD_MODE__: string | undefined;

/**
 * Whether this is the **static-demo** (serverless) build, injected as a Vite
 * `define` from `GRIDMASON_STATIC_DEMO` at build time. Absent under Vitest and in
 * a normal (server-backed) build — read it through the `typeof` guard in
 * `src/adapters/backend.ts` (`isStaticDemo`), which treats an undefined value as
 * the server-backed default.
 */
declare const __GM_STATIC_DEMO__: boolean | undefined;
