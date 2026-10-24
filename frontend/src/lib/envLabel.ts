/**
 * Environment badge. VITE_ENV_LABEL=PILOT is baked into the pilot build (deploy-pilot.yml) so a relative can tell the
 * pilot install from the production one: a badge in the header and distinct PWA names on the home screen.
 * Production builds leave it unset. Pure functions: vite.config.ts and the header share them.
 */

const MAX_LABEL = 12;

export function envLabel(raw: string | undefined): string {
  return (raw || '').trim().toUpperCase().slice(0, MAX_LABEL);
}

export function pwaNames(label: string): {name: string; short_name: string} {
  return label ? {name: `Sagi Shield (${label})`, short_name: `Sagi ${label}`} : {name: 'Sagi Shield', short_name: 'SagiShield'};
}
