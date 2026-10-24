import {afterEach, describe, expect, it, vi} from 'vitest';

type FakeUser = {uid: string; isAnonymous: boolean; displayName: string | null; getIdToken: (force?: boolean) => Promise<string>};

const user: FakeUser = {uid: 'dev-1', isAnonymous: true, displayName: null, getIdToken: vi.fn(async (force?: boolean) => (force ? 'fresh' : 'tok'))};
const googleUser: FakeUser = {uid: 'g-1', isAnonymous: false, displayName: 'Hanako', getIdToken: vi.fn(async () => 'g-tok')};
let current: FakeUser | null = null;
let listener: ((u: FakeUser | null) => void) | null = null;

const signInAnonymously = vi.fn(async () => {
  current = user;
  listener?.(user);
  return {user};
});
const signInWithPopup = vi.fn(async () => {
  current = googleUser;
  listener?.(googleUser);
  return {user: googleUser};
});
const confirm = vi.fn(async (_code: string) => {
  current = googleUser;
  listener?.(googleUser);
  return {user: googleUser};
});
const signInWithPhoneNumber = vi.fn(async (_auth: unknown, _phone: string, _verifier: unknown) => ({confirm}));
const verifierClear = vi.fn();
const verifierHosts: unknown[] = [];
const firebaseSignOut = vi.fn(async () => {
  current = null;
  listener?.(null);
});
const authObject = {
  get currentUser() {
    return current;
  },
  authStateReady: vi.fn(async () => {}),
};
vi.mock('firebase/app', () => ({initializeApp: vi.fn(() => ({name: 'app'}))}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => authObject),
  signInAnonymously,
  signInWithPopup,
  signInWithPhoneNumber,
  signOut: firebaseSignOut,
  onIdTokenChanged: vi.fn((_auth: unknown, cb: (u: FakeUser | null) => void) => {
    listener = cb;
    cb(current);
    return () => {
      listener = null;
    };
  }),
  GoogleAuthProvider: class {},
  RecaptchaVerifier: class {
    clear = verifierClear;
    constructor(_auth: unknown, host: unknown) {
      verifierHosts.push(host);
    }
  },
}));

// auth.ts reads its configuration when imported: every test imports a fresh copy under its own env.
const load = async (configured: boolean) => {
  vi.resetModules();
  for (const [k, v] of Object.entries({VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_APP_ID: 'app', VITE_FIREBASE_PROJECT_ID: 'proj'}))
    vi.stubEnv(k, configured ? v : '');
  return import('./auth');
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
  current = null;
  listener = null;
});

describe('device sign-in', () => {
  it('signs the device in anonymously once and returns the uid', async () => {
    const auth = await load(true);
    expect(await auth.ensureDeviceSignIn()).toBe('dev-1');
    expect(await auth.ensureDeviceSignIn()).toBe('dev-1');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('keeps the account that is already signed in instead of signing in again', async () => {
    current = user;
    const auth = await load(true);
    expect(await auth.ensureDeviceSignIn()).toBe('dev-1');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('returns null, loads no SDK, when Firebase is not configured', async () => {
    const auth = await load(false);
    expect(auth.authEnabled).toBe(false);
    expect(await auth.ensureDeviceSignIn()).toBeNull();
    expect(await auth.idToken()).toBeNull();
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when the sign-in fails, and tries again next time', async () => {
    const auth = await load(true);
    signInAnonymously.mockRejectedValueOnce(new Error('network'));
    expect(await auth.ensureDeviceSignIn()).toBeNull();
    expect(await auth.ensureDeviceSignIn()).toBe('dev-1');
  });
});

describe('ID token', () => {
  it('is null while nobody is signed in', async () => {
    const auth = await load(true);
    expect(await auth.idToken()).toBeNull();
  });

  it('hands out the cached token, or a fresh one when forced', async () => {
    const auth = await load(true);
    await auth.ensureDeviceSignIn();
    expect(await auth.idToken()).toBe('tok');
    expect(await auth.idToken(true)).toBe('fresh');
  });

  it('gives up after 3 s and returns null', async () => {
    const auth = await load(true);
    await auth.ensureDeviceSignIn();
    vi.useFakeTimers();
    vi.mocked(user.getIdToken).mockImplementationOnce(() => new Promise<string>(() => {}));
    const pending = auth.idToken();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeNull();
  });
});

describe('guardian sign-in', () => {
  it('Google: popup sign-in returns the session with the display name', async () => {
    const auth = await load(true);
    expect(await auth.signInGuardian('google')).toEqual({state: 'signed_in', user: {uid: 'g-1', anonymous: false, name: 'Hanako'}});
  });

  it('phone: sends the code, then confirmPhoneCode finishes the sign-in', async () => {
    const auth = await load(true);
    document.body.innerHTML = '<div id="recaptcha-container"></div>';
    expect(await auth.signInGuardian('phone', '+819012345678')).toEqual({state: 'code_sent'});
    expect(signInWithPhoneNumber.mock.calls[0][1]).toBe('+819012345678');
    expect(await auth.confirmPhoneCode('123456')).toEqual({uid: 'g-1', anonymous: false, name: 'Hanako'});
    expect(confirm).toHaveBeenCalledWith('123456');
  });

  it('phone: a refused number or a wrong code gives null, not an exception', async () => {
    const auth = await load(true);
    document.body.innerHTML = '<div id="recaptcha-container"></div>';
    signInWithPhoneNumber.mockRejectedValueOnce(new Error('invalid-phone-number'));
    expect(await auth.signInGuardian('phone', '+81')).toBeNull();
    expect(verifierClear).toHaveBeenCalled();
    expect(await auth.confirmPhoneCode('000000')).toBeNull(); // nothing pending
    await auth.signInGuardian('phone', '+819012345678');
    confirm.mockRejectedValueOnce(new Error('invalid-verification-code'));
    expect(await auth.confirmPhoneCode('000000')).toBeNull();
  });

  it('phone: send again renders a new reCAPTCHA in a fresh element; change number drops the pending code', async () => {
    const auth = await load(true);
    verifierHosts.length = 0;
    document.body.innerHTML = '<div id="recaptcha-container"></div>';
    await auth.signInGuardian('phone', '+819012345678');
    await auth.signInGuardian('phone', '+819012345678'); // "Send again"
    expect(signInWithPhoneNumber).toHaveBeenCalledTimes(2);
    expect(verifierClear).toHaveBeenCalledTimes(1);
    const container = document.getElementById('recaptcha-container')!;
    expect(verifierHosts.length).toBe(2);
    expect(verifierHosts[0]).not.toBe(verifierHosts[1]); // a widget cannot be rendered twice into one element
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild).toBe(verifierHosts[1]);
    auth.cancelPhoneSignIn(); // "Change number"
    expect(verifierClear).toHaveBeenCalledTimes(2);
    expect(await auth.confirmPhoneCode('123456')).toBeNull();
  });

  it('a cancelled Google popup gives null', async () => {
    const auth = await load(true);
    signInWithPopup.mockRejectedValueOnce(new Error('popup-closed-by-user'));
    expect(await auth.signInGuardian('google')).toBeNull();
  });
});

describe('auth state', () => {
  it('onAuth reports the user, then null after sign-out; the unsubscribe stops it', async () => {
    const auth = await load(true);
    const seen: unknown[] = [];
    const off = auth.onAuth((u) => seen.push(u));
    await vi.waitFor(() => expect(seen).toEqual([null]));
    await auth.ensureDeviceSignIn();
    expect(seen[1]).toEqual({uid: 'dev-1', anonymous: true, name: ''});
    await auth.signOut();
    expect(seen[2]).toBeNull();
    off();
    expect(auth.currentUser()).toBeNull();
  });

  it('authSettled: false until the SDK read the stored session, true without Firebase', async () => {
    const auth = await load(true);
    expect(auth.authSettled()).toBe(false);
    await auth.idToken();
    expect(auth.authSettled()).toBe(true);
    expect((await load(false)).authSettled()).toBe(true);
  });

  it('onAuth reports null once when Firebase is not configured', async () => {
    const auth = await load(false);
    const cb = vi.fn();
    auth.onAuth(cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(null));
  });
});
