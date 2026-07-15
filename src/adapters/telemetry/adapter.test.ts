import { describe, expect, it, vi } from 'vitest';
import type { CanvasInteractiveEvent, WidgetLatencyEvent } from '@gridmason/core/canvas';
import type { WidgetID } from '@gridmason/protocol';
import type { DashboardTelemetryEvent } from './events';
import type { TelemetryExporter } from './exporters';
import { DashboardTelemetry, resolveExporters } from './adapter';

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

function recorder(): { exporter: TelemetryExporter; events: DashboardTelemetryEvent[] } {
  const events: DashboardTelemetryEvent[] = [];
  return { events, exporter: { export: (e) => events.push(e) } };
}

describe('DashboardTelemetry', () => {
  it('fans an event out to every exporter', () => {
    const a = recorder();
    const b = recorder();
    const telemetry = new DashboardTelemetry({ exporters: [a.exporter, b.exporter] });
    telemetry.record(latencyExceeded);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });

  it('feeds boundary events to the budget monitor and fires onDegrade for a breach', () => {
    const onDegrade = vi.fn();
    const telemetry = new DashboardTelemetry({ exporters: [], onDegrade });
    telemetry.record(latencyExceeded);
    expect(telemetry.monitor.isFlagged('slow')).toBe(true);
    expect(telemetry.monitor.reasonFor('slow')).toBe('latency-budget');
    expect(onDegrade).toHaveBeenCalledOnce();
    expect(onDegrade.mock.calls[0]![0]).toMatchObject({ instanceId: 'slow', reason: 'latency-budget' });
  });

  it('tracks a canvas p95 breach without firing onDegrade (no widget swapped)', () => {
    const onDegrade = vi.fn();
    const telemetry = new DashboardTelemetry({ exporters: [], onDegrade });
    const over: CanvasInteractiveEvent = {
      type: 'canvas.interactive',
      durationMs: 420,
      placedCount: 4,
      mountedCount: 4,
      virtualized: false,
    };
    telemetry.record(over);
    expect(telemetry.monitor.canvasBreached).toBe(true);
    expect(onDegrade).not.toHaveBeenCalled();
  });

  it('widgetTelemetry / perfTelemetry sinks record through the adapter', () => {
    const { exporter, events } = recorder();
    const telemetry = new DashboardTelemetry({ exporters: [exporter] });
    telemetry.widgetTelemetry(latencyExceeded);
    telemetry.perfTelemetry({
      type: 'canvas.interactive',
      durationMs: 100,
      placedCount: 1,
      mountedCount: 1,
      virtualized: false,
    });
    expect(events.map((e) => e.type)).toEqual(['widget.latency', 'canvas.interactive']);
  });

  it('hostTelemetryFor stamps identity onto widget-emitted marks and errors', () => {
    const { exporter, events } = recorder();
    const telemetry = new DashboardTelemetry({ exporters: [exporter] });
    const sink = telemetry.hostTelemetryFor({ instanceId: 'w9', widgetID: WIDGET });
    sink.mark('first-paint', 12);
    sink.error({ message: 'render failed', name: 'RangeError' });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'widget.mark',
      instanceId: 'w9',
      widgetID: WIDGET,
      name: 'first-paint',
      ms: 12,
    });
    expect(events[1]).toMatchObject({
      type: 'widget.reported-error',
      instanceId: 'w9',
      widgetID: WIDGET,
      error: { message: 'render failed' },
    });
  });

  it('hostTelemetryFor never throws even if an exporter throws', () => {
    const telemetry = new DashboardTelemetry({
      exporters: [
        {
          export() {
            throw new Error('sink down');
          },
        },
      ],
    });
    const sink = telemetry.hostTelemetryFor({ instanceId: 'w1', widgetID: WIDGET });
    expect(() => sink.mark('x', 1)).not.toThrow();
    expect(() => sink.error({ message: 'y' })).not.toThrow();
  });
});

describe('resolveExporters', () => {
  it('defaults to console only', () => {
    expect(resolveExporters()).toHaveLength(1);
    expect(resolveExporters({})).toHaveLength(1);
  });

  it('adds an OTLP exporter when an endpoint is configured', () => {
    expect(resolveExporters({ otlpEndpoint: 'https://collector' })).toHaveLength(2);
    expect(resolveExporters({ otlpEndpoint: '' })).toHaveLength(1);
  });
});
