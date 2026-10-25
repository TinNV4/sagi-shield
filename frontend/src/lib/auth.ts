/**
 * Firebase Authentication for the PWA. Two kinds of user, one SDK:
 *  - the protected person's device signs in anonymously (no email, no password) and pairs by 6-digit code / QR;
 *  - a guardian signs in with Google or a phone number (SMS code).
 * Every API call carries the ID token (api/client.ts); the server decides the role from the sign-in method.
 *
 * Same rules as appCheck.ts and push.ts: the SDK loads in its own chunk on first use, nothing here ever throws,
 * and a build without Firebase values (authEnabled = false) simply reports "not available".
 */
import type {Auth, ConfirmationResult, RecaptchaVerifier, User} from 'firebase/auth';
import {firebaseApp, firebaseConfigured} from './firebaseApp';

export const authEnabled: boolean = firebaseConfigured;

const TOKEN_WAIT_MS = 3000;
const SIGN_IN_WAIT_MS = 10000;
/** The element the invisible reCAPTCHA of the phone sign-in attaches to (the guardian screen renders it). */
export const RECAPTCHA_CONTAINER_ID = 'recaptcha-container';

export interface AuthUser {
  uid: string;
  anonymous: boolean;
  /** Display name from the identity provider; empty for anonymous and phone users. */
  name: string;
}

/** Result of the first step of a guardian sign-in: done (Google), or the SMS code was sent (phone). */
export type GuardianSignIn = {state: 'signed_in'; user: AuthUser} | {state: 'code_sent'} | null;

type Sdk = typeof import('firebase/auth');
interface Loaded {
  auth: Auth;
  sdk: Sdk;
}

const toUser = (u: User): AuthUser => ({uid: u.uid, anonymous: u.isAnonymous, name: u.displayName ?? ''});

let loading: Promise<Loaded | null> | null = null;
let authRef: Auth | null = null;

/** The SDK plus the auth instance, once its persisted session has been read. Null when unavailable. */
function load(): Promise<Loaded | null> {
  if (!authEnabled) return Promise.resolve(null);
  loading ??= Promise.all([firebaseApp(), import('firebase/auth')])
    .then(async ([app, sdk]) => {
      const auth = sdk.getAuth(app);
      await auth.authStateReady?.();
      authRef = auth;
      return {auth, sdk};
    })
    .catch((err) => {
      console.warn('Sign-in unavailable:', err);
      loading = null; // a later call may succeed (the chunk was offline)
      return null;
    });
  return loading;
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

let deviceSignIn: Promise<string | null> | null = null;

/**
 * The protected person's device: reuses the session it already has, otherwise signs in anonymously. Concurrent
 * callers share one sign-in. Null (never an exception) when Firebase is not configured or the sign-in fails:
 * the app keeps working, only without a household.
 */
export function ensureDeviceSignIn(): Promise<string | null> {
  if (!authEnabled) return Promise.resolve(null);
  deviceSignIn ??= withTimeout(
    (async () => {
      const loaded = await load();
      if (!loaded) return null;
      if (loaded.auth.currentUser) return loaded.auth.currentUser.uid;
      return (await loaded.sdk.signInAnonymously(loaded.auth)).user.uid;
    })().catch((err) => {
      console.warn('Anonymous sign-in failed:', err);
      return null;
    }),
    SIGN_IN_WAIT_MS
  ).finally(() => {
    deviceSignIn = null;
  });
  return deviceSignIn;
}

let verifier: RecaptchaVerifier | null = null;
let pendingPhone: ConfirmationResult | null = null;

const clearVerifier = () => {
  try {
    verifier?.clear();
  } catch {}
  verifier = null;
};

/**
 * Guardian sign-in. Google: a popup, resolved when it closes. Phone (E.164, "+81..."): sends the SMS code and
 * resolves to `code_sent`; then confirmPhoneCode(code). Null when refused, cancelled or unavailable.
 */
export async function signInGuardian(method: 'google' | 'phone', phone?: string): Promise<GuardianSignIn> {
  const loaded = await load();
  if (!loaded) return null;
  const {auth, sdk} = loaded;
  try {
    if (method === 'google') {
      const cred = await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      return {state: 'signed_in', user: toUser(cred.user)};
    }
    if (!phone) return null;
    // also "Send again": the old widget is cleared and a new one goes into a fresh element, because reCAPTCHA
    // refuses to render twice into the same node
    cancelPhoneSignIn();
    verifier = new sdk.RecaptchaVerifier(auth, freshRecaptchaHost(), {size: 'invisible'});
    pendingPhone = await sdk.signInWithPhoneNumber(auth, phone, verifier);
    return {state: 'code_sent'};
  } catch (err) {
    console.warn('Guardian sign-in failed:', err);
    if (method === 'phone') clearVerifier();
    return null;
  }
}

/** An empty child of the reCAPTCHA container (or the container id when the screen has not rendered it). */
function freshRecaptchaHost(): HTMLElement | string {
  const container = typeof document === 'undefined' ? null : document.getElementById(RECAPTCHA_CONTAINER_ID);
  if (!container) return RECAPTCHA_CONTAINER_ID;
  const host = document.createElement('div');
  container.replaceChildren(host);
  return host;
}

/** "Change number": forget the code that was sent and its reCAPTCHA. Safe to call at any time. */
export function cancelPhoneSignIn(): void {
  pendingPhone = null;
  clearVerifier();
}

/** Second step of the phone sign-in. Null for a wrong code (try again) or when no code is pending. */
export async function confirmPhoneCode(code: string): Promise<AuthUser | null> {
  if (!pendingPhone) return null;
  try {
    const cred = await pendingPhone.confirm(code);
    pendingPhone = null;
    clearVerifier();
    return toUser(cred.user);
  } catch (err) {
    console.warn('Phone code refused:', err);
    return null;
  }
}

export async function signOut(): Promise<void> {
  pendingPhone = null;
  clearVerifier();
  const loaded = await load();
  if (!loaded) return;
  try {
    await loaded.sdk.signOut(loaded.auth);
  } catch (err) {
    console.warn('Sign-out failed:', err);
  }
}

/** True once the SDK has loaded and read the stored session, or when it never will (no Firebase on this build).
 *  Until then currentUser() is null even for a signed-in user. */
export function authSettled(): boolean {
  return !authEnabled || authRef !== null;
}

/** Synchronous snapshot; null until the SDK has loaded (use onAuth to wait for the real answer). */
export function currentUser(): AuthUser | null {
  return authRef?.currentUser ? toUser(authRef.currentUser) : null;
}

/** Calls back with the signed-in user (or null) as soon as the stored session is known, then on every change.
 *  Returns the unsubscribe. Reports null once when Firebase is not available. */
export function onAuth(cb: (user: AuthUser | null) => void): () => void {
  let cancelled = false;
  let off: () => void = () => {};
  void load().then((loaded) => {
    if (cancelled) return;
    if (!loaded) return cb(null);
    off = loaded.sdk.onIdTokenChanged(loaded.auth, (u) => {
      if (!cancelled) cb(u ? toUser(u) : null);
    });
  });
  return () => {
    cancelled = true;
    off();
  };
}

/**
 * The current ID token (the SDK caches it and refreshes it before it expires; `force` asks for a new one, used
 * after a 401). Null when nobody is signed in, Firebase is unavailable, or the SDK took longer than 3 s: a token
 * is never worth holding up a request.
 */
export function idToken(force = false): Promise<string | null> {
  if (!authEnabled) return Promise.resolve(null);
  return withTimeout(
    (async () => {
      const loaded = await load();
      const user = loaded?.auth.currentUser;
      return user ? (await user.getIdToken(force)) || null : null;
    })().catch(() => null),
    TOKEN_WAIT_MS
  );
}

/** True when the signed-in user carries the `admin` custom claim (the admin page's switch). False for nobody,
 *  anonymous devices and any failure: never throws. The server checks the claim again on every admin route. */
export async function isAdmin(): Promise<boolean> {
  try {
    const loaded = await load();
    const user = loaded?.auth.currentUser;
    if (!user || user.isAnonymous) return false;
    const result = await withTimeout(user.getIdTokenResult(), TOKEN_WAIT_MS);
    return result?.claims?.admin === true;
  } catch {
    return false;
  }
}
