import React, {useState} from 'react';
import {Download, Smartphone, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';
import {useI18n} from '../i18n';

export const PWAInstallButton: React.FC<{className?: string}> = ({className = ''}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const {t} = useI18n();

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        id="pwa-install-btn"
        onClick={install}
        className={`inline-flex items-center gap-2 rounded-xl bg-[#1B4D3E] px-4 py-2.5 text-base font-semibold text-white shadow-md hover:bg-[#143C30] active:scale-95 transition-all ${className}`}
        aria-label={t('home.install_app')}
      >
        <Download className="w-5 h-5 text-emerald-300" />
        <span>{t('home.install_app')}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          id="pwa-ios-guide-btn"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center gap-2 rounded-xl border-2 border-[#1B4D3E] bg-emerald-50/80 dark:bg-emerald-950/40 px-3.5 py-2 text-sm font-semibold text-[#1B4D3E] dark:text-emerald-300 hover:bg-emerald-100 transition-all ${className}`}
          aria-label={t('family.ios_notice_title')}
        >
          <Smartphone className="w-4 h-4" />
          <span>{t('family.ios_notice_title')}</span>
        </button>

        {showIOSGuide && (
          <div
            id="ios-install-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-emerald-900/20">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t('home.ios_modal_title')}
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label={t('common.close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
                <p>{t('home.ios_step1')}</p>
                <p>{t('home.ios_step2')}</p>
                <p>{t('home.ios_step3')}</p>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[48px] rounded-xl bg-[#1B4D3E] py-3 text-base font-bold text-white shadow hover:bg-[#143C30]"
              >
                {t('home.ios_modal_ok')}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
