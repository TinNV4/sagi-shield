import {afterEach, describe, expect, it, vi} from 'vitest';

// The token source is replaced: these tests are about when the client sends a token and when it asks for a new one.
const {idToken, currentUser, authSettled} = vi.hoisted(() => ({
  idToken: vi.fn(async (force?: boolean): Promise<string | null> => (force ? 'fresh' : 'stale')),
  currentUser: vi.fn((): {uid: string; anonymous: boolean; name: string} | null => ({uid: 'u1', anonymous: false, name: ''})),
  authSettled: vi.fn((): boolean => true),
}));
vi.mock('../lib/auth', () => ({idToken, currentUser, authSettled}));

import {ApiError, AUTH_RETRY_MS, RealApi} from './client';

type FetchArgs = [string, RequestInit?];
const reply = (status: number, body: unknown = {ok: true}) => Promise.resolve(new Response(JSON.stringify(body), {status}));
const bearer = (fetchMock: {mock: {calls: FetchArgs[]}}, call: number) =>
  new Headers(fetchMock.mock.calls[call][1]?.headers).get('Authorization');

afterEach(() => {
  vi.unstubAllGlobals();
  idToken.mockReset();
  idToken.mockImplementation(async (force?: boolean) => (force ? 'fresh' : 'stale'));
  currentUser.mockReset();
  currentUser.mockReturnValue({uid: 'u1', anonymous: false, name: ''});
  authSettled.mockReset();
  authSettled.mockReturnValue(true);
});

describe('Authorization header', () => {
  it('a signed-in user sends the ID token on a read', async () => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').myHouseholds();
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/household');
    expect(bearer(fetchMock, 0)).toBe('Bearer stale');
  });

  it('only household and agent routes carry the ID token; checks, reports and stats never do', async () => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const api = new RealApi('http://api.test');
    await api.check(new FormData());
    await api.precheck({lang: 'ja'} as any);
    await api.deepcheck({lang: 'ja'} as any);
    await api.report({scam_type: 'x'} as any);
    await api.getStats();
    for (let i = 0; i < 5; i++) expect(bearer(fetchMock, i)).toBeNull();
    expect(idToken).not.toHaveBeenCalled();
    await api.recovery('s1', 'hi', 'ja');
    expect(fetchMock.mock.calls[5][0]).toBe('http://api.test/agent/recovery');
    expect(bearer(fetchMock, 5)).toBe('Bearer stale');
  });

  it('a 401 from a public route is not retried with a token', async () => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(401, {detail: 'nope'}));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').getStats().catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(idToken).not.toHaveBeenCalled();
  });

  it('nobody signed in: no header at all', async () => {
    idToken.mockResolvedValue(null);
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').myHouseholds();
    expect(bearer(fetchMock, 0)).toBeNull();
  });

  it('retries once with a fresh token on 401, then succeeds', async () => {
    const fetchMock = vi
      .fn((..._a: FetchArgs) => reply(200, []))
      .mockImplementationOnce(() => reply(401, {detail: 'sign-in expired, please sign in again'}))
      .mockImplementationOnce(() => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').myHouseholds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bearer(fetchMock, 0)).toBe('Bearer stale');
    expect(bearer(fetchMock, 1)).toBe('Bearer fresh');
    expect(idToken).toHaveBeenLastCalledWith(true);
  });

  it('a second 401 throws ApiError(failed, 401) with the server sentence; no third try', async () => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(401, {detail: 'sign-in required'}));
    vi.stubGlobal('fetch', fetchMock);
    const err = await new RealApi('http://api.test').myHouseholds().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('failed');
    expect(err.status).toBe(401);
    expect(err.detail).toBe('sign-in required');
  });

  it('after the phone slept the first token call gave nothing: a 401 is still retried once with a fresh token', async () => {
    idToken.mockImplementation(async (force?: boolean) => (force ? 'fresh' : null));
    const fetchMock = vi
      .fn((..._a: FetchArgs) => reply(200, []))
      .mockImplementationOnce(() => reply(401, {detail: 'sign-in required'}))
      .mockImplementationOnce(() => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await new RealApi('http://api.test').myHouseholds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bearer(fetchMock, 0)).toBeNull();
    expect(bearer(fetchMock, 1)).toBe('Bearer fresh');
  });

  it('a 401 without a signed-in user is not retried', async () => {
    idToken.mockResolvedValue(null);
    currentUser.mockReturnValue(null);
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(401, {detail: 'sign-in required'}));
    vi.stubGlobal('fetch', fetchMock);
    const err = await new RealApi('http://api.test').myHouseholds().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(401);
  });
});

describe('household routes', () => {
  const call = async (run: (api: RealApi) => Promise<unknown>, body: unknown = {ok: true}) => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, body));
    vi.stubGlobal('fetch', fetchMock);
    await run(new RealApi('http://api.test'));
    const [url, init] = fetchMock.mock.calls[0];
    return {url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined};
  };

  it('create / code / join / push / notify use the documented paths and bodies', async () => {
    expect(await call((a) => a.createHousehold({member_name: 'Mom', market: 'ja'}))).toMatchObject({
      url: 'http://api.test/household',
      method: 'POST',
      body: {member_name: 'Mom', market: 'ja'},
    });
    expect(await call((a) => a.householdCode('h1'))).toMatchObject({url: 'http://api.test/household/h1/code', method: 'POST', body: {}});
    expect(await call((a) => a.joinHousehold('123-456', 'Taro', 'fcm'), {household: {household_id: 'h1'}})).toMatchObject({
      url: 'http://api.test/household/join',
      body: {pair_code: '123456', name: 'Taro', fcm_token: 'fcm'},
    });
    expect(await call((a) => a.registerHouseholdPush('h1', 'fcm'))).toMatchObject({
      url: 'http://api.test/household/h1/push',
      body: {fcm_token: 'fcm'},
    });
    const result = {risk_level: 'HIGH', scam_type: 'fake_police', stage: 4, reasons: ['a', 'b', 'c']} as any;
    expect(await call((a) => a.notifyHousehold('h1', result, 'en'))).toMatchObject({
      url: 'http://api.test/household/h1/notify',
      body: {risk_level: 'HIGH', scam_type: 'fake_police', stage: 4, reasons: ['a', 'b'], lang: 'ja'},
    });
  });

  it('sign-out drops this browser token with DELETE /household/<id>/push', async () => {
    expect(await call((a) => a.unregisterHouseholdPush('h1', 'fcm'))).toMatchObject({
      url: 'http://api.test/household/h1/push',
      method: 'DELETE',
      body: {fcm_token: 'fcm'},
    });
  });

  it('join returns the household, not the wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn((..._a: FetchArgs) => reply(200, {household: {household_id: 'h1'}})));
    expect(await new RealApi('http://api.test').joinHousehold('123456')).toEqual({household_id: 'h1'});
  });

  it('remove / delete / hand over use DELETE, DELETE and POST /owner', async () => {
    expect(await call((a) => a.removeGuardian('h1', 'u 2'))).toMatchObject({url: 'http://api.test/household/h1/guardians/u%202', method: 'DELETE'});
    expect(await call((a) => a.deleteHousehold('h1'))).toMatchObject({url: 'http://api.test/household/h1', method: 'DELETE'});
    expect(await call((a) => a.handOver('h1', 'u2'))).toMatchObject({url: 'http://api.test/household/h1/owner', method: 'POST', body: {uid: 'u2'}});
  });

  it('heartbeat is POST /household/<id>/heartbeat with only {listening}', async () => {
    const sent = await call((a) => a.heartbeat('h 1', true));
    expect(sent).toMatchObject({url: 'http://api.test/household/h%201/heartbeat', method: 'POST', body: {listening: true}});
    expect(sent.url).not.toContain('?');
  });

  it('updateHousehold is PATCH /household/<id> and returns the household, not the wrapper', async () => {
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, {household: {household_id: 'h1', live_guard_enabled: true}}));
    vi.stubGlobal('fetch', fetchMock);
    const h = await new RealApi('http://api.test').updateHousehold('h1', {live_guard_enabled: true, member_name: 'Mom'});
    expect(h).toEqual({household_id: 'h1', live_guard_enabled: true});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/household/h1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({live_guard_enabled: true, member_name: 'Mom'});
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(bearer(fetchMock, 0)).toBe('Bearer stale');
  });
  it('reset paired devices is DELETE /household/<id>/devices', async () => {
    expect(await call((a) => a.resetHouseholdDevices('h1'), {ok: true, removed: 2})).toMatchObject({
      url: 'http://api.test/household/h1/devices',
      method: 'DELETE',
    });
  });

  it('alerts and detail are plain GETs, and the household id never goes into a query string', async () => {
    const alerts = await call((a) => a.householdAlerts('h1'), []);
    expect(alerts).toMatchObject({url: 'http://api.test/household/h1/alerts', method: 'GET'});
    expect(alerts.url).not.toContain('?');
    expect(await call((a) => a.householdDetail('h1'), {})).toMatchObject({url: 'http://api.test/household/h1', method: 'GET'});
  });
});

describe('notifyMyHousehold (result screen: alert my family)', () => {
  const result = {risk_level: 'HIGH', scam_type: 'fake_police', stage: 4, reasons: ['a']} as any;

  it('a signed-in device with a household posts to /household/<id>/notify', async () => {
    currentUser.mockReturnValue({uid: 'd1', anonymous: true, name: ''});
    const fetchMock = vi
      .fn((..._a: FetchArgs) => reply(200, {ok: true}))
      .mockImplementationOnce(() => reply(200, [{household_id: 'h9'}, {household_id: 'h10'}]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/household');
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/household/h9/notify');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({risk_level: 'HIGH', lang: 'ja'});
  });

  it("a guardian's own phone never alerts the households it watches: legacy family or nothing", async () => {
    currentUser.mockReturnValue({uid: 'g1', anonymous: false, name: 'Taro'});
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, [{household_id: 'h9'}]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    localStorage.setItem('sagi_family_id', 'fam');
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(true);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['http://api.test/family/notify']);
    localStorage.clear();
  });

  it('a signed-in device without a household falls back to the legacy family (false without a family_id)', async () => {
    currentUser.mockReturnValue({uid: 'd1', anonymous: true, name: ''});
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the household lookup
  });

  it('legacy family_id still works while no household exists', async () => {
    currentUser.mockReturnValue({uid: 'd1', anonymous: true, name: ''});
    localStorage.setItem('sagi_family_id', 'fam');
    const fetchMock = vi.fn((..._a: FetchArgs) => reply(200, []));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/family/notify');
    localStorage.clear();
  });

  it('a failing household lookup is not an error for the caller', async () => {
    currentUser.mockReturnValue({uid: 'd1', anonymous: true, name: ''});
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(await new RealApi('http://api.test').notifyMyHousehold(result, 'ja')).toBe(false);
  });
});

describe('Live Guard socket', () => {
  class FakeSocket {
    static instances: FakeSocket[] = [];
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: {data: string}) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      FakeSocket.instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
  }
  const open = async () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const conn = new RealApi('http://api.test').connectLiveSocket('ja', 'manual', {onRisk() {}, onReset() {}, onStatus() {}});
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    return {conn, socket: FakeSocket.instances[0]};
  };

  it('signs in with the first message; no token and no family_id in the URL', async () => {
    localStorage.setItem('sagi_family_id', 'legacy');
    const {conn, socket} = await open();
    expect(socket.url).not.toContain('token');
    expect(socket.url).not.toContain('family_id');
    socket.onopen?.();
    await vi.waitFor(() => expect(socket.sent.length).toBe(1));
    expect(JSON.parse(socket.sent[0])).toEqual({type: 'auth', token: 'stale'});
    conn.close();
    localStorage.clear();
  });

  it('sends nothing at open when nobody is signed in', async () => {
    idToken.mockResolvedValue(null);
    currentUser.mockReturnValue(null);
    const {conn, socket} = await open();
    socket.onopen?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(socket.sent).toEqual([]);
    conn.close();
  });

  it('signed in but the token was slow: keeps trying in the background and signs in once one arrives', async () => {
    vi.useFakeTimers();
    try {
      idToken.mockResolvedValue(null);
      const {conn, socket} = await open();
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS);
      expect(socket.sent).toEqual([]);          // still nothing: no token yet
      idToken.mockResolvedValue('late');
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS);
      expect(socket.sent.map((s) => JSON.parse(s))).toEqual([{type: 'auth', token: 'late'}]);
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS * 3);
      expect(socket.sent.length).toBe(1);       // once signed in, the retries stop
      conn.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the auth SDK had not even loaded at open (no user known yet): keeps trying until it answers', async () => {
    vi.useFakeTimers();
    try {
      idToken.mockResolvedValue(null);
      currentUser.mockReturnValue(null);
      authSettled.mockReturnValue(false);
      const {conn, socket} = await open();
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS);
      expect(socket.sent).toEqual([]);
      idToken.mockResolvedValue('late');
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS);
      expect(socket.sent.map((s) => JSON.parse(s))).toEqual([{type: 'auth', token: 'late'}]);
      conn.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the SDK answered "nobody signed in": the retries stop', async () => {
    vi.useFakeTimers();
    try {
      idToken.mockResolvedValue(null);
      currentUser.mockReturnValue(null);
      authSettled.mockReturnValue(false);
      const {conn, socket} = await open();
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(0);
      authSettled.mockReturnValue(true); // loaded: there is no user
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS);
      const calls = idToken.mock.calls.length;
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS * 3);
      expect(idToken.mock.calls.length).toBe(calls);
      expect(socket.sent).toEqual([]);
      conn.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the background retry ends with the socket', async () => {
    vi.useFakeTimers();
    try {
      idToken.mockResolvedValue(null);
      const {conn, socket} = await open();
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(0);
      conn.close();
      const calls = idToken.mock.calls.length;
      idToken.mockResolvedValue('late');
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_MS * 3);
      expect(idToken.mock.calls.length).toBe(calls);
      expect(socket.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
