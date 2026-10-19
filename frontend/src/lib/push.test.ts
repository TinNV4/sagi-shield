import {afterEach, describe, expect, it, vi} from 'vitest';

const {initializeApp, getToken, getMessaging, isSupported} = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({name: 'app'})),
  getToken: vi.fn(async (): Promise<string> => 'fcm-token'),
  getMessaging: vi.fn(() => ({messaging: true})),
  isSupported: vi.fn(async () => true),
}));
vi.mock('firebase/app', () => ({initializeApp}));
vi.mock('firebase/messaging', () => ({getToken, getMessaging, isSupported}));

const registration = {scope: '/'};

// push.ts reads its configuration when imported: every test imports a fresh copy under its own env and browser.
const load = async ({configured = true, permission = 'default', answer = 'granted'} = {}) => {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_APP_ID: '1:123456:web:abc', VITE_FIREBASE_PROJECT_ID: 'proj',
    VITE_FIREBASE_VAPID_KEY: 'vapid',
  })) vi.stubEnv(k, configured ? v : '');
  const requestPermission = vi.fn(async () => answer);
  vi.stubGlobal('Notification', Object.assign(function () {}, {permission, requestPermission}));
  vi.stubGlobal('PushManager', function () {});
  Object.defineProperty(navigator, 'serviceWorker', {value: {ready: Promise.resolve(registration)}, configurable: true});
  return {push: await import('./push'), requestPermission};
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('guardian push token', () => {
  it('without configuration: unsupported, no prompt, no SDK', async () => {
    const {push, requestPermission} = await load({configured: false});
    expect(push.pushPermission()).toBe('unsupported');
    expect(await push.pushToken()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('asks once, then gets a token through the app service worker with the VAPID key', async () => {
    const {push, requestPermission} = await load();
    expect(await push.pushToken()).toBe('fcm-token');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(initializeApp).toHaveBeenCalledWith(expect.objectContaining({messagingSenderId: '123456'}));
    expect(getToken).toHaveBeenCalledWith({messaging: true}, {vapidKey: 'vapid', serviceWorkerRegistration: registration});
  });

  it('a refusal returns null and loads nothing', async () => {
    const {push} = await load({answer: 'denied'});
    expect(await push.pushToken()).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('already blocked: reported as blocked, never prompts again', async () => {
    const {push, requestPermission} = await load({permission: 'denied'});
    expect(push.pushPermission()).toBe('denied');
    expect(await push.pushToken()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('a token that never comes does not hold up pairing', async () => {
    vi.useFakeTimers();
    getToken.mockImplementationOnce(() => new Promise<string>(() => {}));
    const {push} = await load({permission: 'granted'});
    const pending = push.pushToken();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
  });
});
