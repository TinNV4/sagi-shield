import React, {useState} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Copy,
  LifeBuoy,
  PhoneCall,
  Share2,
  Shield,
  ShieldAlert,
  Users,
  Eye,
  Send,
} from 'lucide-react';
import {api, describeApiError} from '../api/client';
import {CheckResult, DeepCheckResult} from '../api/types';
import {KillChainBar} from '../components/KillChainBar';
import {RiskMeter} from '../components/RiskMeter';
import {DeepfakeNotice} from '../components/DeepfakeNotice';
import {useI18n} from '../i18n';
import type {CheckInput} from './QuickCheckScreen';
import * as speech from '../lib/speak';

interface ResultScreenProps {
  result: CheckResult;
  checkInput?: CheckInput;
  onBack: () => void;
  onGoRecovery: () => void;
  onNotifyFamily: () => void;
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  result,
  checkInput = {},
  onBack,
  onGoRecovery,
  onNotifyFamily,
}) => {
  const {t, lang} = useI18n();

  // "Explain to an elderly person" toggle (Follow-up 6)
  const [elderlyMode, setElderlyMode] = useState(false);

  // Report community state
  const [hasReported, setHasReported] = useState(false);
  const [consentChecked, setConsentChecked] = useState(true);
  const [isReporting, setIsReporting] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);

  // Opt-in deep check: search public reports about the link's domain / the organisation named. Never the number.
  const [deepOrg, setDeepOrg] = useState('');
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepError, setDeepError] = useState('');
  const [deep, setDeep] = useState<DeepCheckResult | null>(null);
  const hasLink = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|vn|jp|xyz|top|info|site|online|shop)\b/i.test(
    `${checkInput.url || ''} ${checkInput.text || ''}`,
  );
  const runDeepCheck = async () => {
    speech.warmUp();
    setDeepBusy(true);
    setDeepError('');
    try {
      setDeep(await api.deepcheck({lang, url: checkInput.url, text: checkInput.text, org: deepOrg.trim() || undefined}));
    } catch (err) {
      setDeepError(describeApiError(err, t));
    } finally {
      setDeepBusy(false);
    }
  };

  const isHigh = result.risk_level === 'HIGH';
  const isMedium = result.risk_level === 'MEDIUM';

  const handleReportCommunity = async () => {
    speech.warmUp();
    if (!consentChecked) return;
    setIsReporting(true);
    setReportError(false);
    try {
      await api.report({
        scam_type: result.scam_type,
        phone: checkInput.phone || undefined,
        keywords: result.evidence_flags,
        consent: true,
        lang,
      });
      setHasReported(true);
    } catch {
      setReportError(true); // never claim it was shared when it was not
    } finally {
      setIsReporting(false);
    }
  };

  const handleCopyAdvice = () => {
    const text = `${t('result.share_title')}\n${t('result.share_risk_label')}: ${result.risk_level} (${result.risk_score}%)\n${t('result.share_type_label')}: ${result.scam_type}\n${t('result.share_advice_label')}: ${result.advice}`;
    navigator.clipboard.writeText(text);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 2000);
  };

  // Simplified elderly explanation
  const getElderlyBullets = () => {
    if (isHigh) {
      return [
        t('result.elderly_bullets.high_0'),
        t('result.elderly_bullets.high_1'),
        t('result.elderly_bullets.high_2'),
      ];
    } else if (isMedium) {
      return [
        t('result.elderly_bullets.med_0'),
        t('result.elderly_bullets.med_1'),
        t('result.elderly_bullets.med_2'),
      ];
    } else {
      return [
        t('result.elderly_bullets.low_0'),
        t('result.elderly_bullets.low_1'),
        t('result.elderly_bullets.low_2'),
      ];
    }
  };

  return (
    <div id="result-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          id="result-back-btn"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('result.btn_back')}</span>
        </button>

        {/* Explain to Elderly Toggle (Follow-up 6) */}
        <button
          id="elderly-mode-toggle"
          onClick={() => {
            speech.warmUp();
            setElderlyMode((prev) => !prev);
          }}
          className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold border flex items-center gap-1.5 transition ${
            elderlyMode
              ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
              : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>{t('result.explain_elderly')}</span>
        </button>
      </div>

      {/* Main Verdict Card */}
      <div
        id="verdict-card"
        className={`rounded-3xl p-5 sm:p-7 border-2 shadow-lg transition-all ${
          isHigh
            ? 'bg-red-50 dark:bg-red-950/40 border-red-500 text-red-950 dark:text-red-100'
            : isMedium
            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-950 dark:text-amber-100'
            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 text-emerald-950 dark:text-emerald-100'
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <RiskMeter score={result.risk_score} level={result.risk_level} size={200} showDetails={false} />

          {/* Verdict Word Banner */}
          <div
            className={`mt-3 px-5 py-2 rounded-2xl font-black text-xl sm:text-2xl tracking-wide flex items-center gap-2 ${
              isHigh
                ? 'bg-red-600 text-white shadow-md animate-bounce-short'
                : isMedium
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-emerald-700 text-white shadow-md'
            }`}
          >
            {isHigh ? <ShieldAlert className="w-7 h-7" /> : <Shield className="w-7 h-7" />}
            <span>
              {isHigh
                ? t('result.verdict_high')
                : isMedium
                ? t('result.verdict_medium')
                : t('result.verdict_low')}
            </span>
          </div>

          <div className="mt-2 text-sm font-bold uppercase tracking-wider opacity-80">
            {t('result.scam_type_prefix')}{t(`types.${result.scam_type}`).startsWith('types.') ? t('types.unknown') : t(`types.${result.scam_type}`)}
          </div>
        </div>

        {/* Elderly-friendly 3-bullet mode */}
        {elderlyMode ? (
          <div className="mt-5 p-4 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-current/20 shadow-sm space-y-2.5">
            <div className="text-xs font-bold text-amber-600 uppercase tracking-wide">
              {t('result.elderly_title')}
            </div>
            {getElderlyBullets().map((bullet, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-base sm:text-lg font-bold leading-snug">
                <span className="text-amber-500 text-xl font-mono">●</span>
                <span>{bullet}</span>
              </div>
            ))}
          </div>
        ) : (
          /* Standard Max 2 reasons as short sentences (never a wall of text) */
          <div className="mt-5 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider opacity-75">
              {t('result.reasons_title')}
            </h3>
            {result.reasons.slice(0, 2).map((reason, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-current/20 text-sm sm:text-base font-bold leading-snug flex items-start gap-2.5"
              >
                <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Concrete Advice */}
        <div className="mt-4 p-4 rounded-2xl bg-black/10 dark:bg-black/40 border border-current/20">
          <div className="text-xs font-bold uppercase tracking-wide opacity-80 mb-1">
            {t('result.advice_title')}
          </div>
          <p className="text-base sm:text-lg font-black leading-snug">
            {result.advice}
          </p>
        </div>

        {/* The model did not answer or a file could not be read: say so instead of looking like a full analysis */}
        {result.evidence_flags?.some((f) => f === 'llm_unavailable' || f.endsWith('_not_analyzed')) && (
          <div id="partial-analysis-notice" className="mt-4 p-3 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-400 text-amber-900 dark:text-amber-100 text-sm font-bold">
            {t('result.partial_analysis')}
          </div>
        )}

        {/* Several screenshots: say how they were read, and show each verdict when they were unrelated */}
        {result.images_mode === 'combined' && result.images && (
          <div id="images-combined-notice" className="mt-4 text-sm font-bold opacity-80">
            {t('result.images_combined').replace('{n}', String(result.images.length))}
          </div>
        )}
        {result.images_mode === 'separate' && result.images && (
          <div id="images-separate" className="mt-4 space-y-2">
            <div className="text-sm font-bold opacity-80">{t('result.images_separate')}</div>
            {result.images.map((img) => (
              <div key={img.index} className="flex items-start gap-3 p-3 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-current/20 text-sm">
                <span className={`px-2 py-0.5 rounded-lg font-black text-xs ${img.risk_level === 'HIGH' ? 'bg-red-600 text-white' : img.risk_level === 'MEDIUM' ? 'bg-amber-400 text-black' : 'bg-emerald-600 text-white'}`}>
                  {img.risk_level}
                </span>
                <div className="min-w-0">
                  <div className="font-bold">{t('result.image_n').replace('{n}', String(img.index))} · {t(`types.${img.scam_type}`).startsWith('types.') ? t('types.unknown') : t(`types.${img.scam_type}`)}</div>
                  {img.reasons?.[0] && <div className="opacity-80">{img.reasons[0]}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rule Evidence Chips */}
        {result.evidence_flags && result.evidence_flags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {result.evidence_flags.map((flag, idx) => (
              <span
                key={idx}
                className="px-3 py-1 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-current/30 text-xs font-bold"
              >
                #{flag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Opt-in deep check: public reports about the domain / organisation (Google Search grounding) */}
      <div id="deep-check" className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="text-sm font-black text-gray-800 dark:text-gray-100">{t('result.deep_title')}</div>
        <p className="text-xs text-gray-600 dark:text-gray-300">{t('result.deep_hint')}</p>
        {!deep && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="deep-check-org"
              type="text"
              maxLength={80}
              value={deepOrg}
              onChange={(e) => setDeepOrg(e.target.value)}
              placeholder={t('result.deep_org_placeholder')}
              className="flex-1 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-900 text-sm"
            />
            <button
              id="deep-check-run"
              type="button"
              disabled={deepBusy || (!hasLink && !deepOrg.trim())}
              onClick={runDeepCheck}
              className="px-4 py-2 rounded-xl bg-[#1B4D3E] text-white font-bold text-sm disabled:opacity-40"
            >
              {deepBusy ? t('result.deep_running') : t('result.deep_button')}
            </button>
          </div>
        )}
        {deepError && <div className="text-xs font-bold text-red-700 dark:text-red-300">{deepError}</div>}
        {deep && (
          <div className="space-y-2">
            <div className={`text-sm font-black ${deep.found ? 'text-red-700 dark:text-red-300' : 'text-gray-800 dark:text-gray-100'}`}>
              {deep.found ? t('result.deep_found') : t('result.deep_not_found')}
            </div>
            <p className="text-sm text-gray-800 dark:text-gray-100">{deep.summary}</p>
            {deep.sources.length > 0 && (
              <ul className="space-y-1">
                {deep.sources.map((s, i) => (
                  <li key={i} className="text-xs truncate">
                    <a href={s.uri} target="_blank" rel="noopener noreferrer" className="underline text-blue-700 dark:text-blue-300">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {t('result.deep_searched')} {deep.subjects.join(' · ')}
            </div>
          </div>
        )}
      </div>

      {/* "It's me" scams now come as video calls with a cloned face */}
      {result.scam_type === 'family_impersonation' && <DeepfakeNotice compact />}

      {/* Kill Chain Bar (if stage > 0) */}
      {result.stage > 0 && (
        <KillChainBar currentStage={result.stage} maxReachedStage={result.stage} />
      )}

      {/* Emergency Hotline Buttons (tel: links) */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">
          {t('result.hotlines_title')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            id="result-hotline-9110"
            href="tel:#9110"
            className="min-h-[56px] rounded-2xl bg-[#1B4D3E] text-white p-3.5 flex items-center justify-between hover:bg-[#143C30] shadow transition"
          >
            <div className="flex items-center gap-3">
              <PhoneCall className="w-6 h-6 text-yellow-300" />
              <div>
                <div className="font-bold text-base">{t('result.hotline_9110_title')}</div>
                <div className="text-xs text-emerald-200">{t('result.hotline_9110_desc')}</div>
              </div>
            </div>
            <span className="font-mono font-bold text-sm bg-white/20 px-2 py-1 rounded-lg">{t('result.hotline_call')}</span>
          </a>

          <a
            id="result-hotline-110"
            href="tel:110"
            className="min-h-[56px] rounded-2xl bg-red-700 text-white p-3.5 flex items-center justify-between hover:bg-red-800 shadow transition"
          >
            <div className="flex items-center gap-3">
              <PhoneCall className="w-6 h-6 text-yellow-300" />
              <div>
                <div className="font-bold text-base">{t('result.hotline_110_title')}</div>
                <div className="text-xs text-red-200">{t('result.hotline_110_desc')}</div>
              </div>
            </div>
            <span className="font-mono font-bold text-sm bg-white/20 px-2 py-1 rounded-lg">{t('result.hotline_call')}</span>
          </a>

          <a
            id="result-hotline-188"
            href="tel:188"
            className="min-h-[56px] rounded-2xl bg-amber-700 text-white p-3.5 flex items-center justify-between hover:bg-amber-800 shadow transition"
          >
            <div className="flex items-center gap-3">
              <PhoneCall className="w-6 h-6 text-white" />
              <div>
                <div className="font-bold text-base">{t('result.hotline_188_title')}</div>
                <div className="text-xs text-amber-200">{t('result.hotline_188_desc')}</div>
              </div>
            </div>
            <span className="font-mono font-bold text-sm bg-white/20 px-2 py-1 rounded-lg">{t('result.hotline_call')}</span>
          </a>
        </div>
      </div>

      {/* Action Row */}
      <div className="space-y-3 pt-2">
        {/* Notify Family */}
        <button
          id="result-notify-family-btn"
          onClick={() => {
            speech.warmUp();
            onNotifyFamily();
          }}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-400 text-[#1B4D3E] dark:text-emerald-300 font-bold text-base flex items-center justify-center gap-2 hover:bg-emerald-200 transition"
        >
          <BellRing className="w-5 h-5" />
          <span>{t('result.notify_family')}</span>
        </button>

        {/* Report to Community */}
        {!hasReported ? (
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 space-y-3">
            <div className="flex items-center gap-2">
              <input
                id="consent-checkbox"
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <label htmlFor="consent-checkbox" className="text-xs text-gray-600 dark:text-gray-400">
                {t('result.consent_checkbox')}
              </label>
            </div>
            <button
              id="result-report-community-btn"
              disabled={!consentChecked || isReporting}
              onClick={handleReportCommunity}
              className="w-full min-h-[48px] rounded-xl bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-bold text-sm flex items-center justify-center gap-2 transition"
            >
              <Send className="w-4 h-4" />
              <span>{isReporting ? t('result.reporting') : t('result.report_community')}</span>
            </button>
            {reportError && <p className="text-xs font-semibold text-red-700 dark:text-red-400">{t('result.report_failed')}</p>}
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 text-sm font-bold flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span>{t('result.reported_success')}</span>
          </div>
        )}

        {/* Copy Result */}
        <button
          onClick={handleCopyAdvice}
          className="w-full min-h-[48px] rounded-xl bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold text-sm flex items-center justify-center gap-2 hover:bg-gray-50"
        >
          <Copy className="w-4 h-4" />
          <span>{copiedNote ? t('result.copied_result') : t('result.copy_result')}</span>
        </button>

        {/* "I already paid" quiet escape to recovery */}
        <button
          id="result-already-paid-btn"
          onClick={() => {
            speech.warmUp();
            onGoRecovery();
          }}
          className="w-full min-h-[52px] rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-300 font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-100 transition"
        >
          <LifeBuoy className="w-5 h-5 text-red-600" />
          <span>{t('result.already_paid')}</span>
        </button>
      </div>
    </div>
  );
};
