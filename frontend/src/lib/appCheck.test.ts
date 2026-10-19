import {afterEach, describe, expect, it, vi} from 'vitest';

const initializeApp = vi.fn(() => ({name: 'app'}));
const initializeAppCheck = vi.fn(() => ({app: 'check'}));
const getToken = vi.fn(async () => ({token: 'session'}));
const getLimitedUseToken = vi.fn(async () => ({token: 'one-time'}));
vi.mock('firebase/app', () => ({initializeApp}));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck,
  getToken,
  getLimitedUseToken,
  ReCaptchaEnterpriseProvider: class {
    constructor(public key: string) {}
  },
}));

// appCheck.ts reads its configuration when imported: every test imports a fresh copy under its own env.
const load = async (configured: boolean) => {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_APP_ID: 'app', VITE_FIREBASE_PROJECT_ID: 'proj', VITE_RECAPTCHA_SITE_KEY: 'site',
  })) vi.stubEnv(k, configured ? v : '');
  return import('./appCheck');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('App Check token source', () => {
  it('without configuration: no token, and the SDK is never loaded', async () => {
    const appCheck = await load(false);
    expect(appCheck.appCheckEnabled).toBe(false);
    expect(await appCheck.appCheckToken()).toBeNull();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('initialises once with reCAPTCHA Enterprise and auto-refresh, then hands out tokens', async () => {
    const appCheck = await load(true);
    expect(await appCheck.appCheckToken()).toBe('session');
    expect(await appCheck.appCheckToken(true)).toBe('one-time');
    expect(initializeAppCheck).toHaveBeenCalledTimes(1);
    expect((initializeAppCheck.mock.calls[0] as any[])[1]).toMatchObject({isTokenAutoRefreshEnabled: true, provider: {key: 'site'}});
  });

  it('a failing or slow reCAPTCHA gives null instead of holding up the check', async () => {
    const appCheck = await load(true);
    getToken.mockRejectedValueOnce(new Error('appCheck/recaptcha-error'));
    expect(await appCheck.appCheckToken()).toBeNull();
    vi.useFakeTimers();
    getToken.mockImplementationOnce(() => new Promise(() => {}));
    const pending = appCheck.appCheckToken();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeNull();
  });
});
