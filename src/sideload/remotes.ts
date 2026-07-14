/**
 * Turn an admitted {@link DevSideloadRemote} into a {@link LocalRemote} the boot
 * import map can carry (docs/SPEC.md §2 + §4).
 *
 * A sideloaded remote rides the **exact same** mount path as a first-party local
 * remote: it is a `LocalRemote` whose `load` thunk `import()`s the dev server's
 * ES-module entry (registering its custom element), keyed into the same import
 * map `CanvasHost` hands `loadWidgetsForLayout`. The only differences are its
 * `sideload:<origin>` identity and that its module URL is a runtime dev-server
 * URL rather than a shell-bundled chunk — hence the `@vite-ignore`, which keeps
 * Vite from trying to resolve/bundle a URL only known at runtime.
 */
import type { LocalRemote } from '../boot/import-map';
import type { DevSideloadRemote } from './allowlist-store';

/** Build the import-map entry for one admitted dev-sideload remote. */
export function sideloadRemote(remote: DevSideloadRemote): LocalRemote {
  return {
    tag: remote.tag,
    source: remote.widgetID.source,
    name: remote.name,
    specifier: `${remote.widgetID.source}/${remote.tag}`,
    // The dev server's entry URL is only known at runtime — `@vite-ignore` stops
    // Vite's static import analysis from trying to pre-bundle it.
    load: () => import(/* @vite-ignore */ remote.entryUrl),
  };
}
