import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The socket side is not under test: the wrapper only needs something to hand transcript lines to.
const socket = {sendTranscript: vi.fn(), sendReset: vi.fn(), close: vi.fn()};
vi.mock('../api/client', () => ({api: {connectLiveSocket: () => socket}}));

import {startLiveGuard} from './liveGuard';

/** A SpeechRecognition double: records start() calls and lets a test fire the browser's events. */
class FakeRecognition {
  static availability = 'available';
  static instances: FakeRecognition[] = [];
  static available = vi.fn(async () => FakeRecognition.availability);
  continuous = false;
  interimResults = true;
  lang = '';
  processLocally = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.availability = 'available';
  (window as any).SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  vi.useRealTimers();
  vi.clearAllMocks();
});

const callbacks = () => ({
  onRisk: vi.fn(),
  onReset: vi.fn(),
  onStatus: vi.fn(),
  onSpeechMode: vi.fn(),
  onSpeechError: vi.fn(),
  onError: vi.fn(),
});

describe('startLiveGuard', () => {
  it('starts on-device recognition only after the browser confirms it, and sends final lines only', async () => {
    const cb = callbacks();
    const guard = startLiveGuard('ja', 'kiosk', cb);
    const rec = FakeRecognition.instances[0];
    expect(rec.start).not.toHaveBeenCalled(); // not before available() answered
    await flush();
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec.processLocally).toBe(true);
    expect(rec.interimResults).toBe(false);
    expect(rec.lang).toBe('ja-JP');
    expect(cb.onSpeechMode).toHaveBeenCalledWith('local');

    rec.onresult!({resultIndex: 0, results: [[{transcript: ' 警察です '}], [{transcript: 'interim'}]].map((r, i) => Object.assign(r, {isFinal: i === 0}))});
    expect(socket.sendTranscript).toHaveBeenCalledTimes(1);
    expect(socket.sendTranscript).toHaveBeenCalledWith('警察です');
    guard.stop();
  });

  it('never listens when the pack is missing and no cloud fallback was allowed', async () => {
    const cb = callbacks();
    FakeRecognition.availability = 'downloadable';
    const guard = startLiveGuard('vi', 'manual', cb);
    await flush();
    expect(FakeRecognition.instances[0].start).not.toHaveBeenCalled();
    expect(cb.onSpeechMode).toHaveBeenCalledWith('blocked');
    guard.resume(); // a resume must not sneak a start in either
    expect(FakeRecognition.instances[0].start).not.toHaveBeenCalled();
    guard.stop();
  });

  it('stops restarting after a fatal error instead of looping', async () => {
    vi.useFakeTimers();
    const cb = callbacks();
    const guard = startLiveGuard('ja', 'kiosk', cb);
    await vi.advanceTimersByTimeAsync(0);
    const rec = FakeRecognition.instances[0];
    expect(rec.start).toHaveBeenCalledTimes(1);

    rec.onerror!({error: 'not-allowed'});
    rec.onend!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(cb.onSpeechMode).toHaveBeenLastCalledWith('blocked');
    expect(cb.onSpeechError).toHaveBeenCalledWith('not-allowed');
    guard.resume();
    expect(rec.start).toHaveBeenCalledTimes(1);
    guard.stop();
  });

  it('restarts a recognizer that ended, backing off when it ends right after starting', async () => {
    vi.useFakeTimers();
    const cb = callbacks();
    const guard = startLiveGuard('ja', 'kiosk', cb);
    await vi.advanceTimersByTimeAsync(0);
    const rec = FakeRecognition.instances[0];

    rec.onerror!({error: 'no-speech'}); // routine pause: not reported, not fatal
    expect(cb.onSpeechError).not.toHaveBeenCalled();
    rec.onend!();
    await vi.advanceTimersByTimeAsync(499);
    expect(rec.start).toHaveBeenCalledTimes(1); // ended within 2 s of starting: waits 500 ms first
    await vi.advanceTimersByTimeAsync(1);
    expect(rec.start).toHaveBeenCalledTimes(2);

    rec.onend!(); // again at once: 1 s
    await vi.advanceTimersByTimeAsync(999);
    expect(rec.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(rec.start).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(5_000); // it ran for a while this time: an immediate restart
    rec.onend!();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.start).toHaveBeenCalledTimes(4);

    guard.stop();
    rec.onend!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rec.start).toHaveBeenCalledTimes(4); // stopped: no restart
  });
});
