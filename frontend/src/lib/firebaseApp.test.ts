import {afterEach, describe, expect, it, vi} from 'vitest';

// firebaseApp.ts reads the build values when imported: each case imports a fresh copy under its own env.
const load = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('./firebaseApp');
};

afterEach(() => vi.unstubAllEnvs());

describe('firebaseConfig.authDomain', () => {
  it('defaults to <project>.firebaseapp.com: without it the Google popup throws auth/auth-domain-config-required', async () => {
    const {firebaseConfig} = await load({VITE_FIREBASE_PROJECT_ID: 'sagi-proj', VITE_FIREBASE_AUTH_DOMAIN: ''});
    expect(firebaseConfig.authDomain).toBe('sagi-proj.firebaseapp.com');
  });

  it('an explicit VITE_FIREBASE_AUTH_DOMAIN wins', async () => {
    const {firebaseConfig} = await load({VITE_FIREBASE_PROJECT_ID: 'sagi-proj', VITE_FIREBASE_AUTH_DOMAIN: 'login.example.test'});
    expect(firebaseConfig.authDomain).toBe('login.example.test');
  });

  it('stays undefined without a project id', async () => {
    const {firebaseConfig} = await load({VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_AUTH_DOMAIN: ''});
    expect(firebaseConfig.authDomain).toBeUndefined();
  });
});
