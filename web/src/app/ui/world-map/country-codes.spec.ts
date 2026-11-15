import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { NUMERIC_TO_ALPHA2, PART_OF, alpha2Of } from './country-codes';

interface Atlas {
  id?: string;
  properties: { name: string };
}

async function atlas(): Promise<Atlas[]> {
  const topology = (await import('world-atlas/countries-110m.json')).default as unknown as Topology;
  return (
    feature(topology, topology.objects['countries'] as never) as unknown as { features: Atlas[] }
  ).features;
}

describe('alpha2Of', () => {
  it('maps world-atlas numeric ids (zero padded or not) to the ISO-2 the API sends', () => {
    expect(alpha2Of('203', 'Czechia')).toBe('CZ');
    expect(alpha2Of(203, 'Czechia')).toBe('CZ');
    expect(alpha2Of('040', 'Austria')).toBe('AT');
    expect(alpha2Of('36', 'Australia')).toBe('AU');
    expect(NUMERIC_TO_ALPHA2['203']).toBe('CZ');
  });

  it('knows the features that have no ISO numeric id', () => {
    expect(alpha2Of(undefined, 'Kosovo')).toBe('XK');
    expect(alpha2Of(undefined, 'N. Cyprus')).toBe('CY');
    expect(alpha2Of(undefined, 'Somaliland')).toBe('SO');
    expect(alpha2Of(undefined, 'Atlantis')).toBeUndefined();
  });

  it('resolves every country of the 110m atlas, so none is drawn as a hole in the map', async () => {
    const unmapped = (await atlas())
      .filter((f) => !alpha2Of(f.id, f.properties.name))
      .map((f) => f.properties.name);
    expect(unmapped).toEqual([]);
  });

  it('gives every code to one country, plus the declared pieces of another', async () => {
    const owners = new Map<string, string[]>();
    for (const f of await atlas()) {
      const code = alpha2Of(f.id, f.properties.name)!;
      owners.set(code, [...(owners.get(code) ?? []), f.properties.name]);
    }
    const shared = [...owners].filter(([, names]) => names.length > 1);
    expect(shared.map(([code]) => code).sort()).toEqual(Object.values(PART_OF).sort());
    for (const [, names] of shared) {
      expect(names.filter((n) => !(n in PART_OF))).toHaveLength(1);
    }
  });
});
