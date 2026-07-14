import { describe, expect, it } from 'vitest';
import { formatClock, readClockOptions } from './format';

/** A fixed instant: 2026-07-13T14:05:09Z. */
const INSTANT = new Date('2026-07-13T14:05:09Z');

describe('readClockOptions', () => {
  it('defaults to 24-hour, no seconds, local zone when settings are empty', () => {
    expect(readClockOptions({})).toEqual({ hour12: false, showSeconds: false, timeZone: undefined });
  });

  it('selects 12-hour only for the explicit `12h` format', () => {
    expect(readClockOptions({ format: '12h' }).hour12).toBe(true);
    expect(readClockOptions({ format: '24h' }).hour12).toBe(false);
    expect(readClockOptions({ format: 'nonsense' }).hour12).toBe(false);
  });

  it('honours a boolean showSeconds and drops an unusable time zone', () => {
    expect(readClockOptions({ showSeconds: true }).showSeconds).toBe(true);
    expect(readClockOptions({ showSeconds: 'yes' }).showSeconds).toBe(false);
    expect(readClockOptions({ timeZone: 'UTC' }).timeZone).toBe('UTC');
    expect(readClockOptions({ timeZone: 'Not/AZone' }).timeZone).toBeUndefined();
  });
});

describe('formatClock', () => {
  it('formats 24-hour time in a fixed zone', () => {
    expect(formatClock(INSTANT, { hour12: false, showSeconds: false, timeZone: 'UTC' })).toBe('14:05');
  });

  it('appends seconds when requested', () => {
    expect(formatClock(INSTANT, { hour12: false, showSeconds: true, timeZone: 'UTC' })).toBe('14:05:09');
  });

  it('formats 12-hour time with a meridiem', () => {
    expect(formatClock(INSTANT, { hour12: true, showSeconds: false, timeZone: 'UTC' })).toBe('02:05 PM');
  });
});
