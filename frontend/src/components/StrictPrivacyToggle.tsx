import React, {useState} from 'react';
import {EyeOff} from 'lucide-react';
import {useI18n} from '../i18n';

/**
 * Live Guard's text gate. Default ("periodic"): during a call the number-masked text is checked by Gemini about every
 * 20 s - real scam calls rarely contain the keywords a rule can catch. Strict ("rules"): every sentence still reaches
 * the server, which runs the rules; Gemini sees the text only after the rules notice a warning sign. Audio never leaves
 * the device in either mode (unless the cloud recogniser was opted into). Takes effect on the next
 * Live Guard start; read by api/client.ts when it opens the socket.
 */
export const GATE_KEY = 'sagi_llm_gate';
export const strictPrivacy = (): boolean => {
  try {
    return localStorage.getItem(GATE_KEY) === 'rules';
  } catch {
    return false;
  }
};

export const StrictPrivacyToggle: React.FC = () => {
  const {t} = useI18n();
  const [strict, setStrict] = useState<boolean>(strictPrivacy);
  const toggle = (on: boolean) => {
    setStrict(on);
    try {
      if (on) localStorage.setItem(GATE_KEY, 'rules');
      else localStorage.removeItem(GATE_KEY);
    } catch {}
  };
  return (
    <div id="strict-privacy-setting" className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-400">
          <EyeOff className="w-5 h-5" />
        </div>
        <div>
          <div className="text-base font-bold text-gray-900 dark:text-white">{t('settings.strict_privacy')}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t('settings.strict_privacy_desc')}</div>
        </div>
      </div>
      <input
        id="strict-privacy-checkbox"
        type="checkbox"
        checked={strict}
        onChange={(e) => toggle(e.target.checked)}
        className="w-6 h-6 rounded text-[#1B4D3E] focus:ring-emerald-500 cursor-pointer flex-shrink-0"
      />
    </div>
  );
};
