import React, {useState} from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Info,
  Lock,
  PhoneCall,
  Radio,
  Shield,
  Smartphone,
  Sparkles,
  Tablet,
  Users,
  Volume2,
} from 'lucide-react';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (mode: 'kiosk' | 'individual') => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const {t} = useI18n();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedMode, setSelectedMode] = useState<'kiosk' | 'individual'>('kiosk');

  if (!isOpen) return null;

  const handleNext = () => {
    speech.warmUp();
    if (currentStep < 3) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    speech.warmUp();
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    speech.warmUp();
    setCurrentStep(3);
  };

  const handleFinish = (mode: 'kiosk' | 'individual') => {
    speech.warmUp();
    try {
      localStorage.setItem('sagi_onboarding_completed', 'true');
    } catch {}
    onComplete(mode);
  };

  return (
    <div
      id="onboarding-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md overflow-y-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        id="onboarding-card"
        className="w-full max-w-xl bg-white dark:bg-[#13221C] border border-gray-200 dark:border-emerald-900/60 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto transition-all"
      >
        {/* Top Progress & Header Bar */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-emerald-950/20 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#1B4D3E] flex items-center justify-center text-white shadow-sm">
                <Shield className="w-4 h-4 text-emerald-300" />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                  {t('app.name')}
                </span>
                <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {t('onboarding.step_counter', {current: currentStep, total: 3})}
                </div>
              </div>
            </div>

            {currentStep < 3 && (
              <button
                id="onboarding-skip-btn"
                onClick={handleSkip}
                className="text-xs font-bold text-gray-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition"
              >
                {t('onboarding.skip')}
              </button>
            )}
          </div>

          {/* Stepper Progress Indicator */}
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((step) => (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step === currentStep
                    ? 'bg-[#1B4D3E] dark:bg-emerald-400'
                    : step < currentStep
                    ? 'bg-emerald-300 dark:bg-emerald-700'
                    : 'bg-gray-200 dark:bg-gray-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step Content Container */}
        <div className="p-6 sm:p-8 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* ================================================================ */}
          {/* STEP 1: Live Guard Acoustic Placement */}
          {/* ================================================================ */}
          {currentStep === 1 && (
            <div id="onboarding-step-1" className="space-y-6 animate-fade-in">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold mb-2">
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>{t('onboarding.step1_badge')}</span>
                </div>
                <h2 id="onboarding-title" className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                  {t('onboarding.step1_title')}
                </h2>
                <p className="mt-1.5 text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
                  {t('onboarding.step1_subtitle')}
                </p>
              </div>

              {/* Placement Visual Diagram */}
              <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80">
                <div className="flex flex-col sm:flex-row items-center justify-around gap-4 text-center">
                  {/* Phone on Speaker */}
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 border-2 border-emerald-300 dark:border-emerald-600 shadow-md flex items-center justify-center relative">
                      <PhoneCall className="w-7 h-7 text-emerald-700 dark:text-emerald-300" />
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 items-center justify-center text-[8px] text-white font-bold">
                          <Volume2 className="w-2.5 h-2.5" />
                        </span>
                      </span>
                    </div>
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                      {t('onboarding.step1_illustration_speaker')}
                    </span>
                  </div>

                  {/* Distance Distance Line */}
                  <div className="flex sm:flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl bg-white/90 dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 shadow-xs">
                    <div className="flex items-center gap-1 text-[#1B4D3E] dark:text-emerald-300 font-mono font-black text-xs">
                      <span>↔</span>
                      <span>{t('onboarding.step1_illustration_distance')}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      Acoustic air link
                    </span>
                  </div>

                  {/* Sagi Shield Device */}
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-14 h-14 rounded-2xl bg-[#1B4D3E] text-white shadow-md flex items-center justify-center relative border-2 border-emerald-400">
                      <Shield className="w-7 h-7 text-emerald-200" />
                      <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-emerald-500 text-[9px] font-black text-white">
                        AI
                      </span>
                    </div>
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                      {t('onboarding.step1_illustration_guard')}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3 Strategic Placement Points */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center shrink-0 text-sm">
                    1
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step1_speaker_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step1_speaker_desc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center shrink-0 text-sm">
                    2
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step1_distance_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step1_distance_desc')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center shrink-0 text-sm">
                    3
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step1_acoustic_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step1_acoustic_desc')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Helpful Tip */}
              <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{t('onboarding.step1_tip')}</span>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* STEP 2: Educational Note About Local Audio Processing */}
          {/* ================================================================ */}
          {currentStep === 2 && (
            <div id="onboarding-step-2" className="space-y-6 animate-fade-in">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold mb-2">
                  <Lock className="w-3.5 h-3.5" />
                  <span>{t('onboarding.step2_badge')}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                  {t('onboarding.step2_title')}
                </h2>
                <p className="mt-1.5 text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
                  {t('onboarding.step2_subtitle')}
                </p>
              </div>

              {/* Prominent Privacy Seal Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-900 to-[#143C30] text-white shadow-md flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
                  <CloudOff className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <div className="text-sm font-black tracking-wide text-white flex items-center gap-2">
                    <span>{t('onboarding.step2_zero_cloud_badge')}</span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-400/20 text-emerald-300 text-[10px] font-bold">
                      100% On-Device
                    </span>
                  </div>
                  <p className="text-xs text-emerald-100/90 mt-0.5 leading-relaxed">
                    {t('onboarding.step2_privacy_notice')}
                  </p>
                </div>
              </div>

              {/* 3 Privacy Guarantees */}
              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                    <CloudOff className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step2_point1_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step2_point1_desc')}
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step2_point2_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step2_point2_desc')}
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-900/60 border border-gray-100 dark:border-gray-800 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-white">
                      {t('onboarding.step2_point3_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {t('onboarding.step2_point3_desc')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* STEP 3: Choice between Kiosk and Individual */}
          {/* ================================================================ */}
          {currentStep === 3 && (
            <div id="onboarding-step-3" className="space-y-6 animate-fade-in">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold mb-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('onboarding.step3_badge')}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                  {t('onboarding.step3_title')}
                </h2>
                <p className="mt-1.5 text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
                  {t('onboarding.step3_subtitle')}
                </p>
              </div>

              {/* The Two Mutually Exclusive Options */}
              <div className="space-y-4">
                {/* Option 1: Family Guardian (Kiosk) */}
                <div
                  id="choice-kiosk-card"
                  onClick={() => setSelectedMode('kiosk')}
                  className={`p-5 rounded-3xl border-2 cursor-pointer transition-all ${
                    selectedMode === 'kiosk'
                      ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-[#1B4D3E] dark:border-emerald-400 shadow-md ring-2 ring-emerald-500/20'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 hover:border-emerald-300 dark:hover:border-emerald-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-[#1B4D3E] text-white flex items-center justify-center shadow-sm">
                        <Tablet className="w-6 h-6 text-emerald-300" />
                      </div>
                      <div>
                        <div className="font-black text-base text-gray-900 dark:text-white">
                          {t('onboarding.choice_kiosk_title')}
                        </div>
                        <span className="inline-block mt-0.5 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200">
                          {t('onboarding.choice_kiosk_badge')}
                        </span>
                      </div>
                    </div>

                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedMode === 'kiosk'
                        ? 'border-[#1B4D3E] dark:border-emerald-400 bg-[#1B4D3E] dark:bg-emerald-400 text-white dark:text-slate-950'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {selectedMode === 'kiosk' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <p className="mt-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {t('onboarding.choice_kiosk_desc')}
                  </p>

                  <div className="mt-4 pt-3 border-t border-emerald-200/60 dark:border-emerald-900/40">
                    <button
                      id="btn-choose-kiosk"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFinish('kiosk');
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-[0.99] text-white font-black text-sm flex items-center justify-center gap-2 shadow-md transition"
                    >
                      <span>{t('onboarding.choice_kiosk_btn')}</span>
                      <ArrowRight className="w-4 h-4 text-emerald-300" />
                    </button>
                  </div>
                </div>

                {/* Option 2: Use as an Individual */}
                <div
                  id="choice-individual-card"
                  onClick={() => setSelectedMode('individual')}
                  className={`p-5 rounded-3xl border-2 cursor-pointer transition-all ${
                    selectedMode === 'individual'
                      ? 'bg-teal-50/90 dark:bg-teal-950/40 border-teal-700 dark:border-teal-400 shadow-md ring-2 ring-teal-500/20'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 hover:border-teal-300 dark:hover:border-teal-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-teal-800 text-white flex items-center justify-center shadow-sm">
                        <Smartphone className="w-6 h-6 text-teal-300" />
                      </div>
                      <div>
                        <div className="font-black text-base text-gray-900 dark:text-white">
                          {t('onboarding.choice_individual_title')}
                        </div>
                        <span className="inline-block mt-0.5 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-900 dark:text-teal-200">
                          {t('onboarding.choice_individual_badge')}
                        </span>
                      </div>
                    </div>

                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedMode === 'individual'
                        ? 'border-teal-700 dark:border-teal-400 bg-teal-700 dark:bg-teal-400 text-white dark:text-slate-950'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {selectedMode === 'individual' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <p className="mt-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {t('onboarding.choice_individual_desc')}
                  </p>

                  <div className="mt-4 pt-3 border-t border-teal-200/60 dark:border-teal-900/40">
                    <button
                      id="btn-choose-individual"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFinish('individual');
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-[0.99] text-white font-black text-sm flex items-center justify-center gap-2 shadow-md transition"
                    >
                      <span>{t('onboarding.choice_individual_btn')}</span>
                      <ArrowRight className="w-4 h-4 text-teal-200" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation Control Bar */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800/80 bg-gray-50/80 dark:bg-slate-900/60 flex items-center justify-between gap-3">
          {currentStep > 1 ? (
            <button
              id="onboarding-back-btn"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 font-bold text-xs sm:text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{t('onboarding.back')}</span>
            </button>
          ) : (
            <div />
          )}

          {currentStep < 3 && (
            <button
              id="onboarding-next-btn"
              onClick={handleNext}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-95 text-white font-black text-xs sm:text-sm shadow-md transition"
            >
              <span>{t('onboarding.next')}</span>
              <ChevronRight className="w-4 h-4 text-emerald-300" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
