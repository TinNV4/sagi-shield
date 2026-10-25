import React, {useCallback, useEffect, useState} from 'react';
import {ArrowLeft, Printer, RefreshCw} from 'lucide-react';
import QRCode from 'qrcode';
import {api, describeApiError} from '../api/client';
import type {Household} from '../api/types';
import en from '../i18n/en.json';
import ja from '../i18n/ja.json';
import vi from '../i18n/vi.json';
import {Language, useI18n} from '../i18n';
import {cardSteps, formatPairCode, householdLabel} from '../lib/householdState';

/** A freshly issued pair code: `expiresAt` is epoch ms, computed when the answer arrived. */
export interface CardCode {
  pair_code: string;
  expiresAt: number;
  /** Live Guard was asked for but the household update failed: the card says so. */
  liveGuardFailed?: boolean;
}

const DICTIONARIES: Record<Language, any> = {ja, vi, en};

/** One string in a fixed language (the card is read by the parent, in the household's market language). */
const textIn = (lang: Language, path: string): string => {
  const raw = path.split('.').reduce<any>((node, key) => node?.[key], DICTIONARIES[lang]);
  return typeof raw === 'string' ? raw : path;
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

interface SetupCardScreenProps {
  household: Household;
  /** The code that was just issued (after "Protect a parent"); without it the card asks for a new one. */
  initialCode?: CardCode | null;
  onBack: () => void;
  onOpenPrivacy?: () => void;
}

export const SetupCardScreen: React.FC<SetupCardScreenProps> = ({household, initialCode, onBack, onOpenPrivacy}) => {
  const {t, lang} = useI18n();
  const [code, setCode] = useState<CardCode | null>(initialCode ?? null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const newCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.householdCode(household.household_id);
      setCode({pair_code: next.pair_code, expiresAt: Date.now() + next.expires_in * 1000});
    } catch (err) {
      setError(describeApiError(err, t));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household.household_id]);

  // opened from the dashboard: a code from an earlier visit may be gone, so issue a fresh one
  useEffect(() => {
    if (!initialCode) void newCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const origin = window.location.origin;
  const pairCode = code?.pair_code ?? '';
  // The device-side link carries only the 6-digit code, in the fragment: never sent to a server.
  useEffect(() => {
    if (!/^\d{6}$/.test(pairCode)) return setQr(null);
    QRCode.toDataURL(`${origin}/#join=${pairCode}`, {margin: 1, width: 224, errorCorrectionLevel: 'M'})
      .then(setQr)
      .catch(() => setQr(null));
  }, [pairCode, origin]);

  const expired = code !== null && now >= code.expiresAt;
  // the market's language first; the UI language underneath only when it differs
  const stepLangs: Language[] = lang === household.market ? [household.market] : [household.market, lang];
  const steps = cardSteps(household.live_guard_enabled);
  const name = householdLabel(household, t('guardian.member_fallback'));

  return (
    <div id="setup-card-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-5 animate-fade-in">
      <button
        onClick={onBack}
        className="no-print inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t('common.back')}</span>
      </button>

      <div id="setup-card" className="p-6 rounded-3xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 space-y-5 text-center">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">
          {t('card.title')}: {name}
        </h1>

        <p id="setup-card-code" className="font-mono text-6xl font-black tracking-widest text-[#1B4D3E] dark:text-emerald-300">
          {formatPairCode(pairCode)}
        </p>
        {qr && <img src={qr} alt="" width={224} height={224} className="mx-auto rounded-xl bg-white" />}

        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
          {t('card.open_link')}: <span className="font-mono break-all">{origin}</span>
        </p>
        {code && (
          <p role="status" className={`text-sm font-bold ${expired ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
            {expired ? t('card.code_expired') : t('card.code_valid_until', {time: timeOf(code.expiresAt)})}
          </p>
        )}
        {initialCode?.liveGuardFailed && (
          <p role="alert" className="no-print text-sm font-bold text-amber-800 dark:text-amber-300">
            {t('card.live_guard_not_saved')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <ol className="text-left space-y-3 list-decimal pl-6 text-base font-bold text-gray-900 dark:text-white">
          {steps.map((key) => (
            <li key={key}>
              {stepLangs.map((l, i) => (
                <span key={l} lang={l} className={i === 0 ? 'block' : 'block text-sm font-normal text-gray-600 dark:text-gray-400'}>
                  {textIn(l, key)}
                </span>
              ))}
            </li>
          ))}
        </ol>

        <div className="text-left text-sm text-gray-700 dark:text-gray-300 p-3 rounded-xl bg-gray-50 dark:bg-slate-800 space-y-1">
          {stepLangs.map((l) => (
            <p key={l} lang={l}>
              {textIn(l, 'card.iphone_note')}
            </p>
          ))}
        </div>
      </div>

      <div className="no-print flex gap-2">
        <button
          id="setup-card-new-code"
          onClick={newCode}
          disabled={busy}
          className="flex-1 min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-[#1B4D3E] text-[#1B4D3E] dark:text-emerald-300 dark:border-emerald-400 font-bold disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          <span>{t('card.new_code')}</span>
        </button>
        <button
          id="setup-card-print"
          onClick={() => window.print()}
          className="flex-1 min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1B4D3E] text-white font-bold"
        >
          <Printer className="w-4 h-4" />
          <span>{t('card.print')}</span>
        </button>
      </div>

      {onOpenPrivacy && (
        <p className="no-print text-center">
          <button id="setup-card-privacy" onClick={onOpenPrivacy} className="underline text-sm font-bold text-gray-600 dark:text-gray-300">
            {t('card.privacy_link')}
          </button>
        </p>
      )}
    </div>
  );
};
