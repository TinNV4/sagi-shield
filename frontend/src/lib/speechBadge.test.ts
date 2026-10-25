import {describe, expect, it} from 'vitest';
import {speechBadgeKey} from './speechBadge';

describe('speechBadgeKey', () => {
  it('keeps the on-device badge for local recognition', () => {
    expect(speechBadgeKey('local')).toBe('live.ondevice_privacy');
  });
  it('claims nothing on-device before a mode is known or when recognition is blocked', () => {
    expect(speechBadgeKey(null)).toBe('live.speech_idle_privacy');
    expect(speechBadgeKey(undefined)).toBe('live.speech_idle_privacy');
    expect(speechBadgeKey('blocked')).toBe('live.speech_idle_privacy');
  });
  it('says the cloud recogniser is in use when it is', () => {
    expect(speechBadgeKey('cloud')).toBe('live.cloud_privacy');
  });
});
