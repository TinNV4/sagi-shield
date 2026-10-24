/** Live Guard tells its household it is alive: no text, only "still running" and whether it is listening. */
export const HEARTBEAT_EVERY_MS = 180000;

/**
 * Sends at once and then every `everyMs`. A failed send (offline, 4xx, a thrown error) is one console warning and the
 * loop goes on: a heartbeat must never touch the guard that is protecting a call. Returns the stop function.
 */
export function startHeartbeat(
  getListening: () => boolean,
  send: (listening: boolean) => Promise<void>,
  everyMs: number = HEARTBEAT_EVERY_MS,
): () => void {
  const beat = () => {
    try {
      Promise.resolve(send(getListening())).catch((err) => console.warn('heartbeat failed', err));
    } catch (err) {
      console.warn('heartbeat failed', err);
    }
  };
  beat();
  const timer = setInterval(beat, everyMs);
  return () => clearInterval(timer);
}
