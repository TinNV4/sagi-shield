import {afterEach, describe, expect, it, vi} from 'vitest';

// The token source is replaced: these tests are about which request carries which token.
const {appCheckToken} = vi.hoisted(() => ({
  appCheckToken: vi.fn(async (limitedUse?: boolean): Promise<string | null> => (limitedUse ? 'one-time' : 'session')),
}));
vi.mock('../lib/appCheck', () => ({APP_CHECK_HEADER: 'X-Firebase-AppCheck', appCheckToken}));

import {ApiError, RealApi, describeApiError} from './client';

const t = (key: string) => `[${key}]`;
type FetchArgs = [string, RequestInit?];
const ok = (..._args: FetchArgs) => Promise.resolve(new Response(JSON.stringify({ok: true}), {status: 200}));
const sent = (fetchMock: {mock: {calls: FetchArgs[]}}) => new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Firebase-AppCheck');

afterEach(() => {
  vi.unstubAllGlobals();
  appCheckToken.mockClear();
});

describe('App Check tokens on API calls', () => {
  it('a check carries the session token', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').precheck({who_asked: 'police', reason_text: 'x', recipient_type: 'person', lang: 'ja'});
    expect(sent(fetchMock)).toBe('session');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Content-Type')).toBe('application/json');
  });

  it('a report carries a one-time token', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').report({scam_type: 'fake_police', keywords: [], consent: true, lang: 'ja'} as any);
    expect(appCheckToken).toHaveBeenCalledWith(true);
    expect(sent(fetchMock)).toBe('one-time');
  });

  it('reads carry no token, and a missing token sends the request anyway', async () => {
    const fetchMock = vi.fn((..._args: FetchArgs) => Promise.resolve(new Response(JSON.stringify({}), {status: 200})));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').getStats();
    expect(appCheckToken).not.toHaveBeenCalled();
    appCheckToken.mockResolvedValueOnce(null);
    await new RealApi('http://api.test').check(new FormData());
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('X-Firebase-AppCheck')).toBe(false);
  });

  it('a refused report (403) is "unverified" with the translated sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({detail: 'English server text'}), {status: 403}))));
    const err = await new RealApi('http://api.test').report({scam_type: 'x', keywords: [], consent: true, lang: 'vi'} as any).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('unverified');
    expect(describeApiError(err, t)).toBe('[api.unverified]');
  });

  it('the Live Guard socket carries the token in the query', async () => {
    const urls: string[] = [];
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      constructor(url: string) {
        urls.push(url);
      }
      close() {}
    });
    const conn = new RealApi('http://api.test').connectLiveSocket('ja', 'manual', {
      onStatus: () => {}, onRisk: () => {}, onReset: () => {}, onError: () => {},
    } as any);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toMatch(/^ws:\/\/api\.test\/ws\/live\?.*&appcheck=session$/);
    conn.close();
  });
});
