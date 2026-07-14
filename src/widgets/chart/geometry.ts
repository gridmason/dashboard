/**
 * Pure chart geometry for the chart demo widget — maps a validated series to
 * SVG coordinates in a fixed `viewBox`. DOM-free and unit-testable; the widget
 * turns these numbers into `<rect>`/`<polyline>` elements.
 *
 * The chart draws in a normalized `VIEWBOX` (0..100 × 0..100) and is stretched to
 * the card by `preserveAspectRatio="none"`, so it fills any grid cell without the
 * widget measuring pixels. Bars/points scale to the series' maximum value (never
 * below 1, so an all-zero series still lays out), baselined at zero.
 */

import type { ChartPoint } from './schema';

/** The normalized SVG coordinate space the chart draws in. */
export const VIEWBOX = { width: 100, height: 100 } as const;

/** One bar's rectangle in {@link VIEWBOX} coordinates, plus its source datum. */
export interface BarRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly point: ChartPoint;
}

/** The scale a series is drawn against: its baseline-zero maximum. */
export function seriesMax(series: readonly ChartPoint[]): number {
  return Math.max(1, ...series.map((point) => Math.max(0, point.value)));
}

/**
 * Lay out a bar per datum across {@link VIEWBOX}, evenly spaced with a fixed gap
 * fraction between bars. Bar height is proportional to `value / seriesMax`.
 */
export function barLayout(series: readonly ChartPoint[], gap = 0.25): readonly BarRect[] {
  if (series.length === 0) return [];
  const max = seriesMax(series);
  const slot = VIEWBOX.width / series.length;
  const barWidth = slot * (1 - gap);
  const offset = (slot - barWidth) / 2;
  return series.map((point, index) => {
    const height = (Math.max(0, point.value) / max) * VIEWBOX.height;
    return {
      x: index * slot + offset,
      y: VIEWBOX.height - height,
      width: barWidth,
      height,
      point,
    };
  });
}

/**
 * The polyline points (`"x,y x,y …"`) for a line chart across {@link VIEWBOX},
 * one vertex per datum centered in its slot, scaled to `seriesMax`. A single
 * datum yields one centered point.
 */
export function linePoints(series: readonly ChartPoint[]): string {
  if (series.length === 0) return '';
  const max = seriesMax(series);
  const step = series.length === 1 ? 0 : VIEWBOX.width / (series.length - 1);
  return series
    .map((point, index) => {
      const x = series.length === 1 ? VIEWBOX.width / 2 : index * step;
      const y = VIEWBOX.height - (Math.max(0, point.value) / max) * VIEWBOX.height;
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

/** Trim float noise so the emitted SVG coordinates stay compact and stable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
