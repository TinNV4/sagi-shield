import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import alertVoice from './alertVoice.json';

// speak.ts keeps module state (fetched clips, timers): every test imports a fresh copy.
const load = async () => {
  vi.resetModules();
  return import('./speak');
};
const flush = () => new Promise((r) => setTimeout(r, 0));

const synth = {speak: vi.fn(), cancel: vi.fn(), resume: vi.fn(), getVoices: () => [], paused: false};
const play = vi.fn(() => Promise.resolve());
const spoken = () => synth.speak.mock.calls.map(([u]) => u.text).filter((t: string) => t.trim());

beforeEach(() => {
  (window as any).speechSynthesis = synth;
  (window as any).SpeechSynthesisUtterance = class {
    constructor(public text: string) {}
  };
  window.HTMLMediaElement.prototype.play = play as any;
  window.HTMLMediaElement.prototype.pause = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:clip');
  globalThis.fetch = vi.fn(async () => ({ok: true, blob: async () => new Blob(['wav'])})) as any;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  play.mockImplementation(() => Promise.resolve());
});

describe('spoken alert', () => {
  it('plays the recorded clip once it is preloaded, without the browser voice', async () => {
    const speech = await load();
    expect(await speech.preload('hangup', 'vi')).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/voice/hangup-vi.wav');
    speech.speak('Cuộc gọi này có dấu hiệu lừa đảo.', 'vi');
    await flush();
    expect(play).toHaveBeenCalledTimes(1);
    expect(spoken()).toEqual([]);
    speech.stop();
  });

  it('reads the sentence with the browser voice when the clip is missing', async () => {
    globalThis.fetch = vi.fn(async () => ({ok: false})) as any;
    const speech = await load();
    expect(await speech.preload('hangup', 'ja')).toBe(false);
    speech.speak(undefined, 'ja');
    expect(spoken()).toEqual([alertVoice.clips.hangup.ja]);
    speech.stop();
  });

  it('falls back to the browser voice when the clip may not play (no user gesture yet)', async () => {
    play.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    const speech = await load();
    await speech.preload('guardian', 'en');
    speech.speak('Family alert', 'en', 'guardian');
    await flush();
    expect(spoken()).toEqual(['Family alert']);
    speech.stop();
  });

  it('repeats after the clip ends and stays silent once dismissed', async () => {
    const speech = await load();
    await speech.preload('hangup', 'ja');
    vi.useFakeTimers();
    speech.speak(undefined, 'ja');
    await vi.advanceTimersByTimeAsync(0);
    const audio = play.mock.contexts[0] as unknown as HTMLAudioElement;
    audio.onended?.(new Event('ended'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(play).toHaveBeenCalledTimes(2);

    speech.stop();
    audio.onended?.(new Event('ended')); // stop() clears the handler
    await vi.advanceTimersByTimeAsync(20000);
    expect(play).toHaveBeenCalledTimes(2);
    expect(spoken()).toEqual([]);
  });

  it('does not restart an alert dismissed while the clip was starting', async () => {
    let start!: () => void;
    play.mockImplementation(() => new Promise<void>((r) => (start = r)));
    const speech = await load();
    await speech.preload('hangup', 'ja');
    speech.speak(undefined, 'ja');
    speech.stop();
    start();
    await flush();
    const audio = play.mock.contexts[0] as unknown as HTMLAudioElement;
    expect(audio.onended).toBeNull();
    expect(spoken()).toEqual([]);
  });
});
