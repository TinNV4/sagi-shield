import type {SpeechMode} from './liveGuard';

/**
 * Which privacy badge Live Guard shows next to the status. "On this device" is claimed only while the recogniser
 * runs locally and says nothing while none runs; the opt-in cloud recogniser sends audio to the browser maker's service, so it gets its own text.
 */
export function speechBadgeKey(
  mode: SpeechMode | null | undefined,
): 'live.ondevice_privacy' | 'live.cloud_privacy' | 'live.speech_idle_privacy' {
  if (mode === 'cloud') return 'live.cloud_privacy';
  if (mode === 'local') return 'live.ondevice_privacy';
  return 'live.speech_idle_privacy'; // no recogniser running (unknown or blocked): claim nothing
}
