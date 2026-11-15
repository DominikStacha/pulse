import { breakdown } from './mock-data';

describe('mock breakdowns follow the real API', () => {
  it('the Sites shares add up to 1, for every period', () => {
    for (const period of ['today', '24h', '7d', '30d', '90d', '12m'] as const) {
      const { rows } = breakdown('all', period, 'sites', 8);
      const sum = rows.reduce((a, r) => a + r.share, 0);
      expect(sum, period).toBeCloseTo(1, 6);
    }
  });

  it('events are ranked by the count the panel shows', () => {
    const { rows } = breakdown('all', '7d', 'events', 8);
    const counts = rows.map((r) => r.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('other lists are ranked by visitors', () => {
    const { rows } = breakdown('all', '7d', 'pages', 8);
    const visitors = rows.map((r) => r.visitors);
    expect(visitors).toEqual([...visitors].sort((a, b) => b - a));
  });
});
