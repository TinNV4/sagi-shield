import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it} from 'vitest';
import {I18nProvider} from '../i18n';
import {PrivacyScreen} from './PrivacyScreen';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

describe('PrivacyScreen', () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  for (const lang of ['ja', 'vi', 'en']) {
    it(`renders the ${lang} notice with its date and no unresolved placeholder`, async () => {
      localStorage.setItem('sagi_lang', lang);
      const host = document.createElement('div');
      document.body.appendChild(host);
      await act(async () => {
        createRoot(host).render(React.createElement(I18nProvider, null, React.createElement(PrivacyScreen, {onBack: () => {}})));
      });
      const text = host.textContent ?? '';
      expect(text).not.toContain('{');
      expect(text).toContain('2026');
      expect(host.querySelectorAll('section').length).toBe(7);
    });
  }
});
