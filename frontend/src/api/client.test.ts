import {afterEach, describe, expect, it, vi} from 'vitest';
import {ApiError, RealApi, apiErrorKey, describeApiError} from './client';

const t = (key: string) => `[${key}]`;
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

const stubFetch = (impl: (...args: any[]) => any) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('RealApi error mapping', () => {
  it('turns a dropped connection into ApiError(offline), never the raw TypeError', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await new RealApi('http://api.test').getStats().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('offline');
    expect(describeApiError(err, t)).toBe('[api.offline]');
  });

  it('keeps the sentence the server wrote for a 429', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(429, {detail: 'Too many requests. Please wait a minute.'})));
    const err = await new RealApi('http://api.test').precheck({who_asked: 'police', reason_text: 'x', recipient_type: 'person', lang: 'ja'}).catch((e) => e);
    expect(err.kind).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(describeApiError(err, t)).toBe('Too many requests. Please wait a minute.');
  });

  it('503 without a detail sentence is "unavailable"', async () => {
    stubFetch(() => Promise.resolve(new Response('upstream down', {status: 503})));
    const err = await new RealApi('http://api.test').getStats().catch((e) => e);
    expect(err.kind).toBe('unavailable');
    expect(describeApiError(err, t)).toBe('[api.unavailable]');
  });

  it('any other status is a generic failure, and a non-ApiError maps to api.failed', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(500, {detail: {not: 'a string'}})));
    const err = await new RealApi('http://api.test').getStats().catch((e) => e);
    expect(err.kind).toBe('failed');
    expect(err.detail).toBeNull();
    expect(apiErrorKey(new Error('boom'))).toBe('api.failed');
  });
});

describe('RealApi requests', () => {
  it('sends only ja or vi to the API even when the UI is in English', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(200, {risk_level: 'LOW'})));
    await new RealApi('http://api.test/').precheck({who_asked: 'bank', reason_text: 'x', recipient_type: 'company', lang: 'en'});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/precheck');
    expect(JSON.parse(init.body).lang).toBe('ja');
  });

  it('notifyFamily is false without a family and false on failure, never a throw', async () => {
    const api = new RealApi('http://api.test');
    const result = {risk_level: 'HIGH', scam_type: 'fake_police', stage: 5, reasons: ['a', 'b', 'c']} as any;
    expect(await api.notifyFamily(result, 'ja')).toBe(false);
    localStorage.setItem('sagi_family_id', 'fam-1');
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await api.notifyFamily(result, 'ja')).toBe(false);
  });

  it('getFamilyAlerts asks nothing when the device is not paired', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(200, [])));
    expect(await new RealApi('http://api.test').getFamilyAlerts()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('link fragments', () => {
  const load = async (hash: string) => {
    vi.resetModules();
    window.history.replaceState(null, '', '/' + hash);
    return import('./client');
  };

  it('#join=123456 gives JOIN_FROM_LINK and is stripped from the address bar', async () => {
    const mod = await load('#join=123456');
    expect(mod.JOIN_FROM_LINK).toBe('123456');
    expect(mod.PAIR_FROM_LINK).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('#pair=123456 does not set JOIN_FROM_LINK', async () => {
    const mod = await load('#pair=123456');
    expect(mod.PAIR_FROM_LINK).toBe('123456');
    expect(mod.JOIN_FROM_LINK).toBe('');
  });

  it('#share gives SHARE_FROM_LINK and is stripped from the address bar', async () => {
    const mod = await load('#share');
    expect(mod.SHARE_FROM_LINK).toBe(true);
    expect(window.location.hash).toBe('');
  });

  it('#privacy gives PRIVACY_FROM_LINK and is stripped from the address bar', async () => {
    const mod = await load('#privacy');
    expect(mod.PRIVACY_FROM_LINK).toBe(true);
    expect(mod.ADMIN_FROM_LINK).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('other fragments do not set PRIVACY_FROM_LINK', async () => {
    expect((await load('#admin')).PRIVACY_FROM_LINK).toBe(false);
  });

  it('other fragments do not set SHARE_FROM_LINK', async () => {
    const mod = await load('#pair=123456');
    expect(mod.SHARE_FROM_LINK).toBe(false);
  });
});
