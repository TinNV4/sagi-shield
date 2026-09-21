import React, {useState} from 'react';
import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  Info,
  QrCode,
  Shield,
  Smartphone,
  UserCheck,
  Users,
} from 'lucide-react';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface FamilyScreenProps {
  onOpenGuardianView: () => void;
  alertOnHigh: boolean;
  onToggleAlertOnHigh: (val: boolean) => void;
}

export const FamilyScreen: React.FC<FamilyScreenProps> = ({
  onOpenGuardianView,
  alertOnHigh,
  onToggleAlertOnHigh,
}) => {
  const {t} = useI18n();

  const [pairCode] = useState('782-904');
  const [copiedCode, setCopiedCode] = useState(false);

  const linkedGuardians = [
    {
      id: 'g-1',
      name: t('family.mock_son_name'),
      role: t('family.role_primary'),
      device: 'iPhone 15 Pro',
      linked_at: t('family.mock_son_date'),
      active: true,
    },
    {
      id: 'g-2',
      name: t('family.mock_daughter_name'),
      role: t('family.role_secondary'),
      device: 'Pixel 8',
      linked_at: t('family.mock_daughter_date'),
      active: true,
    },
  ];

  const handleCopyCode = () => {
    speech.warmUp();
    navigator.clipboard.writeText(pairCode.replace('-', ''));
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div id="family-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('family.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('family.subtitle')}
        </p>
      </div>

      {/* Switch to Guardian Dashboard Button */}
      <button
        id="open-guardian-view-btn"
        onClick={() => {
          speech.warmUp();
          onOpenGuardianView();
        }}
        className="w-full min-h-[64px] p-4 rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-98 text-white font-bold text-base sm:text-lg flex items-center justify-between shadow-lg transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-white/20 text-yellow-300">
            <Users className="w-6 h-6" />
          </div>
          <div className="text-left">
            <div>{t('family.open_guardian_btn')}</div>
            <div className="text-xs text-emerald-200 font-normal">
              {t('family.open_guardian_desc')}
            </div>
          </div>
        </div>
        <ExternalLink className="w-5 h-5 text-emerald-200" />
      </button>

      {/* PAIR WITH A GUARDIAN (6-DIGIT CODE & QR) */}
      <div
        id="pairing-card"
        className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 p-5 sm:p-6 shadow-md text-center space-y-4"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300 text-xs font-bold uppercase tracking-wider">
          <Shield className="w-3.5 h-3.5" />
          <span>{t('family.pair_title')}</span>
        </div>

        <div>
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-2">
            {t('family.pair_instruction')}
          </span>
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-400 font-mono text-3xl sm:text-4xl font-black text-[#1B4D3E] dark:text-emerald-300 tracking-widest shadow-inner">
            <span>{pairCode}</span>
            <button
              onClick={handleCopyCode}
              className="p-1.5 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 transition"
              title={t('family.copy_code')}
            >
              {copiedCode ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* QR Code Graphic Placeholder */}
        <div className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-slate-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 max-w-xs mx-auto">
          <QrCode className="w-28 h-28 text-gray-800 dark:text-gray-200" />
          <span className="text-xs font-bold text-gray-500 mt-2">
            {t('family.qr_label')}
          </span>
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          {t('family.note_instant')}
        </p>
      </div>

      {/* TOGGLE: ALERT GUARDIANS ON HIGH RISK */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 mt-0.5">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">
              {t('family.toggle_label')}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('family.toggle_desc')}
            </div>
          </div>
        </div>
        <input
          type="checkbox"
          checked={alertOnHigh}
          onChange={(e) => onToggleAlertOnHigh(e.target.checked)}
          className="w-6 h-6 rounded text-[#1B4D3E] focus:ring-emerald-500 cursor-pointer"
        />
      </div>

      {/* LIST OF LINKED GUARDIANS */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          {t('family.linked_list_title')} ({linkedGuardians.length} {t('family.unit_guardians')})
        </h3>
        <div className="space-y-2.5">
          {linkedGuardians.map((g) => (
            <div
              key={g.id}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300 flex items-center justify-center font-bold">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span>{g.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                      {g.role}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('family.device_label', {device: g.device, date: g.linked_at})}
                  </div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs" title={t('family.status_connected')} />
            </div>
          ))}
        </div>
      </div>

      {/* NOTE FOR IPHONE USERS (PWA PROMPT REQUIREMENT) */}
      <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-start gap-3 text-xs sm:text-sm text-blue-900 dark:text-blue-200">
        <Smartphone className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" />
        <div>
          <div className="font-bold mb-0.5">{t('family.ios_notice_title')}</div>
          <p className="leading-relaxed">{t('family.note_ios')}</p>
        </div>
      </div>
    </div>
  );
};
