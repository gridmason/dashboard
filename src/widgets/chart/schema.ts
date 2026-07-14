/**
 * The chart widget's **props JSON Schema** and a tiny validator for it
 * (docs/SPEC.md §4, §5) — DOM-free and unit-testable.
 *
 * The chart is the "settings-heavy" demo widget: its `settings` (the layout
 * item's `props`) are validated against a JSON Schema before it renders,
 * exercising the settings/props ABI surface end to end. `CHART_PROPS_SCHEMA` is
 * an ordinary JSON-Schema (draft-07-shaped) document — the same artifact a
 * widget manifest would ship — and `validateChartProps` interprets exactly the
 * keywords this schema uses (`type`, `properties`, `required`, `items`,
 * `enum`, `minItems`, `minimum`).
 *
 * Why a hand-rolled walk instead of a full validator (ajv): the dashboard keeps
 * its widget bundle dependency-free (the signed-supply-chain OSS ethos — every
 * added runtime dep is surface), and this schema's keyword set is small and
 * fixed. A production host validating arbitrary third-party widget schemas would
 * pin a hardened validator; the rationale is expanded in the PR.
 */

/** A minimal JSON-Schema node — only the keywords `CHART_PROPS_SCHEMA` uses. */
export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minItems?: number;
  readonly minimum?: number;
}

/** The two chart presentations the widget can draw. */
export const CHART_KINDS = ['bar', 'line'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** One labelled datum in a chart series. */
export interface ChartPoint {
  readonly label: string;
  readonly value: number;
}

/** The validated chart props (the widget's `settings` after a successful validation). */
export interface ChartProps {
  readonly title?: string;
  readonly kind?: ChartKind;
  readonly unit?: string;
  readonly series: readonly ChartPoint[];
}

/** The chart's props schema — the contract its `settings` are validated against. */
export const CHART_PROPS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    kind: { type: 'string', enum: [...CHART_KINDS] },
    unit: { type: 'string' },
    series: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['label', 'value'],
      },
    },
  },
  required: ['series'],
};

/** The outcome of validating a value against a schema. */
export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

/** The JavaScript `typeof`/shape name for a JSON-Schema `type`, for error messages + checks. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/** Whether `value` satisfies a schema `type` (integer counts as number). */
function matchesType(value: unknown, type: NonNullable<JsonSchema['type']>): boolean {
  const actual = jsonTypeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'integer') return actual === 'integer';
  return actual === type;
}

/** Validate `value` against `schema`, collecting every failure with a JSON-path-ish location. */
function validateNode(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${jsonTypeOf(value)}`);
    return; // A wrong type makes deeper checks meaningless.
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
  }
  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in object) validateNode(object[key], child, `${path}/${key}`, errors);
    }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateNode(item, schema.items!, `${path}/${index}`, errors));
    }
  }
}

/**
 * Validate raw widget `settings` against {@link CHART_PROPS_SCHEMA}. On success
 * the caller may treat the value as {@link ChartProps}; on failure it gets the
 * list of human-readable violations to surface (the widget shows them rather
 * than crashing — the crasher is a separate widget).
 */
export function validateChartProps(settings: unknown): ValidationResult {
  const errors: string[] = [];
  validateNode(settings, CHART_PROPS_SCHEMA, '(root)', errors);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
