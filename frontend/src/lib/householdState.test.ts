import {describe, expect, it} from 'vitest';
import type {Household} from '../api/types';
import {formatPairCode, guardianRows, marketForLang, memberScreenState} from './householdState';

const household = (over: Partial<Household> = {}): Household => ({
  household_id: 'h1',
  name: '',
  member_name: 'Mom',
  market: 'ja',
  live_guard_enabled: false,
  devices: 1,
  guardians: [],
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('memberScreenState', () => {
  it('is loading until the sign-in answered, then until the households arrived', () => {
    expect(memberScreenState({uid: undefined, households: null, failed: false})).toEqual({kind: 'loading'});
    expect(memberScreenState({uid: 'dev', households: null, failed: false})).toEqual({kind: 'loading'});
  });

  it('says pairing is unavailable when the sign-in returned null; no household is looked at', () => {
    expect(memberScreenState({uid: null, households: [household()], failed: false})).toEqual({kind: 'unavailable'});
  });

  it('offers to create a household when there is none', () => {
    expect(memberScreenState({uid: 'dev', households: [], failed: false})).toEqual({kind: 'create'});
  });

  it('shows the first household when one exists', () => {
    const h = household();
    expect(memberScreenState({uid: 'dev', households: [h, household({household_id: 'h2'})], failed: false})).toEqual({kind: 'household', household: h});
  });

  it('a failed call is an error with a retry, never an empty "create" state', () => {
    expect(memberScreenState({uid: 'dev', households: [], failed: true})).toEqual({kind: 'error'});
    expect(memberScreenState({uid: 'dev', households: null, failed: true})).toEqual({kind: 'error'});
  });
});

describe('marketForLang', () => {
  it('maps the English UI to ja, as the API language does', () => {
    expect(marketForLang('en')).toBe('ja');
    expect(marketForLang('ja')).toBe('ja');
    expect(marketForLang('vi')).toBe('vi');
  });
});

describe('formatPairCode', () => {
  it('groups six digits and leaves anything else as a placeholder', () => {
    expect(formatPairCode('123456')).toBe('123-456');
    expect(formatPairCode('')).toBe('--- ---');
    expect(formatPairCode('12')).toBe('--- ---');
  });
});

describe('guardianRows', () => {
  it('lists names with the owner mark and keeps the order', () => {
    const rows = guardianRows(household({guardians: [{name: 'Taro', owner: true, me: false}, {name: '', owner: false, me: false}]}));
    expect(rows).toEqual([
      {key: 'g-0', name: 'Taro', owner: true},
      {key: 'g-1', name: '', owner: false},
    ]);
  });
});
