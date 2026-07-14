import { describe, expect, it } from 'vitest';
import { validateChartProps, CHART_PROPS_SCHEMA } from './schema';

/** A minimal valid props object the chart can draw. */
const VALID = {
  kind: 'bar',
  series: [
    { label: 'A', value: 1 },
    { label: 'B', value: 2 },
  ],
};

describe('validateChartProps', () => {
  it('accepts a well-formed bar/line series', () => {
    expect(validateChartProps(VALID)).toEqual({ valid: true });
    expect(validateChartProps({ kind: 'line', series: [{ label: 'x', value: 0 }] })).toEqual({
      valid: true,
    });
  });

  it('accepts optional title and unit strings', () => {
    expect(validateChartProps({ ...VALID, title: 'Sales', unit: 'k' })).toEqual({ valid: true });
  });

  it('requires the series property', () => {
    const result = validateChartProps({ kind: 'bar' });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.join(' ')).toContain('series');
  });

  it('rejects an empty series (minItems)', () => {
    const result = validateChartProps({ series: [] });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.join(' ')).toContain('at least 1');
  });

  it('rejects a kind outside the enum', () => {
    const result = validateChartProps({ kind: 'pie', series: [{ label: 'a', value: 1 }] });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.join(' ')).toContain('kind');
  });

  it('rejects a non-numeric datum value with a located error', () => {
    const result = validateChartProps({ series: [{ label: 'a', value: 'high' }] });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.join(' ')).toContain('series/0/value');
  });

  it('rejects a datum missing its required label', () => {
    const result = validateChartProps({ series: [{ value: 3 }] });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.join(' ')).toContain('label');
  });

  it('rejects non-object settings', () => {
    expect(validateChartProps(null).valid).toBe(false);
    expect(validateChartProps([]).valid).toBe(false);
    expect(validateChartProps('nope').valid).toBe(false);
  });
});

describe('CHART_PROPS_SCHEMA', () => {
  it('is a JSON-Schema object requiring series', () => {
    expect(CHART_PROPS_SCHEMA.type).toBe('object');
    expect(CHART_PROPS_SCHEMA.required).toContain('series');
  });
});
