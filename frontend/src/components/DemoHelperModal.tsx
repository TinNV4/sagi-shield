import React, {useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  RotateCcw,
  ShieldAlert,
  Volume2,
  X,
  Sparkles,
  Users,
  Wrench,
  Cpu,
  Server,
} from 'lucide-react';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';
import {API_BASE, isMockModeActive, setMockMode} from '../api/client';

interface DemoHelperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTriggerHighRiskLive: () => void;
  onTriggerGuardianAlert: () => void;
  onTriggerSessionReset: () => void;
  onOpenOnboarding?: () => void;
}

export const DemoHelperModal: React.FC<DemoHelperModalProps> = ({
  isOpen,
  onClose,
  onTriggerHighRiskLive,
  onTriggerGuardianAlert,
  onTriggerSessionReset,
  onOpenOnboarding,
}) => {
  const {t, lang} = useI18n();
  const [mockActive, setMockActiveState] = useState<boolean>(isMockModeActive());
  const [healthStatus, setHealthStatus] = useState<{
    tested: boolean;
    geminiConfigured: boolean;
    model: string;
    loading: boolean;
  }>({
    tested: false,
    geminiConfigured: false,
    model: 'gemini-3.8-flash',
    loading: false,
  });

  useEffect(() => {
    if (isOpen) {
      setMockActiveState(isMockModeActive());
      checkBackendHealth();
    }
  }, [isOpen]);

  const checkBackendHealth = async () => {
    setHealthStatus((prev) => ({ ...prev, loading: true }));
    try {
      if (!API_BASE) throw new Error('VITE_API_BASE is not set');
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealthStatus({
          tested: true,
          geminiConfigured: !!data.llm,
          model: data.model || 'gemini-3.8-flash',
          loading: false,
        });
      } else {
        setHealthStatus({
          tested: true,
          geminiConfigured: false,
          model: 'offline',
          loading: false,
        });
      }
    } catch {
      setHealthStatus({
        tested: true,
        geminiConfigured: false,
        model: 'offline',
        loading: false,
      });
    }
  };

  const handleToggleMode = (mock: boolean) => {
    speech.warmUp();
    setMockMode(mock);
    setMockActiveState(mock);
  };

  if (!isOpen) return null;

  return (
    <div
      id="demo-helper-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={t('demo.panel_aria')}
    >
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border-2 border-emerald-600 p-5 sm:p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <h3 className="text-lg sm:text-xl font-black text-gray-900 dark:text-white">
              {t('demo.panel_title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label={t('demo.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto pr-1 space-y-4 my-3 text-sm flex-1">
          {/* Engine Selector */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 flex items-center justify-between">
              <span>
                {t('demo.mode_selector_label')}
              </span>
              {healthStatus.tested && (
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                    healthStatus.geminiConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <Server className="w-3 h-3" />
                  {healthStatus.geminiConfigured
                    ? t('demo.real_gemini_active', {model: healthStatus.model})
                    : t('demo.api_key_not_set')}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                id="btn-switch-real-gemini"
                type="button"
                onClick={() => handleToggleMode(false)}
                className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition ${
                  !mockActive
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-400/40'
                    : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                }`}
              >
                <Sparkles
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    !mockActive ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                />
                <div>
                  <div className="font-bold text-xs sm:text-sm flex items-center gap-1">
                    <span>{t('demo.real_gemini_label')}</span>
                    {!mockActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    )}
                  </div>
                  <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                    {t('demo.real_gemini_sub')}
                  </div>
                </div>
              </button>

              <button
                id="btn-switch-demo-mock"
                type="button"
                onClick={() => handleToggleMode(true)}
                className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition ${
                  mockActive
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-500 text-amber-900 dark:text-amber-200 ring-2 ring-amber-400/40'
                    : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                }`}
              >
                <Wrench
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    mockActive ? 'text-amber-600' : 'text-gray-400'
                  }`}
                />
                <div>
                  <div className="font-bold text-xs sm:text-sm flex items-center gap-1">
                    <span>{t('demo.mock_mode_label')}</span>
                    {mockActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    )}
                  </div>
                  <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                    {t('demo.mock_mode_sub')}
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-2.5 text-[11px] text-gray-600 dark:text-gray-400 bg-white/70 dark:bg-slate-900/60 p-2 rounded-md">
              <span>
                {!mockActive ? t('demo.running_real_gemini') : t('demo.running_mock')}
              </span>
            </div>
          </div>

          {/* Action triggers */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              {t('demo.triggers_heading')}
            </div>

            <div className="space-y-2.5">
              <button
                id="demo-trigger-high-btn"
                onClick={() => {
                  onTriggerHighRiskLive();
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-600 text-white">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-red-900 dark:text-red-200 text-sm sm:text-base">
                      {t('demo.trigger_high_title')}
                    </div>
                    <div className="text-xs text-red-700 dark:text-red-300">
                      {t('demo.trigger_high_desc')}
                    </div>
                  </div>
                </div>
                <Play className="w-5 h-5 text-red-600 flex-shrink-0 ml-2" />
              </button>

              <button
                id="demo-trigger-guardian-btn"
                onClick={() => {
                  onTriggerGuardianAlert();
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500 text-white">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-amber-900 dark:text-amber-200 text-sm sm:text-base">
                      {t('demo.trigger_guardian_title')}
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      {t('demo.trigger_guardian_desc')}
                    </div>
                  </div>
                </div>
                <Play className="w-5 h-5 text-amber-600 flex-shrink-0 ml-2" />
              </button>

              <button
                id="demo-trigger-reset-btn"
                onClick={() => {
                  onTriggerSessionReset();
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-700 text-white">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-emerald-900 dark:text-emerald-200 text-sm sm:text-base">
                      {t('demo.trigger_reset_title')}
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300">
                      {t('demo.trigger_reset_desc')}
                    </div>
                  </div>
                </div>
                <Play className="w-5 h-5 text-emerald-600 flex-shrink-0 ml-2" />
              </button>

              <button
                id="demo-test-voice-btn"
                onClick={() => {
                  speech.testVoice(lang);
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gray-700 text-white">
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 dark:text-gray-100 text-sm sm:text-base">
                      {t('demo.test_tts_title')}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {t('demo.test_tts_desc')}
                    </div>
                  </div>
                </div>
                <Volume2 className="w-5 h-5 text-gray-500 flex-shrink-0 ml-2" />
              </button>

              {onOpenOnboarding && (
                <button
                  id="demo-test-onboarding-btn"
                  onClick={() => {
                    onOpenOnboarding();
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#1B4D3E] text-white">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-[#1B4D3E] dark:text-emerald-300 text-sm sm:text-base">
                        {t('demo.trigger_onboarding_title')}
                      </div>
                      <div className="text-xs text-emerald-800/80 dark:text-emerald-400">
                        {t('demo.trigger_onboarding_desc')}
                      </div>
                    </div>
                  </div>
                  <Play className="w-5 h-5 text-emerald-600 flex-shrink-0 ml-2" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold hover:bg-gray-300 transition"
          >
            {t('demo.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
