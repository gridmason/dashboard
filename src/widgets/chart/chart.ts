/**
 * `gm-chart-widget` — the **settings-heavy** demo widget (docs/SPEC.md §4, §5).
 *
 * It validates its `settings` against a props JSON Schema (`schema.ts`) before
 * drawing, exercising the settings/props ABI surface: invalid props render an
 * explicit "invalid settings" panel listing the violations (not a crash — the
 * crasher is a separate widget), while valid props draw a bar or line chart.
 *
 * The chart is **inline SVG**, not a charting library: SVG is themeable straight
 * from CSS custom properties (`stroke`/`fill` reference the theme tokens),
 * renders as real DOM the Playwright suite can assert on, adds no runtime
 * dependency to the signed-supply-chain bundle, and is framework-agnostic. The
 * rejected alternatives (uPlot, Chart.js) and this rationale are in the PR.
 *
 * Same-document custom element; re-renders on `settings` changes.
 */

import { WIDGET_TAGS } from '../../boot/import-map';
import { readSettings, readStringProp } from '../abi';
import { validateChartProps, type ChartProps, type ChartKind } from './schema';
import { VIEWBOX, barLayout, linePoints } from './geometry';
import './chart.css';

/** The custom-element tag, sourced from the import map (`../../boot/import-map`). */
export const CHART_WIDGET_TAG = WIDGET_TAGS.chart;

/** Attributes that, when changed by the canvas, should re-validate + re-render. */
const OBSERVED = ['settings'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

class ChartWidget extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#render();
  }

  #render(): void {
    const settings = readSettings(this);
    const label = readStringProp(settings, 'label', '');

    this.replaceChildren();
    const card = this.ownerDocument.createElement('figure');
    card.className = 'gm-chart';

    const result = validateChartProps(settings);
    if (!result.valid) {
      card.append(this.#invalidPanel(label, result.errors));
      this.append(card);
      return;
    }

    // Validated: the settings object satisfies CHART_PROPS_SCHEMA.
    const props = settings as unknown as ChartProps;
    const heading = props.title ?? (label.length > 0 ? label : 'Chart');
    card.dataset.chartKind = props.kind ?? 'bar';
    card.append(this.#caption(heading, props.unit));
    card.append(this.#svg(props));
    this.append(card);
  }

  #caption(heading: string, unit: string | undefined): HTMLElement {
    const caption = this.ownerDocument.createElement('figcaption');
    caption.className = 'gm-chart__caption';
    caption.textContent = unit !== undefined ? `${heading} (${unit})` : heading;
    return caption;
  }

  /** Build the chart SVG for a bar or line series in the normalized viewBox. */
  #svg(props: ChartProps): SVGSVGElement {
    const svg = this.ownerDocument.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'gm-chart__svg');
    svg.setAttribute('viewBox', `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', this.#describeSeries(props));

    if ((props.kind ?? 'bar') === 'line') {
      this.#drawLine(svg, props);
    } else {
      this.#drawBars(svg, props);
    }
    return svg;
  }

  #drawBars(svg: SVGSVGElement, props: ChartProps): void {
    for (const bar of barLayout(props.series)) {
      const rect = this.ownerDocument.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'gm-chart__bar');
      rect.setAttribute('x', String(bar.x));
      rect.setAttribute('y', String(bar.y));
      rect.setAttribute('width', String(bar.width));
      rect.setAttribute('height', String(bar.height));
      const title = this.ownerDocument.createElementNS(SVG_NS, 'title');
      title.textContent = `${bar.point.label}: ${bar.point.value}`;
      rect.append(title);
      svg.append(rect);
    }
  }

  #drawLine(svg: SVGSVGElement, props: ChartProps): void {
    const line = this.ownerDocument.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('class', 'gm-chart__line');
    line.setAttribute('points', linePoints(props.series));
    line.setAttribute('fill', 'none');
    svg.append(line);
  }

  /** A text alternative for the chart (FR-9 / a11y): the series as label:value pairs. */
  #describeSeries(props: ChartProps): string {
    const kind = (props.kind ?? 'bar') as ChartKind;
    const points = props.series.map((point) => `${point.label} ${point.value}`).join(', ');
    return `${kind} chart: ${points}`;
  }

  /** The panel shown when settings fail schema validation — visible, not a crash. */
  #invalidPanel(label: string, errors: readonly string[]): HTMLElement {
    const panel = this.ownerDocument.createElement('div');
    panel.className = 'gm-chart__invalid';

    const title = this.ownerDocument.createElement('strong');
    title.className = 'gm-chart__invalid-title';
    title.textContent = label.length > 0 ? `${label}: invalid settings` : 'Invalid chart settings';
    panel.append(title);

    const list = this.ownerDocument.createElement('ul');
    list.className = 'gm-chart__invalid-list';
    for (const message of errors) {
      const item = this.ownerDocument.createElement('li');
      item.textContent = message;
      list.append(item);
    }
    panel.append(list);
    return panel;
  }
}

/** Register `<gm-chart-widget>` once; guarded for idempotent import-map loads. */
export function defineChartWidget(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(CHART_WIDGET_TAG) !== undefined) return;
  customElements.define(CHART_WIDGET_TAG, ChartWidget);
}

defineChartWidget();
