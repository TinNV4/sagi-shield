/**
 * The PWA's one Firebase app, shared by App Check (appCheck.ts) and guardian push (push.ts): initializeApp twice
 * would throw. Public build values (infra/setup_appcheck.ps1): VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID /
 * VITE_FIREBASE_PROJECT_ID. The FCM sender id is the project number, the second part of the web app id.
 * authDomain hosts the sign-in popup / redirect handler (`/__/auth/handler`); without it @firebase/auth throws
 * auth/auth-domain-config-required on the Google popup. Optional VITE_FIREBASE_AUTH_DOMAIN, else <project>.firebaseapp.com.
 */
import type {FirebaseApp} from 'firebase/app';

const env = import.meta.env;
const appId: string | undefined = env.VITE_FIREBASE_APP_ID;
const projectId = (env.VITE_FIREBASE_PROJECT_ID as string | undefined) || undefined;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  appId,
  projectId,
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || (projectId ? `${projectId}.firebaseapp.com` : undefined),
  messagingSenderId: appId?.split(':')[1],
};
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId);

let app: Promise<FirebaseApp> | null = null;

/** Loads the SDK in its own chunk on first use. */
export function firebaseApp(): Promise<FirebaseApp> {
  app ??= import('firebase/app').then((firebase) => firebase.initializeApp(firebaseConfig));
  return app;
}
