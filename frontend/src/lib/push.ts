/**
 * Guardian push (Firebase Cloud Messaging, web push): the guardian's browser gets an FCM token, the API sends a
 * HIGH alert to it (backend/app/notifier.py), and the PWA's service worker shows it (public/push-sw.js) even when
 * the dashboard is closed. The dashboard keeps polling too, so an alert never depends on push.
 *
 * Needs the Firebase build values (firebaseApp.ts) plus VITE_FIREBASE_VAPID_KEY (the public Web Push key). iPhone
 * delivers web push only to a PWA added to the home screen (iOS 16.4+); elsewhere pushSupported() says no.
 */
import {firebaseApp, firebaseConfigured} from './firebaseApp';

const vapidKey: string | undefined = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const TOKEN_WAIT_MS = 10000;

export const pushConfigured = firebaseConfigured && Boolean(vapidKey);

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export const pushPermission = (): PushPermission =>
  pushConfigured && pushSupported() ? (Notification.permission as PushPermission) : 'unsupported';

/**
 * Asks for permission (call it from a click: browsers ignore prompts without one) and returns this browser's FCM
 * token, or null when push is unavailable, refused, or slower than TOKEN_WAIT_MS. Never throws: pairing goes on.
 */
export async function pushToken(): Promise<string | null> {
  if (pushPermission() === 'unsupported') return null;
  try {
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return null;
    const token = (async () => {
      const [app, messaging] = await Promise.all([firebaseApp(), import('firebase/messaging')]);
      if (!(await messaging.isSupported())) return null;
      // the PWA's own service worker receives the push: no second worker, no Firebase code inside it
      const registration = await navigator.serviceWorker.ready;
      return (await messaging.getToken(messaging.getMessaging(app), {vapidKey, serviceWorkerRegistration: registration})) || null;
    })().catch((err) => {
      console.warn('Push unavailable:', err);
      return null;
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_WAIT_MS));
    return await Promise.race([token, timeout]);
  } catch {
    return null;
  }
}
