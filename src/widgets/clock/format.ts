/**
 * Pure time formatting for the clock demo widget — no DOM, no element, so it is
 * unit-testable under Node (the widget's render just wraps this).
 */

/** The clock's validated, defaulted display options, derived from its `settings`. */
export interface ClockOptions {
  /** 24-hour (`HH:MM`) or 12-hour (`h:MM AM/PM`) presentation. */
  readonly hour12: boolean;
  /** Whether to append seconds. */
  readonly showSeconds: boolean;
  /** IANA time-zone id, or `undefined` for the host's local zone. */
  readonly timeZone: string | undefined;
}

/**
 * Read a clock's display options off its raw `settings` object, defaulting every
 * field so a widget with no (or partial, or malformed) settings still renders a
 * sensible clock. `format: '12h'` selects 12-hour; anything else is 24-hour. An
 * unusable `timeZone` is dropped here so {@link formatClock} never throws on it.
 */
export function readClockOptions(settings: Readonly<Record<string, unknown>>): ClockOptions {
  const hour12 = settings.format === '12h';
  const showSeconds = settings.showSeconds === true;
  const timeZone =
    typeof settings.timeZone === 'string' && isUsableTimeZone(settings.timeZone)
      ? settings.timeZone
      : undefined;
  return { hour12, showSeconds, timeZone };
}

/** Whether `Intl` accepts `timeZone` — a bad id would otherwise throw at format time. */
function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format `date` per the clock's {@link ClockOptions}. Uses `Intl.DateTimeFormat`
 * so 12/24-hour, seconds, and time zone all resolve through one locale-aware
 * path; the fixed `en-US` locale keeps the AM/PM wording deterministic for the
 * unit tests while still honouring the requested zone.
 */
export function formatClock(date: Date, options: ClockOptions): string {
  const format = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    ...(options.showSeconds ? { second: '2-digit' } : {}),
    hour12: options.hour12,
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  });
  return format.format(date);
}
