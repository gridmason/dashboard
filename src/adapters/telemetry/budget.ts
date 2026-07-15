/**
 * Perf budgets + the **auto-degrade decision** (docs/SPEC.md §3, §7, FR-15/FR-16).
 *
 * SPEC §7 sets two NFR budgets and §3 asks that a widget *exceeding* its budget be
 * "auto-degraded to fallback and flagged". This module is the **pure, DOM-free
 * decision layer** for that: it holds the budget numbers (one source of truth,
 * consumed by the canvas wiring *and* the CI perf gate) and the predicates that
 * turn a telemetry event into a degrade/flag decision. Keeping the decision here —
 * not inside the canvas glue — is what lets it be unit-tested under Node (no DOM,
 * no timers) while the canvas merely *applies* the outcome.
 *
 * The actual fallback swap is core's: `PageCanvas.autoDegradeOnLatency` +
 * `latencyBudgetMs` degrade a budget-busting widget to its error card, and the
 * boundary reports the breach as a `widget.latency` `exceeded` event
 * (`@gridmason/core/canvas`). This module decides, from that event stream, **which
 * instances are flagged** (so telemetry and the UI can surface "this widget was
 * degraded") and **whether the canvas itself blew its p95 budget** — the host-side
 * half of the contract core cannot own (core makes no network calls and holds no
 * host state, SPEC §1).
 *
 * The budgets:
 * - **Canvas interactive p95 < 300 ms** ({@link CANVAS_INTERACTIVE_BUDGET_MS}) —
 *   spec-stated (§7). Asserted against the `canvas.interactive` measurement.
 * - **Per-widget mount-to-interactive latency budget**
 *   ({@link WIDGET_LATENCY_BUDGET_MS}) — **not** spec-stated. A pending widget that
 *   never becomes interactive within this window is auto-degraded to its fallback
 *   (§3). 1500 ms is a deliberately generous default: a healthy widget settles far
 *   inside it (the demo widgets settle synchronously and never even arm the timer),
 *   so only a hung/broken remote trips it. Flagged as a judgment call in the PR.
 */

import type {
  CanvasInteractiveEvent,
  WidgetBoundaryEvent,
  WidgetErrorEvent,
  WidgetLatencyEvent,
} from '@gridmason/core/canvas';

/**
 * The p95 canvas-interactive budget in milliseconds (SPEC §7): from the resolved
 * layout (data) arriving to the grid becoming interactive. A `canvas.interactive`
 * measurement above this is a budget breach the CI perf gate fails on and the host
 * flags.
 */
export const CANVAS_INTERACTIVE_BUDGET_MS = 300;

/**
 * The per-widget mount-to-interactive latency budget in milliseconds (SPEC §3
 * auto-degrade). A widget that declared itself pending (`gm:loading`) and has not
 * become interactive within this window is auto-degraded to its fallback card.
 * Not spec-stated — a generous default so only a genuinely hung widget degrades;
 * see the module doc. Wired onto the canvas as `latencyBudgetMs`.
 */
export const WIDGET_LATENCY_BUDGET_MS = 1500;

/** Why an instance was flagged as degraded. Mirrors the boundary's failure vocabulary. */
export type DegradeReason =
  /** The widget exceeded its latency budget while pending and was degraded (SPEC §3). */
  | 'latency-budget'
  /** The widget threw / failed to load / reported an error — its boundary tripped. */
  | 'error';

/** The outcome of evaluating one telemetry event against the budgets. */
export interface BudgetDecision {
  /** Whether the event represents a budget breach (latency exceeded, error, or canvas over p95). */
  readonly breach: boolean;
  /**
   * Whether the event auto-degrades a **widget instance** to its fallback and flags
   * it. `true` only for a per-widget breach ({@link instanceId} is then set); a
   * canvas-level p95 breach is a `breach` but not a widget `degrade` (the page is
   * flagged, no single widget is swapped out).
   */
  readonly degrade: boolean;
  /** The degraded instance, when {@link degrade} is `true`. */
  readonly instanceId?: string;
  /** Why it degraded, when {@link degrade} is `true`. */
  readonly reason?: DegradeReason;
}

/** A widget-boundary latency event that breached its budget. */
function isLatencyBreach(event: WidgetBoundaryEvent): event is WidgetLatencyEvent {
  return event.type === 'widget.latency' && event.exceeded;
}

/** A widget-boundary error event (threw / unresolved / reported). */
function isWidgetError(event: WidgetBoundaryEvent): event is WidgetErrorEvent {
  return event.type === 'widget.error';
}

/**
 * Decide, purely, what a single boundary/perf telemetry event means for the
 * budgets. The DOM-free heart of auto-degrade: given the event core's boundary (or
 * the canvas perf marker) emitted, return whether it is a breach and whether a
 * widget instance should be flagged as degraded.
 *
 * - `widget.latency` with `exceeded` → the pending widget blew its latency budget:
 *   breach **and** degrade (core has already swapped it to the fallback; we flag it).
 * - `widget.error` → the boundary tripped (threw / load failure / reported): breach
 *   **and** degrade (the instance is in its fallback state).
 * - `widget.recovery` → an unresolved widget re-mounted: **not** a breach, and it
 *   clears any prior flag (handled by {@link BudgetMonitor}).
 * - `canvas.interactive` over {@link CANVAS_INTERACTIVE_BUDGET_MS} → a page-level
 *   p95 breach: breach, but **no** widget degrade (nothing is swapped out).
 */
export function evaluateBudget(
  event: WidgetBoundaryEvent | CanvasInteractiveEvent,
): BudgetDecision {
  if (event.type === 'canvas.interactive') {
    return { breach: event.durationMs > CANVAS_INTERACTIVE_BUDGET_MS, degrade: false };
  }
  if (isLatencyBreach(event)) {
    return { breach: true, degrade: true, instanceId: event.instanceId, reason: 'latency-budget' };
  }
  if (isWidgetError(event)) {
    return { breach: true, degrade: true, instanceId: event.instanceId, reason: 'error' };
  }
  // widget.latency `settled`, or widget.recovery — not a breach.
  return { breach: false, degrade: false };
}

/** A flagged (auto-degraded) widget instance and why. */
export interface FlaggedInstance {
  readonly instanceId: string;
  readonly reason: DegradeReason;
}

/**
 * Stateful budget monitor: folds a stream of boundary/perf telemetry events into
 * the **flagged set** — the widget instances currently degraded, and whether the
 * canvas last blew its p95 budget. Pure state (a `Map` + a boolean); no DOM, no
 * I/O — the telemetry adapter feeds it and the UI/telemetry read it.
 *
 * Flags are per-instance and idempotent: repeated breaches of the same instance
 * keep one flag; a `widget.recovery` (an unresolved widget that re-mounted) clears
 * its flag, and a `widget.latency` `settled` for a previously-flagged instance
 * clears it too (a manual retry that succeeded).
 */
export class BudgetMonitor {
  readonly #flagged = new Map<string, DegradeReason>();
  #canvasBreached = false;
  #lastCanvasMs: number | undefined;

  /** Ingest one event, updating the flagged set / canvas state. Returns the decision. */
  record(event: WidgetBoundaryEvent | CanvasInteractiveEvent): BudgetDecision {
    if (event.type === 'canvas.interactive') {
      this.#lastCanvasMs = event.durationMs;
      this.#canvasBreached = event.durationMs > CANVAS_INTERACTIVE_BUDGET_MS;
      return evaluateBudget(event);
    }
    // A recovered or freshly-settled instance is healthy again — clear any flag.
    if (event.type === 'widget.recovery') {
      this.#flagged.delete(event.instanceId);
      return evaluateBudget(event);
    }
    if (event.type === 'widget.latency' && !event.exceeded) {
      this.#flagged.delete(event.instanceId);
      return evaluateBudget(event);
    }
    const decision = evaluateBudget(event);
    if (decision.degrade && decision.instanceId !== undefined && decision.reason !== undefined) {
      this.#flagged.set(decision.instanceId, decision.reason);
    }
    return decision;
  }

  /** Whether `instanceId` is currently flagged as degraded. */
  isFlagged(instanceId: string): boolean {
    return this.#flagged.has(instanceId);
  }

  /** The reason `instanceId` is flagged, or `undefined` if it is not. */
  reasonFor(instanceId: string): DegradeReason | undefined {
    return this.#flagged.get(instanceId);
  }

  /** Every currently-flagged instance, for a host dashboard / test assertion. */
  flagged(): readonly FlaggedInstance[] {
    return [...this.#flagged].map(([instanceId, reason]) => ({ instanceId, reason }));
  }

  /** Whether the most recent canvas-interactive measurement blew the p95 budget. */
  get canvasBreached(): boolean {
    return this.#canvasBreached;
  }

  /** The most recent canvas-interactive measurement in ms, or `undefined` if none seen. */
  get lastCanvasMs(): number | undefined {
    return this.#lastCanvasMs;
  }

  /** Drop all flags and canvas state (a page teardown / new layout). */
  reset(): void {
    this.#flagged.clear();
    this.#canvasBreached = false;
    this.#lastCanvasMs = undefined;
  }
}
