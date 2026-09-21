import React from 'react';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  EyeOff,
  Headphones,
  Lock,
  PhoneCall,
  Shield,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react';
import {useI18n} from '../i18n';

interface HowItWorksScreenProps {
  onBack: () => void;
}

export const HowItWorksScreen: React.FC<HowItWorksScreenProps> = ({onBack}) => {
  const {t} = useI18n();

  const steps = [
    {
      num: 1,
      title: t('how.step1_title'),
      desc: t('how.step1_desc'),
      icon: Headphones,
      badge: t('how.step1_badge'),
    },
    {
      num: 2,
      title: t('how.step2_title'),
      desc: t('how.step2_desc'),
      icon: Zap,
      badge: t('how.step2_badge'),
    },
    {
      num: 3,
      title: t('how.step3_title'),
      desc: t('how.step3_desc'),
      icon: ShieldAlert,
      badge: t('how.step3_badge'),
    },
  ];

  return (
    <div id="how-it-works-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('how.back_btn')}</span>
        </button>
      </div>

      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300 text-xs font-bold uppercase tracking-wider mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t('how.badge_zero_trust')}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('how.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('how.subtitle')}
        </p>
      </div>

      {/* 3 Illustrated Steps */}
      <div className="space-y-4">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.num}
              className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border-2 border-emerald-950/10 dark:border-emerald-800/30 shadow-sm relative overflow-hidden flex flex-col sm:flex-row items-start gap-4"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#1B4D3E] text-yellow-300 flex items-center justify-center flex-shrink-0 shadow-md">
                <Icon className="w-7 h-7" />
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black font-mono px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300">
                    {t('how.step_prefix', {num: s.num})}
                  </span>
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {s.badge}
                  </span>
                </div>

                <h3 className="text-lg sm:text-xl font-black text-gray-900 dark:text-white pt-1">
                  {s.title}
                </h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed pt-1 font-medium">
                  {s.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* PROMINENT PRIVACY NOTE */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-slate-900 border-2 border-emerald-300 dark:border-emerald-800 p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2.5 text-[#1B4D3E] dark:text-emerald-300 font-black text-base sm:text-lg">
          <EyeOff className="w-6 h-6" />
          <span>{t('how.privacy_policy_title')}</span>
        </div>
        <p className="text-sm sm:text-base text-gray-700 dark:text-gray-200 leading-relaxed font-semibold">
          {t('how.privacy_desc')}
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs text-[#1B4D3E] dark:text-emerald-400 font-bold">
          <span className="bg-white/80 dark:bg-slate-800 px-3 py-1 rounded-xl border border-emerald-200 dark:border-emerald-700">
            ✓ {t('how.privacy_badge_1')}
          </span>
          <span className="bg-white/80 dark:bg-slate-800 px-3 py-1 rounded-xl border border-emerald-200 dark:border-emerald-700">
            ✓ {t('how.privacy_badge_2')}
          </span>
          <span className="bg-white/80 dark:bg-slate-800 px-3 py-1 rounded-xl border border-emerald-200 dark:border-emerald-700">
            ✓ {t('how.privacy_badge_3')}
          </span>
        </div>
      </div>
    </div>
  );
};
