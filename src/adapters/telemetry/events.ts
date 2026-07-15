/**
 * The dashboard's unified telemetry event model (docs/SPEC.md §2, §3, §7, FR-15).
 *
 * One host adapter records every attributed signal the app raises, so a single
 * exporter (console/OTLP) sees one shape (SPEC §6 "console/OTLP exporter"). The
 * union folds together the events from three producers, each already
 * widget-attributed at its source:
 *
 * - **core's per-widget error boundary** — `widget.error`, `widget.latency`,
 *   `widget.recovery` ({@link WidgetBoundaryEvent}); the boundary stamps the
 *   `(instanceId, widgetID)` before it emits (`@gridmason/core/canvas`).
 * - **core's canvas perf marker** — `canvas.interactive` (the p95 measurement,
 *   {@link CanvasInteractiveEvent}).
 * - **the widget itself via the SDK** — `widget.mark` / `widget.reported-error`,
 *   produced when a widget calls `sdk.telemetry.mark(name, ms)` / `.error(e)`. The
 *   reference host reads the handle's per-instance `identity` (SPEC §3 rule 5) and
 *   stamps it here, so a widget author never hand-threads attribution — the same
 *   attribution the `@gridmason/sdk` `attributeTelemetry` helper makes explicit
 *   widget-side, closed on the host side.
 *
 * Every event carries `(instanceId, widgetID)` (or is page-level, for
 * `canvas.interactive`), so the exporter never has to reconstruct attribution.
 * The types are imported **type-only** from core (DOM-free declaration modules),
 * so this module stays node-safe and adds no runtime canvas dependency.
 */

import type { CanvasInteractiveEvent, WidgetBoundaryEvent } from '@gridmason/core/canvas';
import type { WidgetError } from '@gridmason/sdk';
import type { WidgetID } from '@gridmason/protocol';

export type { CanvasInteractiveEvent, WidgetBoundaryEvent } from '@gridmason/core/canvas';

/**
 * A latency mark a widget emitted through `sdk.telemetry.mark(name, ms)`, stamped
 * by the host with the mount's identity (SPEC §3 rule 5) — the host-side close of
 * the SDK's `AttributedMark`. The widget says *what* (`name`, `ms`); the host adds
 * *which mount* (`instanceId`, `widgetID`).
 */
export interface WidgetMarkEvent {
  readonly type: 'widget.mark';
  /** The emitting mount's per-instance id. */
  readonly instanceId: string;
  /** The emitting mount's `(source, tag)` widget identity. */
  readonly widgetID: WidgetID;
  /** The mark name, exactly as the widget passed it. */
  readonly name: string;
  /** The measured latency in milliseconds. */
  readonly ms: number;
}

/**
 * A runtime error a widget reported through `sdk.telemetry.error(e)`, stamped by
 * the host with the mount's identity — the host-side close of the SDK's
 * `AttributedError`. Distinct from a `widget.error` boundary event: this is the
 * widget *self-reporting* a failure it handled, not the boundary tripping.
 */
export interface WidgetReportedErrorEvent {
  readonly type: 'widget.reported-error';
  /** The reporting mount's per-instance id. */
  readonly instanceId: string;
  /** The reporting mount's `(source, tag)` widget identity. */
  readonly widgetID: WidgetID;
  /** The structured error the widget reported. */
  readonly error: WidgetError;
}

/**
 * Every telemetry event the dashboard adapter records: the core boundary events,
 * the canvas perf measurement, and the two widget-reported (SDK) events — one
 * discriminated union keyed on `type`, so an exporter `switch`es exhaustively.
 */
export type DashboardTelemetryEvent =
  | WidgetBoundaryEvent
  | CanvasInteractiveEvent
  | WidgetMarkEvent
  | WidgetReportedErrorEvent;

/** Severity buckets an exporter maps an event onto (OTLP severity / console method). */
export type TelemetrySeverity = 'error' | 'warn' | 'info';

/** The severity an event carries: a breach/error is `warn`/`error`, a measurement `info`. */
export function severityOf(event: DashboardTelemetryEvent): TelemetrySeverity {
  switch (event.type) {
    case 'widget.error':
    case 'widget.reported-error':
      return 'error';
    case 'widget.latency':
      return event.exceeded ? 'warn' : 'info';
    case 'canvas.interactive':
    case 'widget.mark':
    case 'widget.recovery':
      return 'info';
  }
}

/**
 * The `(instanceId, widgetID)` an event attributes to, or `undefined` for a
 * page-level event (`canvas.interactive`). The single place attribution is read
 * off the union, so exporters do not each re-narrow the type.
 */
export function attributionOf(
  event: DashboardTelemetryEvent,
): { readonly instanceId: string; readonly widgetID: WidgetID } | undefined {
  if (event.type === 'canvas.interactive') return undefined;
  return { instanceId: event.instanceId, widgetID: event.widgetID };
}
