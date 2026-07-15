import { describe, expect, it } from 'vitest';
import type {
  CanvasInteractiveEvent,
  WidgetErrorEvent,
  WidgetLatencyEvent,
  WidgetRecoveryEvent,
} from '@gridmason/core/canvas';
import type { WidgetID } from '@gridmason/protocol';
import {
  BudgetMonitor,
  CANVAS_INTERACTIVE_BUDGET_MS,
  evaluateBudget,
  WIDGET_LATENCY_BUDGET_MS,
} from './budget';

const WIDGET: WidgetID = { source: 'local', tag: 'gm-laggard-widget' };

function latency(over: boolean, instanceId = 'w1'): WidgetLatencyEvent {
  return over
    ? {
        type: 'widget.latency',
        instanceId,
        widgetID: WIDGET,
        phase: 'exceeded',
        elapsedMs: WIDGET_LATENCY_BUDGET_MS,
        budgetMs: WIDGET_LATENCY_BUDGET_MS,
        exceeded: true,
      }
    : {
        type: 'widget.latency',
        instanceId,
        widgetID: WIDGET,
        phase: 'settled',
        elapsedMs: 12,
        exceeded: false,
      };
}

function widgetError(instanceId = 'w1'): WidgetErrorEvent {
  return { type: 'widget.error', instanceId, widgetID: WIDGET, reason: 'threw', message: 'boom' };
}

function recovery(instanceId = 'w1'): WidgetRecoveryEvent {
  return { type: 'widget.recovery', instanceId, widgetID: WIDGET, reason: 'unresolved' };
}

function canvas(durationMs: number): CanvasInteractiveEvent {
  return { type: 'canvas.interactive', durationMs, placedCount: 4, mountedCount: 4, virtualized: false };
}

describe('evaluateBudget (pure decision)', () => {
  it('degrades a widget that exceeded its latency budget, attributed to the instance', () => {
    const decision = evaluateBudget(latency(true, 'slow'));
    expect(decision).toEqual({
      breach: true,
      degrade: true,
      instanceId: 'slow',
      reason: 'latency-budget',
    });
  });

  it('degrades a widget whose boundary tripped (threw / load failure / reported)', () => {
    const decision = evaluateBudget(widgetError('crash'));
    expect(decision).toEqual({ breach: true, degrade: true, instanceId: 'crash', reason: 'error' });
  });

  it('does not degrade a widget that settled inside its budget', () => {
    expect(evaluateBudget(latency(false))).toEqual({ breach: false, degrade: false });
  });

  it('does not treat an unresolved-widget recovery as a breach', () => {
    expect(evaluateBudget(recovery())).toEqual({ breach: false, degrade: false });
  });

  it('flags a canvas p95 breach without degrading any single widget', () => {
    expect(evaluateBudget(canvas(CANVAS_INTERACTIVE_BUDGET_MS + 1))).toEqual({
      breach: true,
      degrade: false,
    });
    expect(evaluateBudget(canvas(CANVAS_INTERACTIVE_BUDGET_MS))).toEqual({
      breach: false,
      degrade: false,
    });
  });
});

describe('BudgetMonitor (flagged-set state)', () => {
  it('flags a budget-busting widget and attributes the reason to its instance', () => {
    const monitor = new BudgetMonitor();
    monitor.record(latency(true, 'slow'));
    expect(monitor.isFlagged('slow')).toBe(true);
    expect(monitor.reasonFor('slow')).toBe('latency-budget');
    expect(monitor.flagged()).toEqual([{ instanceId: 'slow', reason: 'latency-budget' }]);
  });

  it('flags an errored widget and de-duplicates repeated breaches', () => {
    const monitor = new BudgetMonitor();
    monitor.record(widgetError('crash'));
    monitor.record(widgetError('crash'));
    expect(monitor.flagged()).toEqual([{ instanceId: 'crash', reason: 'error' }]);
  });

  it('clears a flag when the instance recovers or later settles', () => {
    const monitor = new BudgetMonitor();
    monitor.record(latency(true, 'slow'));
    monitor.record(latency(false, 'slow'));
    expect(monitor.isFlagged('slow')).toBe(false);

    monitor.record(widgetError('unres'));
    monitor.record(recovery('unres'));
    expect(monitor.isFlagged('unres')).toBe(false);
  });

  it('tracks the canvas p95 breach state from the latest measurement', () => {
    const monitor = new BudgetMonitor();
    monitor.record(canvas(120));
    expect(monitor.canvasBreached).toBe(false);
    expect(monitor.lastCanvasMs).toBe(120);

    monitor.record(canvas(420));
    expect(monitor.canvasBreached).toBe(true);
    expect(monitor.lastCanvasMs).toBe(420);
  });

  it('reset drops every flag and canvas state', () => {
    const monitor = new BudgetMonitor();
    monitor.record(widgetError('crash'));
    monitor.record(canvas(420));
    monitor.reset();
    expect(monitor.flagged()).toEqual([]);
    expect(monitor.canvasBreached).toBe(false);
    expect(monitor.lastCanvasMs).toBeUndefined();
  });
});
