import {describe, expect, it} from 'vitest';
import {adminScreenState, agreementRate} from './adminState';

describe('adminScreenState', () => {
  it('no data and no error: loading', () => {
    expect(adminScreenState({data: null, error: null})).toEqual({kind: 'loading'});
  });
  it('401 and 403 are forbidden', () => {
    expect(adminScreenState({data: null, error: {status: 401, detail: null}}).kind).toBe('forbidden');
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
