import {
  DEFAULT_PERIOD,
  PERIODS,
  axisLabel,
  localParts,
  parsePeriod,
  periodLong,
  previousLong,
  tooltipLabel,
} from './period';

describe('parsePeriod', () => {
  it('accepts every known period', () => {
    for (const p of PERIODS) expect(parsePeriod(p.id)).toBe(p.id);
  });

  it('falls back to the default for anything else (hand-edited URL)', () => {
    expect(parsePeriod('1y')).toBe(DEFAULT_PERIOD);
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod(['7d'])).toBe(DEFAULT_PERIOD);
  });
});

describe('period wording', () => {
  it('describes the window and the comparison', () => {
    expect(periodLong('30d')).toBe('Last 30 days');
    expect(previousLong('7d')).toBe('the 7 days before');
    expect(previousLong('today')).toBe('the same span yesterday');
    expect(previousLong('12m')).toBe('the 12 months before');
  });
});

describe('bucket labels', () => {
  // Europe/Prague in winter: the offset is in the string, the label must ignore the browser zone.
  const hour = '2026-11-14T13:00:00+01:00';
  const day = '2026-11-14T00:00:00+01:00';
  const month = '2026-11-01T00:00:00+01:00';

  it('reads the wall clock out of the ISO string', () => {
    expect(localParts(hour)).toEqual({ year: 2026, month: 11, day: 14, hour: 13, minute: 0 });
    expect(localParts('nonsense')).toBeNull();
  });

  it('labels the axis per bucket size', () => {
    expect(axisLabel(hour, 'hour')).toBe('13:00');
    expect(axisLabel(day, 'day')).toBe('14 Nov');
    expect(axisLabel(month, 'month')).toBe('Nov');
  });

  it('writes a fuller tooltip title with the weekday', () => {
    expect(tooltipLabel(hour, 'hour')).toBe('Sat 14 Nov, 13:00');
    expect(tooltipLabel(day, 'day')).toBe('Sat 14 Nov');
    expect(tooltipLabel(month, 'month')).toBe('November 2026');
  });

  it('keeps the local date across the DST switch (offset changes, wall clock does not)', () => {
    expect(axisLabel('2026-03-29T00:00:00+01:00', 'day')).toBe('29 Mar');
    expect(axisLabel('2026-03-30T00:00:00+02:00', 'day')).toBe('30 Mar');
  });
});
