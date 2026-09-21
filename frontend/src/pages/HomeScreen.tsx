import React, {useEffect, useState} from 'react';
import {
  AlertTriangle,
  ChevronRight,
  CreditCard,
  HelpCircle,
  LifeBuoy,
  PhoneCall,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  Volume2,
} from 'lucide-react';
import {TabType} from '../components/BottomNav';
import {PWAInstallButton} from '../components/PWAInstallButton';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface HomeScreenProps {
  onNavigate: (tab: TabType) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({onNavigate}) => {
  const {t} = useI18n();

  // Rotating tips state
  const tips = [
    t('home.tips.0'),
    t('home.tips.1'),
    t('home.tips.2'),
    t('home.tips.3'),
  ];
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [tips.length]);

  return (
    <div id="home-screen" className="max-w-2xl mx-auto px-4 py-6 sm:py-8 space-y-6 animate-fade-in">
      {/* Hero Welcome with Rotating Tip */}
      <div className="bg-gradient-to-br from-[#1B4D3E] to-[#143C30] rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden">
        {/* Subtle decorative crest */}
        <div className="absolute -right-8 -bottom-8 opacity-10 pointer-events-none">
          <Shield className="w-56 h-56 text-white" />
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-emerald-200 text-xs font-bold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
            <span>{t('home.badge_safety')}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-snug">
            {t('home.title')}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-emerald-100/90 font-medium">
            {t('home.subtitle')}
          </p>

          {/* Rotating Tip Box */}
          <div
            id="rotating-tip-box"
            className="mt-5 rounded-2xl bg-black/25 backdrop-blur-sm p-3.5 sm:p-4 border border-white/15 flex items-start gap-3"
          >
            <div className="p-2 rounded-xl bg-yellow-400 text-[#143C30] flex-shrink-0 mt-0.5">
              <Volume2 className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-yellow-300 uppercase tracking-wide">
                {t('home.tips_title')}
              </div>
              <p className="mt-1 text-sm sm:text-base font-semibold text-white leading-snug transition-all duration-300">
                「{tips[tipIndex]}」
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* THREE HUGE PRIMARY BUTTONS (Elderly-First Accessibility min 64px tall) */}
      <div className="space-y-4">
        {/* 1. Live Guard */}
        <button
          id="home-btn-live-guard"
          onClick={() => {
            speech.warmUp();
            onNavigate('guard');
          }}
          className="w-full min-h-[84px] sm:min-h-[96px] p-4 sm:p-5 rounded-3xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white shadow-lg border-2 border-emerald-500/40 flex items-center justify-between transition-all group"
          aria-label={t('home.aria_guard')}
        >
          <div className="flex items-center gap-4 text-left">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/20 flex items-center justify-center text-yellow-300 group-hover:scale-110 transition-transform flex-shrink-0">
              <PhoneCall className="w-8 h-8 sm:w-9 sm:h-9" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-black tracking-tight leading-tight">
                {t('home.btn_live')}
              </div>
              <div className="text-xs sm:text-sm font-semibold text-emerald-100 mt-1">
                {t('home.btn_live_desc')}
              </div>
            </div>
          </div>
          <ChevronRight className="w-7 h-7 text-emerald-200 group-hover:translate-x-1 transition-transform flex-shrink-0" />
        </button>

        {/* 2. Quick Check */}
        <button
          id="home-btn-quick-check"
          onClick={() => {
            speech.warmUp();
            onNavigate('quick');
          }}
          className="w-full min-h-[84px] sm:min-h-[96px] p-4 sm:p-5 rounded-3xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-[0.98] text-white shadow-lg border-2 border-emerald-600/40 flex items-center justify-between transition-all group"
          aria-label={t('home.aria_quick')}
        >
          <div className="flex items-center gap-4 text-left">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/20 flex items-center justify-center text-yellow-300 group-hover:scale-110 transition-transform flex-shrink-0">
              <Search className="w-8 h-8 sm:w-9 sm:h-9" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-black tracking-tight leading-tight">
                {t('home.btn_quick')}
              </div>
              <div className="text-xs sm:text-sm font-semibold text-emerald-100 mt-1">
                {t('home.btn_quick_desc')}
              </div>
            </div>
          </div>
          <ChevronRight className="w-7 h-7 text-emerald-200 group-hover:translate-x-1 transition-transform flex-shrink-0" />
        </button>

        {/* 3. Before You Pay */}
        <button
          id="home-btn-before-pay"
          onClick={() => {
            speech.warmUp();
            onNavigate('pay');
          }}
          className="w-full min-h-[84px] sm:min-h-[96px] p-4 sm:p-5 rounded-3xl bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white shadow-lg border-2 border-amber-400/40 flex items-center justify-between transition-all group"
          aria-label={t('home.aria_pay')}
        >
          <div className="flex items-center gap-4 text-left">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/20 flex items-center justify-center text-yellow-200 group-hover:scale-110 transition-transform flex-shrink-0">
              <CreditCard className="w-8 h-8 sm:w-9 sm:h-9" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-black tracking-tight leading-tight">
                {t('home.btn_pay')}
              </div>
              <div className="text-xs sm:text-sm font-semibold text-amber-100 mt-1">
                {t('home.btn_pay_desc')}
              </div>
            </div>
          </div>
          <ChevronRight className="w-7 h-7 text-amber-200 group-hover:translate-x-1 transition-transform flex-shrink-0" />
        </button>
      </div>

      {/* QUIETER BUT ALWAYS-VISIBLE RECOVERY BUTTON */}
      <div className="pt-2">
        <button
          id="home-btn-already-paid"
          onClick={() => {
            speech.warmUp();
            onNavigate('recovery');
          }}
          className="w-full min-h-[64px] p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 border-2 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 flex items-center justify-between transition-all"
          aria-label={t('home.aria_recovery')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-600 text-white flex-shrink-0">
              <LifeBuoy className="w-6 h-6 animate-pulse" />
            </div>
            <div className="text-left">
              <div className="text-base sm:text-lg font-bold">
                {t('home.btn_recovery')}
              </div>
              <div className="text-xs text-red-700 dark:text-red-300">
                {t('home.recovery_desc')}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-red-600 dark:text-red-400" />
        </button>
      </div>

      {/* SMALL SECONDARY LINKS */}
      <div className="pt-3 border-t border-gray-200 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
        <button
          id="home-link-family"
          onClick={() => onNavigate('family')}
          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-800 dark:text-gray-200 flex flex-col items-center gap-1.5 transition"
        >
          <Users className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
          <span className="text-xs font-bold">{t('nav.family')}</span>
        </button>

        <button
          id="home-link-community"
          onClick={() => onNavigate('community')}
          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-800 dark:text-gray-200 flex flex-col items-center gap-1.5 transition"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="text-xs font-bold">{t('nav.community')}</span>
        </button>

        <button
          id="home-link-how"
          onClick={() => onNavigate('how_it_works')}
          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-800 dark:text-gray-200 flex flex-col items-center gap-1.5 transition"
        >
          <HelpCircle className="w-5 h-5 text-blue-500" />
          <span className="text-xs font-bold">{t('nav.how_it_works')}</span>
        </button>

        <button
          id="home-link-settings"
          onClick={() => onNavigate('settings')}
          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-800 dark:text-gray-200 flex flex-col items-center gap-1.5 transition"
        >
          <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <span className="text-xs font-bold">{t('nav.settings')}</span>
        </button>
      </div>

      {/* PWA Install Banner */}
      <div className="pt-2">
        <PWAInstallButton className="w-full justify-center min-h-[52px]" />
      </div>

      {/* Privacy Notice Stamp */}
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-2 pb-6">
        {t('live.privacy_line')}
      </div>
    </div>
  );
};
