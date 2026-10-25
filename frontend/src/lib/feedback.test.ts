import {beforeEach, describe, expect, it} from 'vitest';
import {feedbackKey, feedbackStep, INITIAL_FEEDBACK, readFeedbackSent, reasonsFor, writeFeedbackSent} from './feedback';

describe('reasonsFor', () => {
  it('a LOW verdict that was a scam: missed or too weak', () => {
    expect(reasonsFor('LOW')).toEqual(['missed', 'too_weak']);
  });
  it('MEDIUM offers every chip', () => {
    expect([...reasonsFor('MEDIUM')].sort()).toEqual(['missed', 'not_scam', 'too_strong', 'too_weak', 'wrong_type']);
  });
  it('HIGH: not a scam, too strong or wrong type', () => {
    expect(reasonsFor('HIGH')).toEqual(['not_scam', 'too_strong', 'wrong_type']);
  });
});

describe('feedbackStep', () => {
  it('thumbs up sends straight away', () => {
    expect(feedbackStep(INITIAL_FEEDBACK, {type: 'up'})).toEqual({phase: 'sending', correct: true, reason: undefined, failed: false});
  });
  it('thumbs down opens the reasons first', () => {
    expect(feedbackStep(INITIAL_FEEDBACK, {type: 'down'}).phase).toBe('choosing');
  });
  it('a reason sends a not-correct verdict', () => {
    const s = feedbackStep(feedbackStep(INITIAL_FEEDBACK, {type: 'down'}), {type: 'reason', reason: 'too_weak'});
    expect(s).toEqual({phase: 'sending', correct: false, reason: 'too_weak', failed: false});
  });
  it('success ends in sent', () => {
    const sending = feedbackStep(INITIAL_FEEDBACK, {type: 'up'});
    expect(feedbackStep(sending, {type: 'ok'}).phase).toBe('sent');
  });
  it('failure goes back to idle with the quiet failed flag, and a retry clears it', () => {
    const failed = feedbackStep(feedbackStep(INITIAL_FEEDBACK, {type: 'up'}), {type: 'fail'});
    expect(failed).toEqual({phase: 'idle', correct: undefined, reason: undefined, failed: true});
    expect(feedbackStep(failed, {type: 'up'}).failed).toBe(false);
  });
  it('events in the wrong phase change nothing', () => {
    expect(feedbackStep(INITIAL_FEEDBACK, {type: 'ok'})).toBe(INITIAL_FEEDBACK);
    const sent = {phase: 'sent', correct: true, reason: undefined, failed: false} as const;
    expect(feedbackStep(sent, {type: 'down'})).toBe(sent);
  });
});

describe('sent marker', () => {
  beforeEach(() => localStorage.clear());
  it('is stored per verdict', () => {
    expect(readFeedbackSent('abc')).toBe(false);
    writeFeedbackSent('abc');
    expect(feedbackKey('abc')).toBe('sagi_feedback:abc');
    expect(localStorage.getItem('sagi_feedback:abc')).not.toBeNull();
    expect(readFeedbackSent('abc')).toBe(true);
    expect(readFeedbackSent('other')).toBe(false);
  });
  it('survives a storage that throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readFeedbackSent('abc')).toBe(false);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});
