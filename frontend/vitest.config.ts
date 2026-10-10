import {defineConfig} from 'vitest/config';

// Unit tests for the parts of the PWA that carry logic (API error mapping, the recognizer wrapper, dictionary parity).
// Screens are checked in a browser; this file deliberately does not load vite.config.ts (PWA plugin, Tailwind).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
