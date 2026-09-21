import React, {useEffect} from 'react';
import {PhoneCall, PhoneOff, ShieldAlert, CheckCircle2} from 'lucide-react';
import {CallTrustedButton} from './TrustedContact';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface HighRiskTakeoverProps {
  onSafeTap: () => void;
  advice?: string;
  triggerPhrase?: string;
}

export const HighRiskTakeover: React.FC<HighRiskTakeoverProps> = ({
  onSafeTap,
  advice,
  triggerPhrase,
}) => {
  const {t, lang} = useI18n();

  useEffect(() => {
    // Vibration pattern: 500ms on, 200ms off, 500ms on (repeated every 3 seconds to match the 3s pulse)
    let vibInterval: any = null;
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([500, 200, 500, 200, 800]);
        vibInterval = setInterval(() => {
          navigator.vibrate([500, 200, 500]);
        }, 3000);
      } catch (e) {
        console.warn('Vibration error:', e);
      }
    }

    // Cleanup: guarantee immediate stop of TTS audio and vibration on unmount
    return () => {
      speech.stop();
      if (vibInterval) clearInterval(vibInterval);
      if (typeof window !== 'undefined') {
        try {
          window.speechSynthesis?.cancel();
          if ('vibrate' in navigator) {
            navigator.vibrate(0);
          }
        } catch {}
      }
    };
  }, []);

  const handleDismiss = () => {
    // GUARANTEE: Spoken TTS alert stops immediately upon "I am safe now" tap
    speech.stop();
    if (typeof window !== 'undefined') {
      try {
        window.speechSynthesis?.cancel();
        if ('vibrate' in navigator) {
          navigator.vibrate(0);
        }
      } catch {}
    }
    onSafeTap();
  };

  const policeTel = lang === 'vi' ? 'tel:113' : 'tel:#9110';
  const consumerTel = lang === 'vi' ? 'tel:18006838' : 'tel:188';

  return (
    <div
      id="high-risk-takeover-overlay"
      className="fixed inset-0 z-50 flex flex-col bg-[#991B1B] text-white select-none animate-takeover-pulse-3s overflow-hidden"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="takeover-title"
    >
      {/* Scrollable Upper & Center Information Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-5 pb-52 sm:pb-48">
        <div className="flex flex-col items-center text-center max-w-xl mx-auto w-full">
          {/* Emergency Beacon Phone Icon with 3-second Pulsing Concentric Rings */}
          <div className="relative flex items-center justify-center my-3">
            <div
              className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-yellow-400/30 animate-beacon-ring-3s pointer-events-none"
              aria-hidden="true"
            />
            <div
              className="absolute w-36 h-36 sm:w-40 sm:h-40 rounded-full border-2 border-yellow-300/40 animate-beacon-ring-3s pointer-events-none"
              style={{animationDelay: '0.4s'}}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-white text-[#991B1B] shadow-2xl">
              <PhoneOff className="w-13 h-13 sm:w-16 sm:h-16 stroke-[2.5]" />
            </div>
          </div>

          {/* 3-Second Urgency Alert Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/40 border border-yellow-400/50 text-yellow-300 font-extrabold text-sm sm:text-base tracking-wide uppercase mb-3 animate-urgent-badge-3s shadow-lg">
            <ShieldAlert className="w-5 h-5 animate-spin-slow text-yellow-300 flex-shrink-0" />
            <span>{t('live.takeover_alert_badge')}</span>
          </div>

          {/* Primary Urgent Headline */}
          <h1
            id="takeover-title"
            className="text-3xl sm:text-4xl md:text-5xl font-black leading-tight tracking-tight text-white drop-shadow-md text-center"
          >
            {t('live.takeover_title')}
          </h1>

          {/* Subtitle / Direct Counter-Advice */}
          <p className="mt-3 text-lg sm:text-xl font-bold text-yellow-100 max-w-md">
            {advice || t('live.takeover_subtitle')}
          </p>

          {/* Detected Trigger Phrase (if extracted) */}
          {triggerPhrase && (
            <div className="mt-3 px-4 py-2 rounded-xl bg-black/40 border border-yellow-300/40 text-sm sm:text-base text-yellow-200 shadow-sm">
              {t('live.takeover_detected_word')} <strong>「{triggerPhrase}」</strong>
            </div>
          )}

          {/* One tap to the number the user already trusts (renders only when one is saved) */}
          <div className="mt-4 w-full">
            <CallTrustedButton tone="alarm" />
          </div>

          {/* Firm Guidance Box */}
          <div className="mt-4 w-full bg-black/30 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-white/20 text-center shadow-lg">
            <p className="text-base sm:text-lg font-semibold text-white/95 leading-relaxed">
              {t('live.takeover_guidance')}
            </p>
          </div>
        </div>
      </div>

      {/* FIXED BOTTOM DOCK: Guaranteed Easy Thumb Reach for Safe Button & Emergency Hotlines */}
      <div
        id="fixed-hotline-bar"
        className="fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/95 via-black/85 to-transparent pt-3 pb-safe px-4 sm:px-6 border-t border-white/15 backdrop-blur-md"
      >
        <div className="max-w-xl mx-auto w-full flex flex-col gap-2.5 pb-2">
          {/* Giant "I am safe now" button - Stops TTS audio immediately */}
          <button
            id="safe-now-btn"
            onClick={handleDismiss}
            className="w-full min-h-[58px] sm:min-h-[66px] rounded-2xl bg-white text-[#143C30] hover:bg-emerald-50 active:scale-[0.98] text-lg sm:text-xl md:text-2xl font-black shadow-2xl flex items-center justify-center gap-3 transition-transform border-4 border-yellow-300"
            aria-label={t('live.takeover_safe_btn')}
          >
            <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-700 flex-shrink-0" />
            <span>{t('live.takeover_safe_btn')}</span>
          </button>

          {/* Emergency Hotline Buttons Fixed at Bottom */}
          <div className="grid grid-cols-2 gap-2">
            <a
              id="call-police-btn"
              href={policeTel}
              className="min-h-[50px] sm:min-h-[54px] rounded-xl bg-black/50 hover:bg-black/70 active:scale-95 border-2 border-yellow-400/50 text-white font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-2 px-2.5 shadow transition text-center"
            >
              <PhoneCall className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-300 flex-shrink-0" />
              <span className="truncate">{t('live.btn_police_call')}</span>
            </a>

            <a
              id="call-consumer-btn"
              href={consumerTel}
              className="min-h-[50px] sm:min-h-[54px] rounded-xl bg-black/50 hover:bg-black/70 active:scale-95 border-2 border-emerald-400/50 text-white font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-2 px-2.5 shadow transition text-center"
            >
              <PhoneCall className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-300 flex-shrink-0" />
              <span className="truncate">{t('live.btn_consumer_call')}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
