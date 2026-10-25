import React, {useEffect, useRef, useState} from 'react';
import {
  Bell,
  Check,
  Globe,
  Info,
  Lock,
  LogOut,
  Moon,
  RotateCcw,
  Shield,
  Smartphone,
  Sun,
  Tablet,
  Volume2,
  Sparkles,
} from 'lucide-react';
import {StrictPrivacyToggle} from '../components/StrictPrivacyToggle';
import {TrustedContactSetting} from '../components/TrustedContact';
import {Language, useI18n} from '../i18n';
import {isAdmin} from '../lib/auth';
import * as speech from '../lib/speak';

interface SettingsScreenProps {
  isKioskMode: boolean;
  onSetKioskMode: (enabled: boolean) => void;
  speakEnabled: boolean;
  onToggleSpeak: (enabled: boolean) => void;
  alertGuardians: boolean;
  onToggleAlertGuardians: (enabled: boolean) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onExitKioskConfirm?: () => void;
  onReplayOnboarding?: () => void;
  /** Opens the pilot overview; the link shows only for a signed-in user with the admin claim. */
  onOpenAdmin?: () => void;
  /** Opens the privacy notice. */
  onOpenPrivacy?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  isKioskMode,
  onSetKioskMode,
  speakEnabled,
  onToggleSpeak,
  alertGuardians,
  onToggleAlertGuardians,
  darkMode,
  onToggleDarkMode,
  onExitKioskConfirm,
  onReplayOnboarding,
  onOpenAdmin,
  onOpenPrivacy,
}) => {
  const {lang, setLang, t} = useI18n();

  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (onOpenAdmin) void isAdmin().then((yes) => !cancelled && setAdmin(yes));
    return () => {
      cancelled = true;
    };
  }, [onOpenAdmin]);

  // Long press state for Exit Kiosk (3 seconds)
  const [longPressProgress, setLongPressProgress] = useState(0);
  const [isPressing, setIsPressing] = useState(false);
  const pressTimerRef = useRef<any>(null);
  const progressIntervalRef = useRef<any>(null);

  const startLongPress = () => {
    speech.warmUp();
    setIsPressing(true);
    setLongPressProgress(0);

    const startTime = Date.now();
    const duration = 3000; // 3 seconds

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setLongPressProgress(pct);
    }, 50);

    pressTimerRef.current = setTimeout(() => {
      clearInterval(progressIntervalRef.current);
      setIsPressing(false);
      setLongPressProgress(100);
      onSetKioskMode(false);
      if (onExitKioskConfirm) onExitKioskConfirm();
    }, duration);
  };

  const cancelLongPress = () => {
    setIsPressing(false);
    setLongPressProgress(0);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  };

  const handleTestVoice = () => {
    speech.warmUp();
    speech.testVoice(lang);
  };

  const handleClearCache = () => {
    try {
      localStorage.removeItem('sagi_kiosk_initialized');
      alert(t('settings.reset_cache_alert'));
    } catch {}
  };

  return (
    <div id="settings-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* LANGUAGE PICKER */}
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5 text-base font-bold text-gray-900 dark:text-white">
          <Globe className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
          <span>{t('settings.lang_label')}</span>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {(['ja', 'vi', 'en'] as Language[]).map((l) => (
            <button
              key={l}
              onClick={() => {
                speech.warmUp();
                setLang(l);
              }}
              className={`py-3 px-2 rounded-2xl border-2 text-sm font-bold transition flex items-center justify-center gap-1.5 ${
                lang === l
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[#1B4D3E] dark:border-emerald-400 text-[#1B4D3E] dark:text-emerald-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400'
              }`}
            >
              <span>{l === 'ja' ? t('settings.lang_ja') : l === 'vi' ? t('settings.lang_vi') : t('settings.lang_en')}</span>
              {lang === l && <Check className="w-4 h-4 text-emerald-600" />}
            </button>
          ))}
        </div>
      </div>

      {/* LIVE GUARD MODE: MANUAL VS KIOSK */}
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs space-y-4">
        <div>
          <div className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Tablet className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
            <span>{t('settings.mode_label')}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('settings.kiosk_desc')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Manual */}
          <button
            onClick={() => onSetKioskMode(false)}
            className={`p-4 rounded-2xl border-2 text-left transition ${
              !isKioskMode
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[#1B4D3E] dark:border-emerald-400 shadow-sm'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-400'
            }`}
          >
            <div className="font-bold text-base text-gray-900 dark:text-white">
              {t('settings.mode_manual')}
            </div>
            <div className="text-xs mt-1 text-gray-500 dark:text-gray-400">
              {t('settings.mode_manual_desc')}
            </div>
          </button>

          {/* Kiosk */}
          <button
            onClick={() => onSetKioskMode(true)}
            className={`p-4 rounded-2xl border-2 text-left transition ${
              isKioskMode
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[#1B4D3E] dark:border-emerald-400 shadow-sm'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-400'
            }`}
          >
            <div className="font-bold text-base text-gray-900 dark:text-white flex items-center justify-between">
              <span>{t('settings.mode_kiosk')}</span>
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                {t('settings.kiosk_recommended')}
              </span>
            </div>
            <div className="text-xs mt-1 text-gray-500 dark:text-gray-400">
              {t('settings.mode_kiosk_desc')}
            </div>
          </button>
        </div>

        {/* Setup guide when Kiosk is enabled */}
        {isKioskMode && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs sm:text-sm space-y-1.5 animate-fade-in">
            <div className="font-black flex items-center gap-1.5 text-amber-950 dark:text-amber-100">
              <Info className="w-4 h-4 text-amber-600" />
              <span>{t('settings.kiosk_guide_title')}</span>
            </div>
            <p className="leading-relaxed whitespace-pre-line">
              {t('settings.kiosk_guide_desc')}
            </p>
          </div>
        )}
      </div>

      {/* SPOKEN WARNING TOGGLE & TEST VOICE */}
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">
                {t('settings.spoken_warning')}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.spoken_desc')}
              </div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={speakEnabled}
            onChange={(e) => onToggleSpeak(e.target.checked)}
            className="w-6 h-6 rounded text-[#1B4D3E] focus:ring-emerald-500 cursor-pointer"
          />
        </div>

        <div className="pt-1">
          <button
            onClick={handleTestVoice}
            className="w-full py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition"
          >
            <Volume2 className="w-4 h-4 text-emerald-600" />
            <span>{t('settings.test_voice')}</span>
          </button>
        </div>
      </div>

      {/* WHO TO CALL BACK: the verification step that defeats "it's me" and deepfake calls */}
      <TrustedContactSetting />

      {/* LIVE GUARD TEXT GATE: periodic AI check (default) vs rules-first (strict privacy) */}
      <StrictPrivacyToggle />

      {/* ALERT GUARDIANS TOGGLE */}
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">
              {t('settings.guardian_alert')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.guardian_alert_desc')}
            </div>
          </div>
        </div>
        <input
          type="checkbox"
          checked={alertGuardians}
          onChange={(e) => onToggleAlertGuardians(e.target.checked)}
          className="w-6 h-6 rounded text-[#1B4D3E] focus:ring-emerald-500 cursor-pointer"
        />
      </div>

      {/* DARK MODE TOGGLE */}
      <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-gray-200">
            {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          </div>
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">
              {t('settings.dark_mode')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.dark_mode_desc')}
            </div>
          </div>
        </div>
        <input
          type="checkbox"
          checked={darkMode}
          onChange={onToggleDarkMode}
          className="w-6 h-6 rounded text-[#1B4D3E] focus:ring-emerald-500 cursor-pointer"
        />
      </div>

      {/* Onboarding Guide Replay */}
      {onReplayOnboarding && (
        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
              <span>{t('onboarding.replay_btn')}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('onboarding.replay_desc')}
            </p>
          </div>
          <button
            id="replay-onboarding-btn"
            onClick={onReplayOnboarding}
            className="px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950 dark:hover:bg-emerald-900 text-[#1B4D3E] dark:text-emerald-300 font-bold text-xs shrink-0 transition"
          >
            {t('common.open')}
          </button>
        </div>
      )}

      {/* Privacy notice */}
      {onOpenPrivacy && (
        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-base font-bold text-gray-900 dark:text-white">{t('settings.privacy_link')}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.privacy_desc')}</p>
          </div>
          <button
            id="open-privacy-btn"
            onClick={onOpenPrivacy}
            className="px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950 dark:hover:bg-emerald-900 text-[#1B4D3E] dark:text-emerald-300 font-bold text-xs shrink-0 transition"
          >
            {t('common.open')}
          </button>
        </div>
      )}

      {/* Pilot overview: only for a signed-in administrator (the server checks the claim again) */}
      {admin && onOpenAdmin && (
        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-base font-bold text-gray-900 dark:text-white">{t('admin.title')}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('admin.settings_desc')}</p>
          </div>
          <button
            id="open-admin-btn"
            onClick={onOpenAdmin}
            className="px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950 dark:hover:bg-emerald-900 text-[#1B4D3E] dark:text-emerald-300 font-bold text-xs shrink-0 transition"
          >
            {t('common.open')}
          </button>
        </div>
      )}

      {/* HARDENED EXIT KIOSK BUTTON (3-SECOND LONG PRESS REQUIREMENT) */}
      {isKioskMode && (
        <div className="p-5 rounded-3xl bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-900 space-y-3">
          <div className="flex items-center gap-2 text-red-900 dark:text-red-200 font-black text-sm">
            <Lock className="w-4 h-4" />
            <span>{t('settings.kiosk_unlock_title')}</span>
          </div>
          <p className="text-xs text-red-700 dark:text-red-300">
            {t('settings.kiosk_unlock_hint')}
          </p>

          <div className="relative overflow-hidden rounded-2xl">
            <button
              id="exit-kiosk-longpress-btn"
              onMouseDown={startLongPress}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={startLongPress}
              onTouchEnd={cancelLongPress}
              className="w-full min-h-[56px] bg-red-700 active:bg-red-800 text-white font-black text-base flex items-center justify-center gap-2 select-none relative z-10 transition shadow"
            >
              <LogOut className="w-5 h-5" />
              <span>
                {isPressing
                  ? t('settings.pressing_kiosk', {progress: longPressProgress})
                  : t('settings.btn_exit_kiosk')}
              </span>
            </button>

            {/* Progress bar background fill during press */}
            {isPressing && (
              <div
                className="absolute inset-0 bg-yellow-400 opacity-40 transition-all z-20 pointer-events-none"
                style={{width: `${longPressProgress}%`}}
              />
            )}
          </div>
        </div>
      )}

      {/* Reset Cache / Data */}
      <div className="pt-2 flex justify-center">
        <button
          onClick={handleClearCache}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('settings.reset_cache')}</span>
        </button>
      </div>
    </div>
  );
};
