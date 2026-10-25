/**
 * "Was this right?" under a verdict. Pure logic only: which reason chips to offer, the send-state machine, and the
 * once-per-device marker. Feedback never changes a verdict screen: a failed send is a quiet line, nothing else.
 */
import type {RiskLevel} from '../api/types';

export type FeedbackReason = 'not_scam' | 'wrong_type' | 'too_weak' | 'too_strong' | 'missed';

/** Chips for a thumbs-down: a verdict that stayed quiet can only have been too weak / missed; a loud one too strong. */
export function reasonsFor(level: RiskLevel): FeedbackReason[] {
  if (level === 'LOW') return ['missed', 'too_weak'];
  if (level === 'HIGH') return ['not_scam', 'too_strong', 'wrong_type'];
  return ['not_scam', 'too_strong', 'wrong_type', 'missed', 'too_weak'];
}

export interface FeedbackState {
  phase: 'idle' | 'choosing' | 'sending' | 'sent';
  correct: boolean | undefined;
  reason: FeedbackReason | undefined;
  /** The last send failed: show the quiet "could not send" line. */
  failed: boolean;
}

export type FeedbackEvent =
  | {type: 'up'}
  | {type: 'down'}
  | {type: 'reason'; reason: FeedbackReason}
  | {type: 'ok'}
  | {type: 'fail'};

export const INITIAL_FEEDBACK: FeedbackState = {phase: 'idle', correct: undefined, reason: undefined, failed: false};

export function feedbackStep(state: FeedbackState, event: FeedbackEvent): FeedbackState {
  switch (event.type) {
    case 'up':
      return state.phase === 'idle' || state.phase === 'choosing'
        ? {phase: 'sending', correct: true, reason: undefined, failed: false}
        : state;
    case 'down':
      return state.phase === 'idle' ? {phase: 'choosing', correct: false, reason: undefined, failed: false} : state;
    case 'reason':
      return state.phase === 'choosing' ? {phase: 'sending', correct: false, reason: event.reason, failed: false} : state;
    case 'ok':
      return state.phase === 'sending' ? {...state, phase: 'sent', failed: false} : state;
    case 'fail':
      return state.phase === 'sending' ? {phase: 'idle', correct: undefined, reason: undefined, failed: true} : state;
  }
}

export const feedbackKey = (verdictId: string): string => `sagi_feedback:${verdictId}`;

export function readFeedbackSent(verdictId: string): boolean {
  try {
    return localStorage.getItem(feedbackKey(verdictId)) !== null;
  } catch {
    return false;
  }
}

export function writeFeedbackSent(verdictId: string): void {
  try {
    localStorage.setItem(feedbackKey(verdictId), '1');
  } catch {}
}
