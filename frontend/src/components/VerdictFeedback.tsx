import React, {useState} from 'react';
import {ThumbsDown, ThumbsUp} from 'lucide-react';
import {api} from '../api/client';
import type {RiskLevel} from '../api/types';
import {useI18n} from '../i18n';
import {
  feedbackStep,
  INITIAL_FEEDBACK,
  readFeedbackSent,
  reasonsFor,
  writeFeedbackSent,
  type FeedbackEvent,
  type FeedbackReason,
} from '../lib/feedback';

/**
 * "Was this right?" under a verdict. One answer per verdict per device; a failed send only shows a quiet line and
 * never touches the verdict above it.
 */
export const VerdictFeedback: React.FC<{verdictId: string; level: RiskLevel}> = ({verdictId, level}) => {
  const {t, lang} = useI18n();
  const [state, setState] = useState(() =>
    readFeedbackSent(verdictId) ? {...INITIAL_FEEDBACK, phase: 'sent' as const} : INITIAL_FEEDBACK
  );

  const send = async (correct: boolean, reason?: FeedbackReason) => {
    try {
      await api.sendFeedback(verdictId, correct, reason, lang);
      writeFeedbackSent(verdictId);
      setState((s) => feedbackStep(s, {type: 'ok'}));
    } catch {
      setState((s) => feedbackStep(s, {type: 'fail'}));
    }
  };

  const dispatch = (event: FeedbackEvent) => {
    const next = feedbackStep(state, event);
    if (next === state) return;
    setState(next);
    if (next.phase === 'sending') void send(next.correct === true, next.reason);
  };

  if (state.phase === 'sent') {
    return (
      <p id="feedback-thanks" className="text-sm font-bold text-center text-gray-600 dark:text-gray-300">
        {t('feedback.thanks')}
      </p>
    );
  }

  const busy = state.phase === 'sending';
  const btn =
    'min-h-[44px] px-4 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-bold text-sm flex items-center gap-2 disabled:opacity-50';

  return (
    <div id="verdict-feedback" className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('feedback.question')}</span>
        <div className="flex gap-2">
          <button id="feedback-up" type="button" disabled={busy} onClick={() => dispatch({type: 'up'})} className={btn} aria-label={t('feedback.yes')}>
            <ThumbsUp className="w-4 h-4" />
            <span>{t('feedback.yes')}</span>
          </button>
          <button id="feedback-down" type="button" disabled={busy} onClick={() => dispatch({type: 'down'})} className={btn} aria-label={t('feedback.no')}>
            <ThumbsDown className="w-4 h-4" />
            <span>{t('feedback.no')}</span>
          </button>
        </div>
      </div>
      {state.phase !== 'idle' && state.correct === false && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600 dark:text-gray-300">{t('feedback.reason_title')}</p>
          <div className="flex flex-wrap gap-2">
            {reasonsFor(level).map((reason) => (
              <button
                key={reason}
                type="button"
                disabled={busy}
                onClick={() => dispatch({type: 'reason', reason})}
                className="min-h-[40px] px-3 rounded-full border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 text-[#1B4D3E] dark:text-emerald-200 font-bold text-xs disabled:opacity-50"
              >
                {t(`feedback.reason_${reason}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {state.failed && <p className="text-xs text-gray-500 dark:text-gray-400">{t('feedback.failed')}</p>}
    </div>
  );
};
