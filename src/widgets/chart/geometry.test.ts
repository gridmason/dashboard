import { describe, expect, it } from 'vitest';
import { VIEWBOX, barLayout, linePoints, seriesMax } from './geometry';

const SERIES = [
  { label: 'A', value: 5 },
  { label: 'B', value: 10 },
];

describe('seriesMax', () => {
  it('is the largest value, floored at 1 so an all-zero series still scales', () => {
    expect(seriesMax(SERIES)).toBe(10);
    expect(seriesMax([{ label: 'z', value: 0 }])).toBe(1);
  });
});

describe('barLayout', () => {
  it('places one bar per datum, height proportional to seriesMax and baselined at zero', () => {
    const bars = barLayout(SERIES);
    expect(bars).toHaveLength(2);
    // The max-valued bar reaches full height and sits on the baseline.
    expect(bars[1].height).toBeCloseTo(VIEWBOX.height);
    expect(bars[1].y).toBeCloseTo(0);
    // The half-valued bar is half height, its top halfway down.
    expect(bars[0].height).toBeCloseTo(VIEWBOX.height / 2);
    expect(bars[0].y).toBeCloseTo(VIEWBOX.height / 2);
  });

  it('keeps bars within the viewBox width and carries the source datum', () => {
    for (const bar of barLayout(SERIES)) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(VIEWBOX.width + 1e-9);
      expect(bar.point.label).toMatch(/[AB]/);
    }
  });

  it('returns nothing for an empty series', () => {
    expect(barLayout([])).toEqual([]);
  });
});

describe('linePoints', () => {
  it('spans the viewBox with one vertex per datum', () => {
    const points = linePoints(SERIES).split(' ');
    expect(points).toHaveLength(2);
    expect(points[0]).toBe('0,50'); // first datum: x=0, y at half height
    expect(points[1]).toBe('100,0'); // last datum: x=full width, y at top (max)
  });

  it('centers a single datum', () => {
    expect(linePoints([{ label: 'x', value: 3 }])).toBe('50,0');
  });
});
