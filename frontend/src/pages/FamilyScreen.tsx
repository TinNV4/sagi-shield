import React, {useEffect, useState} from 'react';
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
import QRCode from 'qrcode';
import {api, describeApiError} from '../api/client';
import type {Household} from '../api/types';
import {useI18n} from '../i18n';
import {authEnabled, currentUser, ensureDeviceSignIn} from '../lib/auth';
import {formatPairCode, guardianName, guardianRows, marketForLang, memberScreenState} from '../lib/householdState';
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
  const {t, lang} = useI18n();

  // uid: undefined = sign-in pending, null = no user (no Firebase on this build, or the sign-in failed / was slow).
  // households: null = not loaded yet.
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [guardianSession, setGuardianSession] = useState(false); // this browser is signed in as a guardian
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pairCode, setPairCode] = useState(''); // six digits, as the API sends them
  const [memberName, setMemberName] = useState('');
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // This device signs in anonymously, then shows its household with a fresh single-use code (valid 15 min).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFailure(null);
      const id = api.isMock ? 'mock' : await ensureDeviceSignIn();
      if (cancelled) return;
      setUid(id);
      if (!id) return;
      // a guardian's session is not a protected device: no household, no code (the household is not theirs to open)
      if (currentUser()?.anonymous === false) return setGuardianSession(true);
      setGuardianSession(false);
      try {
        const list = await api.myHouseholds();
        if (list.length > 0) {
          const next = await api.householdCode(list[0].household_id);
          if (cancelled) return;
          setPairCode(next.pair_code);
        }
        if (!cancelled) setHouseholds(list);
      } catch (err) {
        if (!cancelled) setFailure(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const created = await api.createHousehold({member_name: memberName.trim() || undefined, market: marketForLang(lang)});
      setPairCode(created.pair_code);
      setHouseholds([created.household]);
    } catch (err) {
      setFailure(err);
    } finally {
      setCreating(false);
    }
  };

  const view = memberScreenState({uid, households, failed: failure !== null, guardianSession, authEnabled: authEnabled && !api.isMock});
  const linkedGuardians = view.kind === 'household' ? guardianRows(view.household) : [];

  // The QR opens this app on the guardian's phone with the code pre-filled. Fragment, not query: never sent to a server.
  useEffect(() => {
    if (!/^\d{6}$/.test(pairCode) || view.kind !== 'household') return setQrDataUrl(null);
    QRCode.toDataURL(`${window.location.origin}/#pair=${pairCode}`, {margin: 1, width: 224, errorCorrectionLevel: 'M'})
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [pairCode, view.kind]);

  const handleCopyCode = () => {
    speech.warmUp();
    navigator.clipboard.writeText(pairCode);
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

        {view.kind === 'loading' && (
          <p role="status" className="text-sm font-bold text-gray-500 dark:text-gray-400">
            {t('common.loading')}
          </p>
        )}

        {view.kind === 'unavailable' && (
          <p id="family-signin-unavailable" role="status" className="text-sm font-bold text-gray-700 dark:text-gray-300">
            {t('family.signin_unavailable')}
          </p>
        )}

        {view.kind === 'signin_failed' && (
          <div className="space-y-3">
            <p id="family-signin-retry" role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
              {t('family.signin_retry')}
            </p>
            <button
              onClick={() => {
                setUid(undefined);
                setReloadKey((k) => k + 1);
              }}
              className="min-h-[48px] px-5 rounded-xl bg-[#1B4D3E] text-white text-base font-bold"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {view.kind === 'guardian_session' && (
          <p id="family-signed-in-as-guardian" role="status" className="text-sm font-bold text-gray-700 dark:text-gray-300">
            {t('family.signed_in_as_guardian')}
          </p>
        )}

        {view.kind === 'error' && (
          <div className="space-y-3">
            <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
              {describeApiError(failure, t)}
            </p>
            <button
              onClick={() => {
                setHouseholds(null);
                setReloadKey((k) => k + 1);
              }}
              className="min-h-[48px] px-5 rounded-xl bg-[#1B4D3E] text-white text-base font-bold"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {view.kind === 'create' && (
          <div className="space-y-3 text-left">
            <label htmlFor="family-member-name" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('family.member_name_label')}
            </label>
            <input
              id="family-member-name"
              maxLength={40}
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-lg"
            />
            <button
              id="family-create-btn"
              onClick={handleCreate}
              disabled={creating}
              className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold disabled:opacity-40"
            >
              {t('family.create_btn')}
            </button>
          </div>
        )}

        {view.kind === 'household' && (
          <>
          <div>
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-2">
              {t('family.pair_instruction')}
            </span>
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-400 font-mono text-3xl sm:text-4xl font-black text-[#1B4D3E] dark:text-emerald-300 tracking-widest shadow-inner">
              <span>{formatPairCode(pairCode)}</span>
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
            {qrDataUrl ? (
              <img id="family-pair-qr" src={qrDataUrl} alt={t('family.qr_label')} className="w-44 h-44 rounded-lg bg-white p-1" />
            ) : (
              <QrCode className="w-28 h-28 text-gray-300 dark:text-gray-600" />
            )}
            <span className="text-xs font-bold text-gray-500 mt-2">
              {t('family.qr_label')}
            </span>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            {t('family.note_instant')}
          </p>
          </>
        )}
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
      {view.kind === 'household' && (
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          {t('family.linked_list_title')} ({linkedGuardians.length} {t('family.unit_guardians')})
        </h3>
        <div className="space-y-2.5">
          {linkedGuardians.map((g, i) => (
            <div
              key={g.key}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300 flex items-center justify-center font-bold">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span>{guardianName(g, i, (n) => t('family.guardian_fallback', {n}))}</span>
                    {g.me && <span className="font-normal text-gray-600 dark:text-gray-400">{t('family.you_marker')}</span>}
                    {g.owner && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                        {t('family.owner_badge')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs" title={t('family.status_connected')} />
            </div>
          ))}
        </div>
      </div>
      )}

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
