import {describe, expect, it} from 'vitest';
import {speechBadgeKey} from './speechBadge';

describe('speechBadgeKey', () => {
  it('keeps the on-device badge for local recognition and before a mode is known', () => {
    expect(speechBadgeKey('local')).toBe('live.ondevice_privacy');
    expect(speechBadgeKey(null)).toBe('live.ondevice_privacy');
    expect(speechBadgeKey('blocked')).toBe('live.ondevice_privacy');
  });
  it('says the cloud recogniser is in use when it is', () => {
    expect(speechBadgeKey('cloud')).toBe('live.cloud_privacy');
  });
});
