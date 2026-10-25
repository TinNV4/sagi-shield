import React, {useState} from 'react';
import {api} from '../api/client';
import {useI18n} from '../i18n';

const key = (alertId: string) => `sagi_alert_feedback:${alertId}`;

const readChoice = (alertId: string): boolean | null => {
  try {
    const v = localStorage.getItem(key(alertId));
    return v === 'real' ? true : v === 'false_alarm' ? false : null;
  } catch {
    return null;
  }
};

/** A guardian's one-tap answer on an alert card: "false alarm" or "it was a scam". Stores no text. */
export const AlertFeedback: React.FC<{householdId: string; alertId: string}> = ({householdId, alertId}) => {
  const {t} = useI18n();
  const [choice, setChoice] = useState<boolean | null>(() => readChoice(alertId));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = async (correct: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      // correct = "the alert was right", i.e. it was a scam
      await api.sendAlertFeedback(householdId, alertId, correct);
      try {
        localStorage.setItem(key(alertId), correct ? 'real' : 'false_alarm');
      } catch {}
      setChoice(correct);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (choice !== null) {
    return (
      <p className="text-xs font-bold opacity-80">
        {choice ? t('guardian.fb_real') : t('guardian.fb_false_alarm')} · {t('feedback.thanks')}
      </p>
    );
  }

  const btn =
    'min-h-[40px] px-3 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-current/30 text-xs font-bold disabled:opacity-50';
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => send(false)} className={btn}>
          {t('guardian.fb_false_alarm')}
        </button>
        <button type="button" disabled={busy} onClick={() => send(true)} className={btn}>
          {t('guardian.fb_real')}
        </button>
      </div>
      {failed && <p className="text-xs opacity-70">{t('feedback.failed')}</p>}
    </div>
  );
};
