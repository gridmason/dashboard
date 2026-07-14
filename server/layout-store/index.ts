/**
 * The reference persistence adapter's storage engine (FR-5, SPEC §6): a simple
 * key-value layout store keyed by `(scope|user, pageType, entityId?)`, holding
 * one {@link LayoutDoc} per key.
 *
 * Storage is in-memory with optional file backing (v0 choice — no database):
 * construct with a `filePath` and the map is loaded from that JSON file on
 * startup and rewritten on every mutation; construct without one and the store
 * is purely in-memory (what the tests use). Documents are deep-cloned in and
 * out so a caller can never mutate stored state through a shared reference.
 *
 * This issue stands up the store and its round-trippable read/write. The
 * copy-on-write / reset-to-default behaviour the dashboard layers on top of it
 * is D-E1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LayoutPage } from '@gridmason/protocol';

/**
 * A stored layout document. `LayoutDoc` is the spec's name for the current
 * ({@link LayoutPage}, schema v1) layout contract from `@gridmason/protocol`.
 */
export type LayoutDoc = LayoutPage;

/**
 * The store key. `scope` is the owner slot the FR writes as `scope|user`: a user
 * identity (`user:<id>`) or a shared scope (e.g. `org`). The store treats it as
 * an opaque string. `entityId` is present only for entity-scoped page types.
 */
export interface LayoutKey {
  readonly scope: string;
  readonly pageType: string;
  readonly entityId?: string;
}

/** On-disk serialization: a flat list of key + document entries. */
interface LayoutFile {
  readonly version: 1;
  readonly entries: readonly (LayoutKey & { readonly doc: LayoutDoc })[];
}

/** NUL-separated composite key — the separator cannot appear in a path segment. */
function keyString(key: LayoutKey): string {
  return `${key.scope}\u0000${key.pageType}\u0000${key.entityId ?? ''}`;
}

export class LayoutStore {
  readonly #byKey = new Map<string, LayoutKey & { doc: LayoutDoc }>();
  readonly #filePath: string | undefined;

  constructor(options: { readonly filePath?: string } = {}) {
    this.#filePath = options.filePath;
    if (this.#filePath !== undefined) {
      this.#load(this.#filePath);
    }
  }

  /** The document stored at `key`, or `undefined` if none. Returns a deep copy. */
  get(key: LayoutKey): LayoutDoc | undefined {
    const entry = this.#byKey.get(keyString(key));
    return entry === undefined ? undefined : structuredClone(entry.doc);
  }

  /** Store `doc` at `key` (overwriting any existing document), then persist. */
  put(key: LayoutKey, doc: LayoutDoc): void {
    const stored: LayoutKey & { doc: LayoutDoc } = {
      scope: key.scope,
      pageType: key.pageType,
      doc: structuredClone(doc),
      ...(key.entityId !== undefined ? { entityId: key.entityId } : {}),
    };
    this.#byKey.set(keyString(key), stored);
    this.#persist();
  }

  /** Remove the document at `key`. Returns whether one was present. */
  delete(key: LayoutKey): boolean {
    const existed = this.#byKey.delete(keyString(key));
    if (existed) this.#persist();
    return existed;
  }

  /** Number of stored documents. */
  get size(): number {
    return this.#byKey.size;
  }

  #load(filePath: string): void {
    if (!existsSync(filePath)) return;
    let parsed: LayoutFile;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as LayoutFile;
    } catch (cause) {
      throw new Error(
        `Corrupt layout store file (${filePath}): ${(cause as Error).message}`,
      );
    }
    for (const entry of parsed.entries ?? []) {
      const key: LayoutKey = {
        scope: entry.scope,
        pageType: entry.pageType,
        ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
      };
      this.#byKey.set(keyString(key), { ...key, doc: entry.doc });
    }
  }

  #persist(): void {
    if (this.#filePath === undefined) return;
    const file: LayoutFile = {
      version: 1,
      entries: [...this.#byKey.values()],
    };
    mkdirSync(dirname(this.#filePath), { recursive: true });
    writeFileSync(this.#filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}

/**
 * Structural guard for a {@link LayoutDoc} on write. Deliberately shallow — it
 * checks the top-level shape of a current (v1) {@link LayoutPage} so a malformed
 * body is a 400, not corrupt stored state. Full contract validation and
 * migrate-on-read live in `@gridmason/protocol` / the host SDK.
 */
export function isLayoutDoc(value: unknown): value is LayoutDoc {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.page === 'string' &&
    typeof v.name === 'string' &&
    typeof v.default === 'boolean' &&
    typeof v.hasTabs === 'boolean' &&
    typeof v.grid === 'object' &&
    v.grid !== null &&
    Array.isArray((v.grid as Record<string, unknown>).items) &&
    Array.isArray(v.tabs)
  );
}
