import React from 'react';
import {Video} from 'lucide-react';
import {useI18n} from '../i18n';

/**
 * Awareness card for deepfake video calls (a face / voice that looks like a relative asking for money).
 * Sagi Shield does not analyze video yet - this is advice, not detection, and the text says so.
 * The five signs paraphrase the public advisory of Vietnam's Authority of Information Security (Cục An toàn thông tin).
 */
export const DeepfakeNotice: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const {t} = useI18n();
  const signs = [0, 1, 2, 3, 4].map((i) => t(`deepfake.signs.${i}`));

  return (
    <div
      id="deepfake-notice"
      className="rounded-3xl bg-violet-50 dark:bg-violet-950/30 border-2 border-violet-300 dark:border-violet-800 p-5 sm:p-6 shadow-sm space-y-3"
    >
      <div className="flex items-center gap-2.5 text-violet-900 dark:text-violet-200 font-black text-base sm:text-lg">
        <Video className="w-6 h-6 flex-shrink-0" />
        <span>{t('deepfake.title')}</span>
      </div>
      <p className="text-sm sm:text-base text-gray-700 dark:text-gray-200 leading-relaxed font-semibold">
        {t('deepfake.intro')}
      </p>
      {!compact && (
        <ol className="space-y-1.5 text-sm text-gray-800 dark:text-gray-100 list-decimal list-inside">
          {signs.map((sign, i) => (
            <li key={i} className="leading-snug">
              {sign}
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm sm:text-base font-black text-violet-900 dark:text-violet-200 leading-snug">
        {t('deepfake.action')}
      </p>
      {!compact && <p className="text-xs text-gray-500 dark:text-gray-400">{t('deepfake.source')}</p>}
    </div>
  );
};
