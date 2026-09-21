import React from 'react';
import {AlertCircle, AlertTriangle, CheckCircle, ShieldAlert} from 'lucide-react';
import {RiskLevel} from '../api/types';
import {useI18n} from '../i18n';

interface RiskMeterProps {
  score: number; // 0 - 100
  level: RiskLevel;
  size?: number;
  showDetails?: boolean;
}

export const RiskMeter: React.FC<RiskMeterProps> = ({
  score,
  level,
  size = 180,
  showDetails = true,
}) => {
  const {t} = useI18n();

  // Clamp score
  const safeScore = Math.min(100, Math.max(0, Math.round(score)));

  // SVG parameters
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc display: 240 degrees meter
  const strokeDashoffset = circumference - (safeScore / 100) * circumference;

  // Colors & icons based on level
  let color = '#2E7D32'; // Green
  let bgColor = 'bg-emerald-50 dark:bg-emerald-950/40';
  let textColor = 'text-[#2E7D32] dark:text-emerald-400';
  let borderColor = 'border-emerald-600';
  let Icon = CheckCircle;
  let wordLabel = t('result.verdict_low');

  if (level === 'HIGH' || safeScore >= 75) {
    color = '#C62828'; // Red
    bgColor = 'bg-red-50 dark:bg-red-950/40';
    textColor = 'text-[#C62828] dark:text-red-400';
    borderColor = 'border-red-600';
    Icon = ShieldAlert;
    wordLabel = t('result.verdict_high');
  } else if (level === 'MEDIUM' || safeScore >= 40) {
    color = '#F9A825'; // Amber
    bgColor = 'bg-amber-50 dark:bg-amber-950/40';
    textColor = 'text-[#D97706] dark:text-amber-400';
    borderColor = 'border-amber-500';
    Icon = AlertTriangle;
    wordLabel = t('result.verdict_medium');
  }

  return (
    <div
      id="risk-meter-container"
      className="flex flex-col items-center justify-center p-3 text-center"
      role="region"
      aria-label={`${t('live.risk_meter')}: ${safeScore}%`}
    >
      <div className="relative flex items-center justify-center" style={{width: size, height: size}}>
        <svg
          className="transform -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-gray-200 dark:text-gray-700"
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-700 ease-out"
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className={`w-8 h-8 ${textColor} mb-0.5 animate-pulse`} />
          <span className={`text-4xl font-extrabold tracking-tight font-mono ${textColor}`}>
            {safeScore}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {level}
          </span>
        </div>
      </div>

      {showDetails && (
        <div
          className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${borderColor} ${bgColor} ${textColor} text-base font-bold shadow-sm max-w-sm`}
        >
          <Icon className="w-5 h-5 flex-shrink-0" />
          <span className="line-clamp-1">{wordLabel}</span>
        </div>
      )}
    </div>
  );
};
