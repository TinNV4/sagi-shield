/** Admin screen: which of loading / forbidden / unavailable / data to show, and the feedback agreement rate. */

export type AdminScreenState =
  | {kind: 'loading'}
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
  if (status === 401 || status === 403) return {kind: 'forbidden'};
  return {kind: 'unavailable', detail: status === 503 ? detail : null};
}

/** Share of "right" answers as a whole percent; null while nobody answered (never a made-up 0 %). */
export function agreementRate(fb: {n: number; correct: number}): number | null {
  return fb.n > 0 ? Math.round((fb.correct / fb.n) * 100) : null;
}
