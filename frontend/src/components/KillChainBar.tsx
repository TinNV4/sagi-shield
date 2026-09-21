import React from 'react';
import {ArrowRight, Check, DollarSign, Lock, MessageSquare, ShieldAlert, Siren} from 'lucide-react';
import {KillChainStage} from '../api/types';
import {useI18n} from '../i18n';

interface KillChainBarProps {
  currentStage: KillChainStage;
  maxReachedStage: KillChainStage;
}

export const KillChainBar: React.FC<KillChainBarProps> = ({
  currentStage,
  maxReachedStage,
}) => {
  const {t} = useI18n();

  const effectiveStage = Math.max(currentStage, maxReachedStage);

  const steps = [
    {
      num: 1,
      title: t('live.stages.1'),
      short: 'Authority',
      icon: Siren,
    },
    {
      num: 2,
      title: t('live.stages.2'),
      short: 'Threat',
      icon: ShieldAlert,
    },
    {
      num: 3,
      title: t('live.stages.3'),
      short: 'Secrecy',
      icon: Lock,
    },
    {
      num: 4,
      title: t('live.stages.4'),
      short: 'App / Link',
      icon: MessageSquare,
    },
    {
      num: 5,
      title: t('live.stages.5'),
      short: 'Money',
      icon: DollarSign,
    },
  ];

  return (
    <div
      id="kill-chain-container"
      className="w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-2xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm"
      role="region"
      aria-label={t('live.kill_chain_title')}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold tracking-wide uppercase text-gray-600 dark:text-gray-300">
          {t('live.kill_chain_title')}
        </h4>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
          {t('guardian.stage_label', {stage: effectiveStage, type: '5'})}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {steps.map((step, idx) => {
          const isReached = effectiveStage >= step.num;
          const isCurrent = effectiveStage === step.num;
          const Icon = step.icon;

          let stepColor = 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700';
          if (isReached) {
            if (step.num >= 4) {
              stepColor = 'bg-red-600 text-white border-red-700 shadow-md shadow-red-500/20';
            } else if (step.num >= 2) {
              stepColor = 'bg-amber-500 text-white border-amber-600 shadow-md shadow-amber-500/20';
            } else {
              stepColor = 'bg-emerald-600 text-white border-emerald-700 shadow-md shadow-emerald-500/20';
            }
          }

          return (
            <div
              key={step.num}
              className={`flex flex-col items-center text-center p-2 rounded-xl border transition-all duration-500 ${stepColor} ${
                isCurrent ? 'ring-2 ring-offset-2 ring-red-500 animate-pulse' : ''
              }`}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-black/15 mb-1">
                {isReached ? <Icon className="w-4 h-4" /> : <span className="text-xs font-bold">{step.num}</span>}
              </div>
              <span className="text-[11px] sm:text-xs font-bold leading-tight line-clamp-2">
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
