import { describe, expect, it } from 'vitest';
import { splitValue } from './gauge';

describe('splitValue', () => {
  it('puts the unit under the number', () => {
    expect(splitValue('51.2 °C')).toEqual({ num: '51.2', unit: '°C', inline: false });
    expect(splitValue('1.9 GiB')).toEqual({ num: '1.9', unit: 'GiB', inline: false });
  });

  it('keeps a percent sign on the number line', () => {
    expect(splitValue('27%')).toEqual({ num: '27', unit: '%', inline: true });
  });

  it('leaves a bare number or odd text alone', () => {
    expect(splitValue('0.39')).toEqual({ num: '0.39', unit: '', inline: false });
    expect(splitValue('n/a')).toEqual({ num: 'n/a', unit: '', inline: false });
  });
});
