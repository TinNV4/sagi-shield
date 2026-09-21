import React, {createContext, useContext, useEffect, useState} from 'react';
import en from './en.json';
import ja from './ja.json';
import vi from './vi.json';

export type Language = 'ja' | 'vi' | 'en';

const translations: Record<Language, any> = {
  ja,
  vi,
  en,
};

interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
  isRTL?: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('sagi_lang');
      if (saved === 'ja' || saved === 'vi' || saved === 'en') {
        return saved;
      }
      // Check browser language
      const browser = navigator.language.slice(0, 2);
      if (browser === 'vi') return 'vi';
      if (browser === 'en') return 'en';
      return 'ja';
    } catch {
      return 'ja';
    }
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem('sagi_lang', newLang);
      document.documentElement.lang = newLang;
    } catch {}
  };

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {}
  }, [lang]);

  const t = (path: string, params?: Record<string, string | number>): string => {
    const keys = path.split('.');
    let current: any = translations[lang] || translations.ja;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        // Fallback to Japanese
        let fallback: any = translations.ja;
        for (const fKey of keys) {
          if (fallback && typeof fallback === 'object' && fKey in fallback) {
            fallback = fallback[fKey];
          } else {
            fallback = undefined;
            break;
          }
        }
        current = fallback !== undefined ? fallback : path;
        break;
      }
    }

    if (typeof current !== 'string') {
      return path;
    }

    if (params) {
      return Object.entries(params).reduce((acc, [paramKey, paramVal]) => {
        return acc.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramVal));
      }, current);
    }

    return current;
  };

  return (
    <I18nContext.Provider value={{lang, setLang, t}}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
