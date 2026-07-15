/**
 * The host-mediated cross-widget event bus (docs/SPEC.md §3 rule 4). The bus is
 * **same-document, in-memory, and owned by the host** — never a shared global:
 * one instance is created per host (a page) and shared across that page's mounts,
 * so two co-mounted widgets communicate *through* the host, and a widget that
 * bypasses the SDK has no bus to reach.
 *
 * The bus itself does **no** capability gating — that is the handle's job (rule 4
 * is enforced in `reference-host.ts` before it ever calls the bus, so a denied
 * emit/subscribe never touches the bus and cannot leak). The bus only routes a
 * delivered payload to the subscribers of the **exact** typed topic `(ns, name)`;
 * a same-namespace different-name topic reaches no one, which is what makes a
 * denial "no delivery" rather than a topic-name collision.
 */

import type { TypedTopic } from '@gridmason/sdk';

/** A registered subscriber, keyed by the exact `(ns, name)` topic it listens on. */
type Handler = (payload: unknown) => void;

/** The exact-topic routing key: namespace and name joined unambiguously. */
function topicKey(topic: TypedTopic<unknown>): string {
  // ` ` cannot appear in a capability namespace or a topic name, so it is a
  // safe separator — `{ns:'a', name:'b.c'}` never collides with `{ns:'a.b', name:'c'}`.
  return `${topic.ns} ${topic.name}`;
}

/** The host-owned in-memory typed event bus (one per host, shared across its mounts). */
export class HostEventBus {
  readonly #handlers = new Map<string, Set<Handler>>();

  /**
   * Register `handler` for the exact topic. Returns a release function; calling it
   * removes exactly this registration (idempotent). The host also releases every
   * registration on unmount — see `reference-host.ts` (rule 6).
   */
  subscribe<T>(topic: TypedTopic<T>, handler: (payload: T) => void): () => void {
    const key = topicKey(topic);
    let set = this.#handlers.get(key);
    if (set === undefined) {
      set = new Set();
      this.#handlers.set(key, set);
    }
    const wrapped: Handler = (payload) => handler(payload as T);
    set.add(wrapped);
    return () => {
      const current = this.#handlers.get(key);
      if (current === undefined) return;
      current.delete(wrapped);
      if (current.size === 0) this.#handlers.delete(key);
    };
  }

  /**
   * Deliver `payload` to every subscriber of the **exact** topic, synchronously.
   * Routed by `(ns, name)` — a different name in the same namespace reaches no one.
   * A throwing handler is isolated: its error is swallowed so one misbehaving
   * subscriber cannot break cross-widget delivery to the others (the bus is a
   * host-mediated boundary, not a shared global that propagates faults).
   */
  emit<T>(topic: TypedTopic<T>, payload: T): void {
    const set = this.#handlers.get(topicKey(topic));
    if (set === undefined) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch {
        // Isolate a faulting subscriber — delivery to the rest must not be denied.
      }
    }
  }
}
