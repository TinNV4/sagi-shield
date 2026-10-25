import type {AdminSummary} from '../api/types';

/** Admin screen: which of loading / forbidden / unavailable / data to show, and the feedback agreement rate. */

export type AdminScreenState =
  | {kind: 'loading'}
  | {kind: 'sign_in'}
  | {kind: 'forbidden'}
  | {kind: 'unavailable'; detail: string | null}
  | {kind: 'data'};

export function adminScreenState(input: {
  data: unknown | null;
  error: {status: number; detail: string | null} | null;
}): AdminScreenState {
  if (input.data) return {kind: 'data'};
  if (!input.error) return {kind: 'loading'};
  const {status, detail} = input.error;
  if (status === 401) return {kind: 'sign_in'};
  if (status === 403) return {kind: 'forbidden'};
  return {kind: 'unavailable', detail: status === 503 ? detail : null};
}

/** Share of "right" answers as a whole percent; null while nobody answered (never a made-up 0 %). */
export function agreementRate(fb: {n: number; correct: number}): number | null {
  return fb.n > 0 ? Math.round((fb.correct / fb.n) * 100) : null;
}

export type AdminSection = 'verdicts' | 'latency' | 'live' | 'rule_hits' | 'reasons' | 'feedback' | 'households';

/**
 * What a card shows: `unavailable` when the server named the section (its numbers are not to be trusted or shown,
 * a zero would be invented), `empty` when it answered with nothing in it, else `ok`. Tolerates a missing section.
 */
export function sectionState(summary: Partial<AdminSummary>, section: AdminSection): 'ok' | 'unavailable' | 'empty' {
  if (summary.unavailable?.includes(section)) return 'unavailable';
  switch (section) {
    case 'verdicts':
      return summary.verdicts?.length ? 'ok' : 'empty';
    case 'rule_hits':
      return summary.rule_hits?.length ? 'ok' : 'empty';
    case 'reasons':
      return summary.reasons?.length ? 'ok' : 'empty';
    case 'latency': {
      const l = summary.latency_ms;
      return l && (l.p50 !== null || l.p95 !== null) ? 'ok' : 'empty';
    }
    case 'live': {
      const l = summary.live;
      return l && l.calls + l.looks + l.alarms > 0 ? 'ok' : 'empty';
    }
    case 'feedback': {
      const f = summary.feedback;
      return f && f.checks.n + f.alerts.n > 0 ? 'ok' : 'empty';
    }
    case 'households':
      return summary.households && summary.households.n > 0 ? 'ok' : 'empty';
  }
}