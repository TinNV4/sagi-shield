import type {SpeechMode} from './liveGuard';

/**
 * Which privacy badge Live Guard shows next to the status. "On this device" is claimed only while the recogniser
 * runs locally; the opt-in cloud recogniser sends audio to the browser maker's service, so it gets its own text.
 */
export function speechBadgeKey(mode: SpeechMode | null | undefined): 'live.ondevice_privacy' | 'live.cloud_privacy' {
  return mode === 'cloud' ? 'live.cloud_privacy' : 'live.ondevice_privacy';
}
