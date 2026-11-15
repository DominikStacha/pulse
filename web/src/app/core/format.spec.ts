import {
  countryName,
  delta,
  flag,
  formatAgo,
  formatAgoShort,
  formatBytes,
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSeconds,
} from './format';

describe('numbers', () => {
  it('groups thousands and survives missing values', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('shortens large axis values', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(12_300)).toBe('12.3K');
  });

  it('turns a fraction into a percent', () => {
    expect(formatPercent(0.4213)).toBe('42%');
    expect(formatPercent(0.4213, 1)).toBe('42.1%');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('never rounds a small but real share down to 0%', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.004)).toBe('<1%');
    expect(formatPercent(0.0004, 1)).toBe('<0.1%');
    expect(formatPercent(0.006)).toBe('1%');
  });
});

describe('formatSeconds (visit length)', () => {
  it('uses the most natural unit', () => {
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(48)).toBe('48s');
    expect(formatSeconds(134)).toBe('2m 14s');
    expect(formatSeconds(3900)).toBe('1h 05m');
    expect(formatSeconds(-1)).toBe('—');
  });
});

describe('delta', () => {
  it('reports rises and falls as whole percents', () => {
    expect(delta(150, 100)).toEqual({ direction: 'up', percent: 50 });
    expect(delta(75, 100)).toEqual({ direction: 'down', percent: 25 });
  });

  it('is flat for no change or a change that rounds to zero', () => {
    expect(delta(100, 100).direction).toBe('flat');
    expect(delta(1000, 1001).direction).toBe('flat');
    expect(delta(0, 0).direction).toBe('flat');
  });

  it('says "new" instead of an infinite percentage when there was nothing before', () => {
    expect(delta(12, 0)).toEqual({ direction: 'new', percent: null });
  });
});

describe('flag and country name', () => {
  it('builds the flag from an ISO-2 code, ignoring junk', () => {
    expect(flag('CZ')).toBe('🇨🇿');
    expect(flag('cz')).toBe('🇨🇿');
    expect(flag('XYZ')).toBe('');
    expect(flag(null)).toBe('');
  });

  it('names countries in English and falls back to the code', () => {
    expect(countryName('CZ')).toBe('Czechia');
    expect(countryName(null)).toBe('Unknown');
  });
});

describe('live feed ages', () => {
  it('stays "now" for the first few seconds, then counts up', () => {
    expect(formatAgoShort(2_000)).toBe('now');
    expect(formatAgoShort(12_000)).toBe('12s');
    expect(formatAgoShort(4 * 60_000)).toBe('4m');
    expect(formatAgoShort(3 * 3_600_000)).toBe('3h');
    expect(formatAgoShort(72 * 3_600_000)).toBe('3d');
  });
});

describe('status helpers (ported)', () => {
  it('formats bytes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GiB');
    expect(formatBytes(null)).toBe('—');
  });

  it('keeps durations to two units', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(3 * 86400 + 4 * 3600 + 17 * 60)).toBe('3d 4h');
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('writes relative ages', () => {
    expect(formatAgo(4_000)).toBe('4s ago');
    expect(formatAgo(-1)).toBe('—');
  });
});
