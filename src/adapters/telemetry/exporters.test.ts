import { describe, expect, it, vi } from 'vitest';
import type { WidgetErrorEvent, WidgetLatencyEvent } from '@gridmason/core/canvas';
import type { WidgetID } from '@gridmason/protocol';
import type { WidgetMarkEvent } from './events';
import {
  consoleExporter,
  createOtlpExporter,
  summarize,
  TELEMETRY_PREFIX,
  toOtlpPayload,
  type ConsoleLike,
  type OtlpLogsPayload,
} from './exporters';

const WIDGET: WidgetID = { source: 'local', tag: 'gm-laggard-widget' };

const latencyExceeded: WidgetLatencyEvent = {
  type: 'widget.latency',
  instanceId: 'slow',
  widgetID: WIDGET,
  phase: 'exceeded',
  elapsedMs: 1500,
  budgetMs: 1500,
  exceeded: true,
};

const widgetError: WidgetErrorEvent = {
  type: 'widget.error',
  instanceId: 'crash',
  widgetID: WIDGET,
  reason: 'threw',
  message: 'boom',
};

const mark: WidgetMarkEvent = {
  type: 'widget.mark',
  instanceId: 'w1',
  widgetID: WIDGET,
  name: 'first-paint',
  ms: 12,
};

function fakeConsole(): ConsoleLike & {
  errors: string[];
  warns: string[];
  infos: string[];
} {
  const errors: string[] = [];
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    warns,
    infos,
    error: (...a) => errors.push(String(a[0])),
    warn: (...a) => warns.push(String(a[0])),
    info: (...a) => infos.push(String(a[0])),
  };
}

describe('summarize', () => {
  it('names the auto-degrade on a latency breach, attributed to the instance', () => {
    expect(summarize(latencyExceeded)).toContain('local/gm-laggard-widget#slow');
    expect(summarize(latencyExceeded)).toContain('auto-degraded');
  });

  it('names the reason on a boundary error', () => {
    expect(summarize(widgetError)).toContain('widget.error');
    expect(summarize(widgetError)).toContain('(threw)');
    expect(summarize(widgetError)).toContain('boom');
  });
});

describe('consoleExporter', () => {
  it('routes severity: error → error(), latency breach → warn(), mark → info()', () => {
    const sink = fakeConsole();
    const exporter = consoleExporter(sink);
    exporter.export(widgetError);
    exporter.export(latencyExceeded);
    exporter.export(mark);
    expect(sink.errors).toHaveLength(1);
    expect(sink.warns).toHaveLength(1);
    expect(sink.infos).toHaveLength(1);
    expect(sink.errors[0]).toContain(TELEMETRY_PREFIX);
  });

  it('never throws when the console itself throws', () => {
    const exporter = consoleExporter({
      error() {
        throw new Error('console down');
      },
      warn() {},
      info() {},
    });
    expect(() => exporter.export(widgetError)).not.toThrow();
  });
});

describe('toOtlpPayload', () => {
  it('maps a latency breach to a WARN OTLP log record with attribution attributes', () => {
    const payload = toOtlpPayload(latencyExceeded, 'gridmason-dashboard', '42');
    const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
    expect(record.severityText).toBe('WARN');
    expect(record.severityNumber).toBe(13);
    expect(record.timeUnixNano).toBe('42');
    const keys = new Map(record.attributes.map((a) => [a.key, a.value.stringValue]));
    expect(keys.get('gm.event.type')).toBe('widget.latency');
    expect(keys.get('gm.instance_id')).toBe('slow');
    expect(keys.get('gm.widget.tag')).toBe('gm-laggard-widget');
    expect(keys.get('gm.exceeded')).toBe('true');
    expect(payload.resourceLogs[0]!.resource.attributes[0]!.value.stringValue).toBe('gridmason-dashboard');
  });
});

describe('createOtlpExporter', () => {
  it('sends one payload per event through the injected transport', () => {
    const sent: { endpoint: string; payload: OtlpLogsPayload }[] = [];
    const exporter = createOtlpExporter({
      endpoint: 'https://collector.example',
      send: (endpoint, payload) => sent.push({ endpoint, payload }),
      nowNs: () => '7',
    });
    exporter.export(widgetError);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe('https://collector.example');
    expect(sent[0]!.payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.severityText).toBe('ERROR');
  });

  it('swallows a transport that throws', () => {
    const send = vi.fn(() => {
      throw new Error('network down');
    });
    const exporter = createOtlpExporter({ endpoint: 'https://x', send });
    expect(() => exporter.export(mark)).not.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });
});
