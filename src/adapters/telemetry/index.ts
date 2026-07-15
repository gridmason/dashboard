/**
 * The dashboard telemetry adapter (docs/SPEC.md §3, §6, §7, FR-15/FR-16) — the
 * host sink for per-widget error/latency attribution and canvas p95, with a
 * console + OTLP exporter and the pure budget/auto-degrade decision layer.
 *
 * Wire it in `CanvasHost`: construct one {@link DashboardTelemetry}, bind
 * {@link DashboardTelemetry.widgetTelemetry} / {@link DashboardTelemetry.perfTelemetry}
 * onto the `PageCanvas`, set `latencyBudgetMs` = {@link WIDGET_LATENCY_BUDGET_MS}
 * + `autoDegradeOnLatency`, and hand {@link DashboardTelemetry.hostTelemetryFor}
 * to each reference mount's `sdk.telemetry`.
 */

export {
  BudgetMonitor,
  CANVAS_INTERACTIVE_BUDGET_MS,
  WIDGET_LATENCY_BUDGET_MS,
  evaluateBudget,
  type BudgetDecision,
  type DegradeReason,
  type FlaggedInstance,
} from './budget';
export {
  attributionOf,
  severityOf,
  type CanvasInteractiveEvent,
  type DashboardTelemetryEvent,
  type TelemetrySeverity,
  type WidgetBoundaryEvent,
  type WidgetMarkEvent,
  type WidgetReportedErrorEvent,
} from './events';
export {
  consoleExporter,
  createOtlpExporter,
  summarize,
  toOtlpPayload,
  TELEMETRY_PREFIX,
  type ConsoleLike,
  type OtlpExporterOptions,
  type OtlpLogsPayload,
  type OtlpSend,
  type TelemetryExporter,
} from './exporters';
export {
  DashboardTelemetry,
  resolveExporters,
  type CanvasPerfTelemetrySink,
  type DashboardTelemetryOptions,
  type DegradeListener,
  type HostInstanceTelemetry,
  type TelemetryConfig,
  type WidgetTelemetrySink,
} from './adapter';
