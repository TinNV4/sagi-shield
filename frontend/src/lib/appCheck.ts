/**
 * Firebase App Check (reCAPTCHA Enterprise): proves to the API that a request comes from this PWA, not a script.
 *
 * Configured at build time by VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID / VITE_FIREBASE_PROJECT_ID /
 * VITE_RECAPTCHA_SITE_KEY (infra/setup_appcheck.ps1 prints them; all public by design). Without them the app sends
 * no token, and the server must run APPCHECK=off. A token is never worth holding up a scam check: after
 * TOKEN_WAIT_MS the request goes without one, and the server answers it on a tighter budget instead of refusing.
 * The Firebase SDK and reCAPTCHA load in their own chunk, after the first screen (startAppCheck in main.tsx).
 */
import type {AppCheck} from 'firebase/app-check';

const env = import.meta.env;
const config = {apiKey: env.VITE_FIREBASE_API_KEY, appId: env.VITE_FIREBASE_APP_ID, projectId: env.VITE_FIREBASE_PROJECT_ID};
const siteKey: string | undefined = env.VITE_RECAPTCHA_SITE_KEY;

export const appCheckEnabled = Boolean(config.apiKey && config.appId && config.projectId && siteKey);
export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
const TOKEN_WAIT_MS = 3000;

let instance: Promise<AppCheck | null> | null = null;

/** Load the SDK and start refreshing tokens in the background; safe to call more than once. */
export function startAppCheck(): Promise<AppCheck | null> {
  if (!appCheckEnabled) return Promise.resolve(null);
  instance ??= Promise.all([import('firebase/app'), import('firebase/app-check')])
    .then(([firebase, appCheck]) =>
      appCheck.initializeAppCheck(firebase.initializeApp(config), {
        provider: new appCheck.ReCaptchaEnterpriseProvider(siteKey!),
        isTokenAutoRefreshEnabled: true,
      })
    )
    .catch((err) => {
      console.warn('App Check unavailable:', err);
      return null;
    });
  return instance;
}

/**
 * A session token for checks (cached and refreshed by the SDK), or a limited-use token for a report (the server
 * consumes it, so it works once). Null when App Check is not configured, failed, or took longer than TOKEN_WAIT_MS.
 */
export function appCheckToken(limitedUse = false): Promise<string | null> {
  if (!appCheckEnabled) return Promise.resolve(null);
  const token = (async () => {
    const appCheck = await startAppCheck();
    if (!appCheck) return null;
    const {getToken, getLimitedUseToken} = await import('firebase/app-check');
    const result = limitedUse ? await getLimitedUseToken(appCheck) : await getToken(appCheck);
    return result.token || null;
  })().catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_WAIT_MS));
  return Promise.race([token, timeout]);
}
