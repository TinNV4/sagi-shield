import {describe, expect, it} from 'vitest';
import type {AdminSummary} from '../api/types';
import {adminScreenState, agreementRate, sectionState, type AdminSection} from './adminState';

describe('adminScreenState', () => {
  it('no data and no error: loading', () => {
    expect(adminScreenState({data: null, error: null})).toEqual({kind: 'loading'});
  });
  it('401 asks to sign in, 403 says not an administrator', () => {
    expect(adminScreenState({data: null, error: {status: 401, detail: null}}).kind).toBe('sign_in');
    expect(adminScreenState({data: null, error: {status: 403, detail: null}}).kind).toBe('forbidden');
  });
  it('503 is unavailable and keeps the server sentence', () => {
    expect(adminScreenState({data: null, error: {status: 503, detail: 'verdict table not configured'}})).toEqual({
      kind: 'unavailable',
      detail: 'verdict table not configured',
    });
  });
  it('any other failure is unavailable without a sentence', () => {
    expect(adminScreenState({data: null, error: {status: 0, detail: null}})).toEqual({kind: 'unavailable', detail: null});
  });
  it('data wins', () => {
    expect(adminScreenState({data: {days: 7}, error: null})).toEqual({kind: 'data'});
  });
});

describe('agreementRate', () => {
  it('is null with no answers', () => {
    expect(agreementRate({n: 0, correct: 0})).toBeNull();
  });
  it('is a whole percent', () => {
    expect(agreementRate({n: 3, correct: 2})).toBe(67);
    expect(agreementRate({n: 5, correct: 5})).toBe(100);
  });
});

const full = (over: Partial<AdminSummary> = {}): AdminSummary => ({
  days: 7,
  table: 't',
  verdicts: [{day: '2026-10-25', kind: 'check', level: 'HIGH', lang: 'ja', n: 2}],
  latency_ms: {p50: 1300, p95: 4200},
  live: {calls: 1, looks: 2, alarms: 0},
  rule_hits: [{name: 'authority', n: 3}],
  reasons: [{playbook: 'fake_police', n: 1}],
  feedback: {checks: {n: 2, correct: 1}, alerts: {n: 0, correct: 0}},
  households: {n: 1, live_guard_on: 1, devices_seen_24h: 1},
  unavailable: [],
  ...over,
});
const SECTIONS: AdminSection[] = ['verdicts', 'latency', 'live', 'rule_hits', 'reasons', 'feedback', 'households'];

describe('sectionState', () => {
  it('ok for every section of a full summary', () => {
    for (const s of SECTIONS) expect(sectionState(full(), s)).toBe('ok');
  });
  it('unavailable when the server names the section, whatever numbers came with it', () => {
    for (const s of SECTIONS) expect(sectionState(full({unavailable: [s]}), s)).toBe('unavailable');
    expect(sectionState(full({unavailable: ['live']}), 'latency')).toBe('ok');
  });
  it('empty when present but without rows or counts', () => {
    expect(sectionState(full({verdicts: []}), 'verdicts')).toBe('empty');
    expect(sectionState(full({latency_ms: {p50: null, p95: null}}), 'latency')).toBe('empty');
    expect(sectionState(full({live: {calls: 0, looks: 0, alarms: 0}}), 'live')).toBe('empty');
    expect(sectionState(full({rule_hits: []}), 'rule_hits')).toBe('empty');
    expect(sectionState(full({reasons: []}), 'reasons')).toBe('empty');
    expect(sectionState(full({feedback: {checks: {n: 0, correct: 0}, alerts: {n: 0, correct: 0}}}), 'feedback')).toBe('empty');
    expect(sectionState(full({households: {n: 0, live_guard_on: 0, devices_seen_24h: 0}}), 'households')).toBe('empty');
  });
  it('a summary without verdicts does not throw: empty, or unavailable when named', () => {
    const noVerdicts = full();
    delete (noVerdicts as Partial<AdminSummary>).verdicts;
    expect(sectionState(noVerdicts, 'verdicts')).toBe('empty');
    expect(sectionState({...noVerdicts, unavailable: ['verdicts']}, 'verdicts')).toBe('unavailable');
  });
  it('a summary without the unavailable list reads as available', () => {
    const s = full();
    delete s.unavailable;
    expect(sectionState(s, 'live')).toBe('ok');
  });
});