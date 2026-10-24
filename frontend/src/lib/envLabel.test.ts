import {describe, expect, it} from 'vitest';
import {envLabel, pwaNames} from './envLabel';

describe('envLabel', () => {
  it('normalises the build value to a short upper-case badge', () => {
    expect(envLabel('PILOT')).toBe('PILOT');
    expect(envLabel('  pilot ')).toBe('PILOT');
    expect(envLabel('a-very-long-environment-name')).toBe('A-VERY-LONG-');
  });

  it('is empty for production builds', () => {
    expect(envLabel(undefined)).toBe('');
    expect(envLabel('')).toBe('');
    expect(envLabel('   ')).toBe('');
  });
});

describe('pwaNames', () => {
  it('keeps the production names when there is no label', () => {
    expect(pwaNames('')).toEqual({name: 'Sagi Shield', short_name: 'SagiShield'});
  });

  it('gives the pilot install its own names so two home-screen icons differ', () => {
    expect(pwaNames('PILOT')).toEqual({name: 'Sagi Shield (PILOT)', short_name: 'Sagi PILOT'});
  });
});
