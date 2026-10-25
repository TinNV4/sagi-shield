import React from 'react';
import {ArrowLeft} from 'lucide-react';
import {PRIVACY} from '../content/privacy';
import {useI18n} from '../i18n';

/** The privacy notice, in the app's language (English falls back to the English text). Static: no network. */
export const PrivacyScreen: React.FC<{onBack?: () => void}> = ({onBack}) => {
  const {lang, t} = useI18n();
  const notice = PRIVACY[lang] ?? PRIVACY.en;

  return (
    <div className="max-w-prose mx-auto px-4 py-6 space-y-6 animate-fade-in text-lg leading-relaxed text-gray-800 dark:text-gray-200">
      {onBack && (
        <button
          id="privacy-back-btn"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('common.back')}</span>
        </button>
      )}
      <header className="space-y-1">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">{t('privacy.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('privacy.updated', {date: notice.updated})}</p>
      </header>
      {notice.sections.map((s, i) => (
        <section key={i} className="space-y-2">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {i + 1}. {s.title}
          </h2>
          {s.paragraphs.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
        </section>
      ))}
    </div>
  );
};
