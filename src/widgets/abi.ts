/**
 * Widget-side ABI helpers shared by the first-party demo widgets (docs/SPEC.md §4).
 *
 * The canvas drives a widget through **attribute strings** — `context` and
 * `settings` carry JSON, `instance-id` a plain string, `edit-mode` is a boolean
 * (present/absent) attribute (`@gridmason/core` PageCanvas/abi). These helpers
 * are the read side of that contract: every demo widget observes the same
 * attribute names and parses them the same tolerant way, so a malformed or absent
 * attribute degrades to a neutral value rather than throwing inside a lifecycle
 * callback (which would trip the widget's own error boundary — SPEC §7).
 *
 * DOM-free and dependency-free, so it is unit-testable under Node and importing
 * it never evaluates widget/element code.
 */

/**
 * The ABI attribute names the canvas sets on a mounted widget — a widget-side
 * mirror of core's `ABI_ATTR`. Duplicated (not imported) so the framework-
 * agnostic widget ABI stays a pure string contract with no core import: a
 * third-party widget author reads these names off their element, not off a
 * `@gridmason/core` type.
 */
export const ABI_ATTRIBUTE = {
  /** Serialized typed page-context value (JSON). */
  context: 'context',
  /** Serialized per-instance saved props (JSON). */
  settings: 'settings',
  /** Stable grid-item key of the instance. */
  instanceId: 'instance-id',
  /** Boolean attribute — present iff the canvas is in edit mode. */
  editMode: 'edit-mode',
} as const;

/** A parsed JSON object, or `undefined` when the source was absent/empty/not-an-object. */
export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * Parse a JSON ABI attribute value, tolerating every degenerate case the canvas
 * can hand a widget: `null` (attribute absent), `''`, or malformed JSON all
 * return `undefined`. Never throws — a widget calling this inside
 * `connectedCallback` must not fault on bad host data.
 */
export function parseJsonAttr(value: string | null): unknown {
  if (value === null || value === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Narrow an unknown to a plain JSON object (excludes arrays and `null`). */
export function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

/**
 * Read the widget's `settings` attribute as a JSON object. A widget with no
 * saved props (canvas serializes `"{}"`) or a malformed value yields an empty
 * object, so a caller can always index into the result.
 */
export function readSettings(el: Element): JsonObject {
  return asObject(parseJsonAttr(el.getAttribute(ABI_ATTRIBUTE.settings))) ?? {};
}

/**
 * Read the widget's `context` attribute. A page with no context serializes to
 * JSON `null` (core's `serializeContext`), so both absent and `null` collapse to
 * `undefined` — letting a context consumer tell "no context" from an empty one.
 */
export function readContext(el: Element): unknown {
  const value = parseJsonAttr(el.getAttribute(ABI_ATTRIBUTE.context));
  return value === null ? undefined : value;
}

/** Read a string prop from a settings object, falling back when absent/blank/non-string. */
export function readStringProp(
  settings: JsonObject,
  key: string,
  fallback: string,
): string {
  const value = settings[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
