import React, {useEffect, useState} from 'react';
import {Globe, Moon, Shield, Sparkles, Sun, Wrench} from 'lucide-react';
import {api, isMockModeActive} from '../api/client';
import {envLabel} from '../lib/envLabel';
import {Language, useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenDemoHelper: () => void;
  onNavigateHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  onOpenDemoHelper,
  onNavigateHome,
}) => {
  const {lang, setLang, t} = useI18n();
  const [mockActive, setMockActive] = useState<boolean>(isMockModeActive());
  const label = envLabel(import.meta.env.VITE_ENV_LABEL); // PILOT on the pilot build, empty in production

  useEffect(() => {
    const handleModeChange = (e: any) => {
      setMockActive(e.detail ?? isMockModeActive());
    };
    window.addEventListener('sagi-api-mode-changed', handleModeChange);
    return () => window.removeEventListener('sagi-api-mode-changed', handleModeChange);
  }, []);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    speech.warmUp();
    setLang(e.target.value as Language);
  };

  return (
    <header
      id="app-header"
      className="sticky top-0 z-40 w-full bg-white/95 dark:bg-[#122620]/95 backdrop-blur-md border-b border-emerald-950/10 dark:border-emerald-800/30 transition-colors"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            id="header-brand-btn"
            onClick={() => {
              speech.warmUp();
              onNavigateHome();
            }}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[#1B4D3E] flex items-center justify-center text-yellow-300 shadow-md hover:scale-105 transition-transform flex-shrink-0 focus:outline-none"
            aria-label="Sagi Shield Home"
          >
            <Shield className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <button
                id="header-brand-title-btn"
                onClick={() => {
                  speech.warmUp();
                  onNavigateHome();
                }}
                className="text-lg sm:text-2xl font-black tracking-tight text-[#1B4D3E] dark:text-emerald-400 hover:opacity-90 transition text-left focus:outline-none truncate min-w-0"
              >
                {t('app.name')}
              </button>

              {/* AI Engine & Demo Mode Badge */}
              {mockActive ? (
                <button
                  id="engine-badge-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    speech.warmUp();
                    onOpenDemoHelper();
                  }}
                  className="hidden min-[420px]:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 border border-amber-400 text-amber-900 dark:text-amber-200 text-[10px] sm:text-xs font-black tracking-wider uppercase shadow-xs hover:bg-amber-200 transition"
                  title={t('header.demo_title')}
                >
                  <Wrench className="w-3 h-3 text-amber-600" />
                  <span>{t('header.demo_badge')}</span>
                </button>
              ) : label ? (
                <span
                  id="engine-badge-btn"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 border border-sky-400 text-sky-900 dark:text-sky-200 text-[10px] sm:text-xs font-black tracking-wider uppercase shadow-xs"
                  title="Pilot environment"
                >
                  <Wrench className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                  <span>{label}</span>
                </span>
              ) : (
                <button
                  id="engine-badge-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    speech.warmUp();
                    onOpenDemoHelper();
                  }}
                  className="hidden min-[420px]:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-400 text-emerald-900 dark:text-emerald-200 text-[10px] sm:text-xs font-black tracking-wider uppercase shadow-xs hover:bg-emerald-200 transition"
                  title={t('header.gemini_title')}
                >
                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>{t('header.gemini_badge')}</span>
                </button>
              )}
            </div>
            <p className="hidden sm:block text-xs font-semibold text-gray-500 dark:text-gray-400 truncate max-w-[280px]">
              {t('app.tagline')}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          {/* No install button here: on iOS it renders as a long "Note for iPhone users" pill and crowds the bar.
              Home has the install entry at the bottom of the page. */}

          {/* Language Switcher */}
          <div className="relative inline-flex items-center rounded-xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 px-1.5 sm:px-2 py-1">
            <Globe className="hidden sm:block w-4 h-4 text-gray-500 mr-1 flex-shrink-0" />
            <select
              id="language-select"
              value={lang}
              onChange={handleLanguageChange}
              className="bg-transparent text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-100 focus:outline-none cursor-pointer pr-1"
              aria-label={t('header.select_language')}
            >
              <option value="ja" className="text-black">{t('settings.lang_ja')}</option>
              <option value="vi" className="text-black">{t('settings.lang_vi')}</option>
              <option value="en" className="text-black">{t('settings.lang_en')}</option>
            </select>
          </div>

          {/* Dark Mode Toggle */}
          <button
            id="theme-toggle-btn"
            onClick={() => {
              speech.warmUp();
              onToggleDarkMode();
            }}
            className="p-2 sm:p-2.5 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition"
            aria-label={t('header.toggle_dark_mode')}
          >
            {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </header>
  );
};
