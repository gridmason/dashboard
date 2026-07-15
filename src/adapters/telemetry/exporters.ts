/**
 * Telemetry exporters (docs/SPEC.md §6 "console/OTLP exporter", FR-15).
 *
 * An {@link TelemetryExporter} is the sink one attributed {@link
 * DashboardTelemetryEvent} is shipped to. Two ship in-repo behind the one
 * interface, per the adapter table:
 *
 * - {@link consoleExporter} — the default. Writes a structured, greppable line to
 *   the console at the event's severity, so a deployed dashboard surfaces a
 *   degrade/breach/error in its devtools console with no backend.
 * - {@link createOtlpExporter} — maps each event to a minimal **OTLP log record**
 *   and hands it to an injectable `send` transport (default `fetch` POST to an
 *   OTLP `/v1/logs` collector). Off unless explicitly constructed with an
 *   endpoint, so the dashboard makes no telemetry network call by default (SPEC §1
 *   "core makes zero network calls" — the host's exporter is opt-in and never on
 *   the widget hot path).
 *
 * An exporter **must not throw back into the adapter**: a misbehaving sink can
 * never break widget rendering (SPEC §7). Both guard their own I/O.
 */

import {
  attributionOf,
  severityOf,
  type DashboardTelemetryEvent,
  type TelemetrySeverity,
} from './events';

/** A telemetry sink: records one attributed event. Must never throw. */
export interface TelemetryExporter {
  /** Record one event. Implementations swallow their own errors. */
  export(event: DashboardTelemetryEvent): void;
}

/** Stable prefix on console output, so a degrade/breach is greppable in logs and e2e. */
export const TELEMETRY_PREFIX = '[gridmason:telemetry]';

/** The console method for a severity — a slice of `console` so it is injectable for tests. */
export interface ConsoleLike {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
}

/** A one-line human summary of an event, for the console exporter and diagnostics. */
export function summarize(event: DashboardTelemetryEvent): string {
  const at = attributionOf(event);
  const who = at !== undefined ? ` ${at.widgetID.source}/${at.widgetID.tag}#${at.instanceId}` : '';
  switch (event.type) {
    case 'widget.error':
      return `widget.error${who} (${event.reason})${event.message !== undefined ? `: ${event.message}` : ''}`;
    case 'widget.latency':
      return event.exceeded
        ? `widget.latency${who} EXCEEDED budget ${event.budgetMs ?? event.elapsedMs}ms — auto-degraded`
        : `widget.latency${who} settled in ${event.elapsedMs}ms`;
    case 'widget.recovery':
      return `widget.recovery${who} (${event.reason} re-mounted)`;
    case 'canvas.interactive':
      return `canvas.interactive ${event.durationMs}ms (placed ${event.placedCount}, mounted ${event.mountedCount})`;
    case 'widget.mark':
      return `widget.mark${who} ${event.name}=${event.ms}ms`;
    case 'widget.reported-error':
      return `widget.reported-error${who}: ${event.error.message}`;
  }
}

/**
 * A console exporter (SPEC §6). Writes `summarize(event)` at the event's severity
 * with the {@link TELEMETRY_PREFIX}. `console` is injectable so a test can assert
 * output without spying on the global; the default is the real console.
 */
export function consoleExporter(sink: ConsoleLike = console): TelemetryExporter {
  const method: Record<TelemetrySeverity, (msg: string) => void> = {
    error: (msg) => sink.error(msg),
    warn: (msg) => sink.warn(msg),
    info: (msg) => sink.info(msg),
  };
  return {
    export(event) {
      try {
        method[severityOf(event)](`${TELEMETRY_PREFIX} ${summarize(event)}`);
      } catch {
        // A broken console must never break rendering (SPEC §7).
      }
    },
  };
}

/** OTLP severity numbers (spec §"Severity"): INFO=9, WARN=13, ERROR=17. */
const OTLP_SEVERITY_NUMBER: Record<TelemetrySeverity, number> = { info: 9, warn: 13, error: 17 };
const OTLP_SEVERITY_TEXT: Record<TelemetrySeverity, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

/** One OTLP key/value attribute (string value only — every attribute we emit is a string). */
interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}

/** A minimal OTLP `LogRecord` (the subset a collector needs to ingest an event). */
export interface OtlpLogRecord {
  readonly timeUnixNano: string;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly body: { readonly stringValue: string };
  readonly attributes: readonly OtlpAttribute[];
}

/** The OTLP `resourceLogs` envelope one record is wrapped in for `POST /v1/logs`. */
export interface OtlpLogsPayload {
  readonly resourceLogs: readonly {
    readonly resource: { readonly attributes: readonly OtlpAttribute[] };
    readonly scopeLogs: readonly { readonly logRecords: readonly OtlpLogRecord[] }[];
  }[];
}

function attr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

/** Event-specific OTLP attributes (attribution + the event's numeric fields). */
function eventAttributes(event: DashboardTelemetryEvent): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [attr('gm.event.type', event.type)];
  const at = attributionOf(event);
  if (at !== undefined) {
    attrs.push(attr('gm.instance_id', at.instanceId));
    attrs.push(attr('gm.widget.source', at.widgetID.source));
    attrs.push(attr('gm.widget.tag', at.widgetID.tag));
  }
  switch (event.type) {
    case 'widget.error':
      attrs.push(attr('gm.reason', event.reason));
      break;
    case 'widget.latency':
      attrs.push(attr('gm.latency_ms', String(event.elapsedMs)));
      attrs.push(attr('gm.exceeded', String(event.exceeded)));
      break;
    case 'canvas.interactive':
      attrs.push(attr('gm.duration_ms', String(event.durationMs)));
      break;
    case 'widget.mark':
      attrs.push(attr('gm.mark.name', event.name));
      attrs.push(attr('gm.mark_ms', String(event.ms)));
      break;
    case 'widget.recovery':
    case 'widget.reported-error':
      break;
  }
  return attrs;
}

/**
 * Build the OTLP `/v1/logs` payload for one event — the pure mapping, exported so
 * it is unit-testable without any transport. `nowNs` is injectable so a test gets
 * a deterministic timestamp.
 */
export function toOtlpPayload(
  event: DashboardTelemetryEvent,
  serviceName: string,
  nowNs: string,
): OtlpLogsPayload {
  const severity = severityOf(event);
  return {
    resourceLogs: [
      {
        resource: { attributes: [attr('service.name', serviceName)] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: nowNs,
                severityNumber: OTLP_SEVERITY_NUMBER[severity],
                severityText: OTLP_SEVERITY_TEXT[severity],
                body: { stringValue: summarize(event) },
                attributes: eventAttributes(event),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Ships one OTLP payload to a collector. Injectable so the exporter is testable offline. */
export type OtlpSend = (endpoint: string, payload: OtlpLogsPayload) => void;

/** Options for {@link createOtlpExporter}. */
export interface OtlpExporterOptions {
  /** The collector base URL; `/v1/logs` is appended. Required — the exporter is off without it. */
  readonly endpoint: string;
  /** `service.name` resource attribute. Defaults to `gridmason-dashboard`. */
  readonly serviceName?: string;
  /** The transport; defaults to a best-effort `fetch` POST. */
  readonly send?: OtlpSend;
  /** Nanosecond clock; defaults to `Date.now() * 1e6`. Injectable for tests. */
  readonly nowNs?: () => string;
}

/** The default transport: a fire-and-forget `fetch` POST that swallows its own failure. */
const fetchSend: OtlpSend = (endpoint, payload) => {
  try {
    void fetch(`${endpoint.replace(/\/$/, '')}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Telemetry delivery is best-effort; a failed POST must never surface.
    });
  } catch {
    // `fetch` unavailable / threw synchronously — drop the record silently.
  }
};

/**
 * An OTLP log exporter (SPEC §6). Maps each event to an OTLP log record and sends
 * it to the configured collector. Opt-in: construct it only when an endpoint is
 * set (see {@link resolveExporters}); it never throws back into the adapter.
 */
export function createOtlpExporter(options: OtlpExporterOptions): TelemetryExporter {
  const serviceName = options.serviceName ?? 'gridmason-dashboard';
  const send = options.send ?? fetchSend;
  const nowNs = options.nowNs ?? (() => String(Date.now() * 1_000_000));
  return {
    export(event) {
      try {
        send(options.endpoint, toOtlpPayload(event, serviceName, nowNs()));
      } catch {
        // A broken transport must never break rendering (SPEC §7).
      }
    },
  };
}
