import React, {useState} from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  DollarSign,
  GraduationCap,
  HelpCircle,
  Landmark,
  Lock,
  Search,
  Shield,
  Siren,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import {api, describeApiError} from '../api/client';
import {CheckResult, PrecheckPayload} from '../api/types';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface BeforeYouPayScreenProps {
  onPrecheckCompleted: (result: CheckResult) => void;
  onCancel: () => void;
}

export const BeforeYouPayScreen: React.FC<BeforeYouPayScreenProps> = ({
  onPrecheckCompleted,
  onCancel,
}) => {
  const {t, lang} = useI18n();

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Question 1: Who asked you to pay?
  const [whoAsked, setWhoAsked] = useState<
    'police' | 'government' | 'bank' | 'family' | 'broker' | 'stranger' | 'nobody' | ''
  >('');

  // Question 2: Why are you paying?
  const [whyReason, setWhyReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');

  // Question 3: Who does the receiving account belong to?
  const [recipientType, setRecipientType] = useState<'person' | 'company' | 'government' | ''>('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick preset shortcuts
  const handleApplyPreset = (presetType: 'police' | 'tuition') => {
    speech.warmUp();
    if (presetType === 'police') {
      setWhoAsked('police');
      setWhyReason('safe_account');
      setRecipientType('person');
      setCurrentStep(3);
    } else {
      setWhoAsked('family');
      setWhyReason('tuition');
      setRecipientType('company');
      setCurrentStep(3);
    }
  };

  const handleFinishWizard = async () => {
    speech.warmUp();
    setIsLoading(true);

    const effectiveReason =
      customReason.trim() ||
      whyReason ||
      t('pay.fallback_reason');

    const payload: PrecheckPayload = {
      who_asked: whoAsked || 'stranger',
      reason_text: effectiveReason,
      recipient_type: recipientType || 'person',
      lang,
    };

    setErrorMsg(null);
    try {
      const res = await api.precheck(payload);
      setIsLoading(false);
      onPrecheckCompleted(res);
    } catch (e) {
      // No verdict was reached, so none is shown: an invented "HIGH" with invented community reports would teach
      // the user that the app cries wolf. The error card says what to do instead (official number, never the caller's).
      setIsLoading(false);
      setErrorMsg(describeApiError(e, t));
    }
  };

  // Option lists
  const whoAskedOptions = [
    {id: 'police', label: t('pay.who.police'), icon: Siren, desc: t('pay.who_desc.police')},
    {id: 'government', label: t('pay.who.government'), icon: Landmark, desc: t('pay.who_desc.government')},
    {id: 'bank', label: t('pay.who.bank'), icon: Building2, desc: t('pay.who_desc.bank')},
    {id: 'family', label: t('pay.who.family'), icon: Users, desc: t('pay.who_desc.family')},
    {id: 'broker', label: t('pay.who.broker'), icon: TrendingUp, desc: t('pay.who_desc.broker')},
    {id: 'stranger', label: t('pay.who.stranger'), icon: HelpCircle, desc: t('pay.who_desc.stranger')},
    {id: 'nobody', label: t('pay.who.nobody'), icon: User, desc: t('pay.who_desc.nobody')},
  ];

  const whyReasonsOptions = [
    {id: 'safe_account', label: t('pay.why.safe_account'), icon: Lock, alert: true},
    {id: 'bail', label: t('pay.why.bail'), icon: AlertOctagon, alert: true},
    {id: 'refund_fee', label: t('pay.why.refund_fee'), icon: DollarSign, alert: true},
    {id: 'investment', label: t('pay.why.investment'), icon: TrendingUp, alert: false},
    {id: 'family_emergency', label: t('pay.why.family_emergency'), icon: Users, alert: false},
    {id: 'tuition', label: t('pay.why.tuition'), icon: GraduationCap, alert: false},
    {id: 'shopping', label: t('pay.why.shopping'), icon: CreditCard, alert: false},
  ];

  const recipientOptions = [
    {
      id: 'person',
      label: t('pay.recipient.person'),
      icon: User,
      desc: t('pay.recipient_desc.person'),
    },
    {
      id: 'company',
      label: t('pay.recipient.company'),
      icon: Building2,
      desc: t('pay.recipient_desc.company'),
    },
    {
      id: 'government',
      label: t('pay.recipient.government'),
      icon: Landmark,
      desc: t('pay.recipient_desc.government'),
    },
  ];

  return (
    <div id="before-you-pay-wizard" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header with Steps */}
      <div>
        <div className="flex items-center justify-between">
          <button
            onClick={currentStep === 1 ? onCancel : () => setCurrentStep((s) => (s - 1) as any)}
            className="inline-flex items-center gap-1 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{currentStep === 1 ? t('pay.back_home') : t('pay.prev_question')}</span>
          </button>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((stepNum) => (
              <span
                key={stepNum}
                className={`w-3 h-3 rounded-full transition-all ${
                  stepNum === currentStep
                    ? 'bg-amber-500 w-7'
                    : stepNum < currentStep
                    ? 'bg-emerald-600'
                    : 'bg-gray-300 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
            {t('pay.title')}
          </h1>
          <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2.5 py-1 rounded-lg">
            {t('pay.step', {current: currentStep, total: 3})}
          </span>
        </div>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300">
          {t('pay.subtitle')}
        </p>
      </div>

      {/* Preset Fill Buttons for Pitch Demo */}
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => handleApplyPreset('police')}
          className="px-2.5 py-1.5 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-900 dark:text-red-200 border border-red-300 font-bold hover:bg-red-200 transition active:scale-95"
        >
          {t('pay.preset_police')}
        </button>
        <button
          onClick={() => handleApplyPreset('tuition')}
          className="px-2.5 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border border-emerald-300 font-bold hover:bg-emerald-200 transition active:scale-95"
        >
          {t('pay.preset_tuition')}
        </button>
      </div>

      {/* ================= STEP 1 ================= */}
      {currentStep === 1 && (
        <div className="space-y-4 animate-fade-in">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
            1. {t('pay.step1_title')}
          </h2>

          <div className="space-y-2.5">
            {whoAskedOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = whoAsked === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`pay-who-${opt.id}`}
                  onClick={() => {
                    speech.warmUp();
                    setWhoAsked(opt.id as any);
                  }}
                  className={`w-full min-h-[64px] sm:min-h-[72px] p-4 rounded-2xl border-2 flex items-center justify-between text-left transition-all ${
                    isSelected
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-md ring-2 ring-amber-400'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 hover:border-amber-400'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`p-3 rounded-xl flex-shrink-0 ${
                        isSelected
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                        {opt.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {opt.desc}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-6 h-6 text-amber-500 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          <button
            disabled={!whoAsked}
            onClick={() => setCurrentStep(2)}
            className="w-full min-h-[64px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white font-bold text-lg flex items-center justify-center gap-2 transition"
          >
            <span>{t('pay.btn_next')}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ================= STEP 2 ================= */}
      {currentStep === 2 && (
        <div className="space-y-4 animate-fade-in">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
            2. {t('pay.step2_title')}
          </h2>

          <div className="space-y-2.5">
            {whyReasonsOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = whyReason === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`pay-why-${opt.id}`}
                  onClick={() => {
                    speech.warmUp();
                    setWhyReason(opt.id);
                  }}
                  className={`w-full min-h-[60px] p-3.5 sm:p-4 rounded-2xl border-2 flex items-center justify-between text-left transition-all ${
                    isSelected
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-md ring-2 ring-amber-400'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 hover:border-amber-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2.5 rounded-xl flex-shrink-0 ${
                        isSelected
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span>{opt.label}</span>
                        {opt.alert && (
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300">
                            {t('pay.common_scam_badge')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-6 h-6 text-amber-500 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-2">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
              {t('pay.custom_reason_label')}
            </label>
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder={t('pay.custom_reason_placeholder')}
              className="w-full p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-base"
            />
          </div>

          <button
            disabled={!whyReason && !customReason.trim()}
            onClick={() => setCurrentStep(3)}
            className="w-full min-h-[64px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white font-bold text-lg flex items-center justify-center gap-2 transition"
          >
            <span>{t('pay.btn_next')}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ================= STEP 3 ================= */}
      {currentStep === 3 && (
        <div className="space-y-4 animate-fade-in">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
            3. {t('pay.step3_title')}
          </h2>

          <div className="space-y-3">
            {recipientOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = recipientType === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`pay-recipient-${opt.id}`}
                  onClick={() => {
                    speech.warmUp();
                    setRecipientType(opt.id as any);
                  }}
                  className={`w-full min-h-[72px] p-4 rounded-2xl border-2 flex items-center justify-between text-left transition-all ${
                    isSelected
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-md ring-2 ring-amber-400'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 hover:border-amber-400'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`p-3 rounded-xl flex-shrink-0 ${
                        isSelected
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                        {opt.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {opt.desc}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-6 h-6 text-amber-500 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {errorMsg && (
            <div
              id="precheck-error"
              role="alert"
              className="rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-1"
            >
              <p className="font-black text-base text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 shrink-0" />
                {t('pay.error_title')}
              </p>
              <p className="text-sm text-amber-900 dark:text-amber-100">{errorMsg}</p>
              <p className="text-sm text-amber-900 dark:text-amber-100">{t('pay.error_hint')}</p>
            </div>
          )}

          <div className="pt-3">
            {isLoading ? (
              <div className="w-full min-h-[72px] rounded-2xl bg-amber-600 text-white flex items-center justify-center font-bold text-xl gap-3">
                <span className="animate-spin text-2xl">⏳</span>
                <span>{t('pay.analyzing')}</span>
              </div>
            ) : (
              <button
                id="precheck-submit-btn"
                disabled={!recipientType}
                onClick={handleFinishWizard}
                className="w-full min-h-[72px] rounded-2xl bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white font-black text-xl sm:text-2xl shadow-xl flex items-center justify-center gap-3 transition"
              >
                <Shield className="w-7 h-7 text-yellow-200" />
                <span>{errorMsg ? t('common.retry') : t('pay.btn_submit')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
