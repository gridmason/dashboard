/**
 * The dashboard telemetry adapter (docs/SPEC.md §2, §3, §6, §7, FR-15) — the one
 * host sink every attributed signal flows through, and the host-side half of
 * auto-degrade.
 *
 * It does three jobs:
 * 1. **Fan out** each {@link DashboardTelemetryEvent} to every configured
 *    {@link TelemetryExporter} (console by default; OTLP when an endpoint is set).
 * 2. **Feed the {@link BudgetMonitor}** the boundary/perf events, so the flagged
 *    set (which widgets were auto-degraded) and the canvas p95 breach state stay
 *    current — the host-side flag core cannot own (SPEC §1).
 * 3. **Expose the sinks** the canvas and the reference host bind to: a
 *    {@link WidgetTelemetry} sink and a {@link CanvasPerfTelemetry} sink for the
 *    `PageCanvas`, and {@link hostTelemetryFor} for a reference mount's
 *    `sdk.telemetry` (stamping the mount's identity onto widget-emitted marks).
 *
 * It also implements core's narrow {@link TelemetryAdapter} (`record`), so the
 * same instance can back the widget catalog's refusal sink if a later epic wires
 * one. Nothing here touches the DOM or the network directly (the exporters own
 * their I/O), so the adapter is unit-testable under Node.
 */

import type { WidgetError } from '@gridmason/sdk';
import type { WidgetID } from '@gridmason/protocol';
import { BudgetMonitor, type BudgetDecision } from './budget';
import {
  type CanvasInteractiveEvent,
  type DashboardTelemetryEvent,
  type WidgetBoundaryEvent,
} from './events';
import { consoleExporter, createOtlpExporter, type TelemetryExporter } from './exporters';

/** A core-shaped per-widget telemetry sink (`@gridmason/core/canvas` `WidgetTelemetry`). */
export type WidgetTelemetrySink = (event: WidgetBoundaryEvent) => void;

/** A core-shaped canvas perf sink (`@gridmason/core/canvas` `CanvasPerfTelemetry`). */
export type CanvasPerfTelemetrySink = (event: CanvasInteractiveEvent) => void;

/**
 * The `sdk.telemetry` surface a reference mount forwards to: the widget calls
 * `mark`/`error` with no identity, the mount supplies its per-instance identity.
 * Matches the `HostSDK['telemetry']` shape so a reference mount can hand it
 * straight to the widget.
 */
export interface HostInstanceTelemetry {
  mark(name: string, ms: number): void;
  error(e: WidgetError): void;
}

/** Notified when the adapter decides a widget instance was auto-degraded (SPEC §3 flag). */
export type DegradeListener = (decision: BudgetDecision) => void;

/** Options for {@link DashboardTelemetry}. */
export interface DashboardTelemetryOptions {
  /** The exporters to fan out to; defaults to a single {@link consoleExporter}. */
  readonly exporters?: readonly TelemetryExporter[];
  /** The budget monitor to fold boundary/perf events into; defaults to a fresh one. */
  readonly monitor?: BudgetMonitor;
  /** Called on every event whose decision flags a widget as degraded (for UI wiring). */
  readonly onDegrade?: DegradeListener;
}

/**
 * The dashboard's telemetry adapter. Construct one per app (or per canvas host);
 * bind {@link widgetTelemetry} / {@link perfTelemetry} onto the `PageCanvas` and
 * hand {@link hostTelemetryFor} to each reference mount.
 */
export class DashboardTelemetry {
  readonly #exporters: readonly TelemetryExporter[];
  readonly #monitor: BudgetMonitor;
  readonly #onDegrade: DegradeListener | undefined;

  constructor(options: DashboardTelemetryOptions = {}) {
    this.#exporters = options.exporters ?? [consoleExporter()];
    this.#monitor = options.monitor ?? new BudgetMonitor();
    this.#onDegrade = options.onDegrade;
  }

  /** The budget monitor's flagged-set / canvas-breach state (read-only use). */
  get monitor(): BudgetMonitor {
    return this.#monitor;
  }

  /**
   * Record one event: feed the budget monitor (boundary/perf events only) and fan
   * out to every exporter. An exporter never throws (it guards its own I/O), but
   * we still isolate each so one bad sink cannot starve the others.
   */
  record(event: DashboardTelemetryEvent): void {
    if (isBudgetRelevant(event)) {
      const decision = this.#monitor.record(event);
      if (decision.degrade) this.#onDegrade?.(decision);
    }
    for (const exporter of this.#exporters) exporter.export(event);
  }

  /** The per-widget boundary telemetry sink to assign to `PageCanvas.telemetry`. */
  get widgetTelemetry(): WidgetTelemetrySink {
    return (event) => this.record(event);
  }

  /** The canvas perf sink to assign to `PageCanvas.perfTelemetry`. */
  get perfTelemetry(): CanvasPerfTelemetrySink {
    return (event) => this.record(event);
  }

  /**
   * The `sdk.telemetry` surface for one mount: a widget's `mark`/`error` are
   * stamped with `identity` (SPEC §3 rule 5) and recorded as `widget.mark` /
   * `widget.reported-error`. Never throws — telemetry must survive teardown so an
   * unmount-time error can still be reported (reference-host contract).
   */
  hostTelemetryFor(identity: { readonly instanceId: string; readonly widgetID: WidgetID }): HostInstanceTelemetry {
    const { instanceId, widgetID } = identity;
    return {
      mark: (name, ms) => {
        try {
          this.record({ type: 'widget.mark', instanceId, widgetID, name, ms });
        } catch {
          /* telemetry must never throw into widget code */
        }
      },
      error: (error) => {
        try {
          this.record({ type: 'widget.reported-error', instanceId, widgetID, error });
        } catch {
          /* telemetry must never throw into widget code */
        }
      },
    };
  }

  /** Drop the monitor's flagged/canvas state (a page teardown / new layout). */
  reset(): void {
    this.#monitor.reset();
  }
}

/** Whether an event feeds the budget monitor (a boundary or canvas-perf event). */
function isBudgetRelevant(
  event: DashboardTelemetryEvent,
): event is WidgetBoundaryEvent | CanvasInteractiveEvent {
  return (
    event.type === 'widget.error' ||
    event.type === 'widget.latency' ||
    event.type === 'widget.recovery' ||
    event.type === 'canvas.interactive'
  );
}

/**
 * The runtime telemetry config (SPEC §6, single-tenant GW-D21): read from the
 * build-time env so a deployment can point the OTLP exporter at its collector
 * without code changes. The console exporter is always on; OTLP is added only
 * when `GRIDMASON_OTLP_ENDPOINT` (exposed to the client as `VITE_GM_OTLP_ENDPOINT`)
 * is set — so the default build makes no telemetry network call.
 */
export interface TelemetryConfig {
  /** OTLP collector base URL; when set, an OTLP exporter is added alongside the console one. */
  readonly otlpEndpoint?: string | undefined;
}

/** Build the exporter list for a config: console always, OTLP when an endpoint is set. */
export function resolveExporters(config: TelemetryConfig = {}): TelemetryExporter[] {
  const exporters: TelemetryExporter[] = [consoleExporter()];
  if (config.otlpEndpoint !== undefined && config.otlpEndpoint !== '') {
    exporters.push(createOtlpExporter({ endpoint: config.otlpEndpoint }));
  }
  return exporters;
}
