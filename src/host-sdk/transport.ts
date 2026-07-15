/**
 * The reference host's **outbound transport** seam (docs/SPEC.md §2, §6). The
 * enforcing handle (`reference-host.ts`) runs the `min(user, widget)` gate and
 * stamps the per-instance identity *before* handing a call here; a transport
 * only carries the already-checked, already-stamped call to wherever the host
 * keeps its data. Splitting it out lets the same enforcing handle drive
 * different backings without a widget-ABI change:
 *
 * - the conformance kit and unit tests inject an in-memory transport that records
 *   the stamped identity and returns fixture data (no server needed);
 * - the dashboard canvas uses {@link LocalDemoTransport} — the Phase-B analog of
 *   the Phase-A fixture host, serving demo records straight from the ref so the
 *   showcase renders without a record store — while the *server*'s capability
 *   enforcement (instance-token → `(user, widget)`, `min` re-check) is exercised
 *   end to end by the demo API's own tests (`server/`, this issue).
 *
 * Every method receives the {@link TransportHeaders} the handle already stamped
 * with the instance token (records channel) or a {@link ScopedRequest} already
 * carrying it (net channel) — so "the token rides every outbound call" holds
 * whatever the transport does with it.
 */

import type {
  Patch,
  QuerySpec,
  ReadOptions,
  RecordData,
  RecordRef,
  ScopedRequest,
  ScopedResponse,
  TransportHeaders,
} from '@gridmason/sdk';

/** The records/net send seam behind the enforcing handle. */
export interface OutboundTransport {
  /** Send a checked+stamped `records.read`. */
  read(ref: RecordRef, opts: ReadOptions | undefined, headers: TransportHeaders): Promise<RecordData>;
  /** Send a checked+stamped `records.query`. */
  query(spec: QuerySpec, headers: TransportHeaders): Promise<RecordData[]>;
  /** Send a checked+stamped `records.write`. */
  write(ref: RecordRef, patch: Patch, headers: TransportHeaders): Promise<RecordData>;
  /** Send a checked+stamped `net.fetch`; `request` already carries the identity header. */
  fetch(request: ScopedRequest): Promise<ScopedResponse>;
}

/** Build a DOM-free {@link ScopedResponse} over an already-materialized body. */
export function scopedResponse(status: number, body: string, headers: Record<string, string> = {}): ScopedResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    async json<T = unknown>(): Promise<T> {
      return JSON.parse(body === '' ? 'null' : body) as T;
    },
    async text(): Promise<string> {
      return body;
    },
  };
}

/** The demo record fields served for one ref — generic, host-agnostic, id-bearing. */
function demoFields(ref: RecordRef): Readonly<Record<string, unknown>> {
  return {
    name: `Demo ${ref.recordType} ${ref.id}`,
    recordType: ref.recordType,
    id: ref.id,
    summary: `Reference-host record served for ${ref.recordType} ${ref.id} (SPEC §6).`,
  };
}

/**
 * The dashboard canvas transport: serves a synthesized demo record for any granted
 * ref (the gate already ran, so anything reaching here is permitted), and an OK,
 * empty-body response for a granted `net.fetch`. It is the reference showcase
 * backing — the honest analog of the Phase-A fixture host — not the security
 * boundary; the server's own enforcement is what the §3 claims are proven against.
 */
export class LocalDemoTransport implements OutboundTransport {
  async read(ref: RecordRef): Promise<RecordData> {
    return { ref, fields: demoFields(ref) };
  }

  async query(spec: QuerySpec): Promise<RecordData[]> {
    const ref: RecordRef = { recordType: spec.recordType, id: `${spec.recordType}-demo` };
    return [{ ref, fields: demoFields(ref) }];
  }

  async write(ref: RecordRef, patch: Patch): Promise<RecordData> {
    return { ref, fields: { ...demoFields(ref), ...patch } };
  }

  async fetch(request: ScopedRequest): Promise<ScopedResponse> {
    return scopedResponse(200, '', { 'x-gridmason-demo-host': request.host });
  }
}
