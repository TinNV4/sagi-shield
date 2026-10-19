/**
 * Voice Alert Synthesizer for Sagi Shield
 * Speaks loud alert warnings on HIGH scam risk and handles browser gesture warm-up.
 *
 * The alerts are pre-recorded Gemini voice clips (public/voice/<clip>-<lang>.wav, made by tools/make_alert_voice.py
 * from alertVoice.json). A clip plays from memory once preload() has fetched it; until then, or if the clip cannot
 * play, the browser's own voice reads the same sentence, so an alert is never silent.
 */
import alertVoice from './alertVoice.json';

export type Clip = keyof typeof alertVoice.clips;
type ClipLang = 'ja' | 'vi' | 'en';

let repeatTimer: ReturnType<typeof setTimeout> | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let player: HTMLAudioElement | null = null;
let hasWarmedUp = false;
let repeatCount = 0;
let generation = 0; // bumped by stop(): a play() that resolves after a dismissal must not restart the alert
const MAX_REPEATS = 5;
const REPEAT_MS = 8000; // browser voice: one alert every 8 s
const CLIP_GAP_MS = 2500; // recorded clip: the next one starts 2.5 s after the previous one ends
const clipUrls = new Map<string, string>(); // "hangup-ja" -> object URL of the fetched clip
const loading = new Map<string, Promise<boolean>>();

// smallest valid WAV (no samples): played on the first touch so iOS lets this element play later without one
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const clipLang = (lang: string): ClipLang => (lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : 'ja');
const clipKey = (clip: Clip, lang: string) => `${clip}-${clipLang(lang)}`;
const clipText = (clip: Clip, lang: string) => alertVoice.clips[clip][clipLang(lang)];

function getPlayer(): HTMLAudioElement | null {
  if (!player && typeof Audio !== 'undefined') player = new Audio();
  return player;
}

/**
 * Fetch a clip into memory, so the alert plays the instant a call turns HIGH (no network at that moment).
 * Resolves false when the clip is not available; speak() then uses the browser voice.
 */
export function preload(clip: Clip, lang: string): Promise<boolean> {
  const key = clipKey(clip, lang);
  if (clipUrls.has(key)) return Promise.resolve(true);
  if (typeof fetch === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(false);
  let pending = loading.get(key);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}voice/${key}.wav`)
      .then(async (res) => {
        if (!res.ok) return false;
        clipUrls.set(key, URL.createObjectURL(await res.blob()));
        return true;
      })
      .catch(() => false)
      .finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  return pending;
}

/**
 * Call on first user touch/click anywhere in the app to unlock Web Speech API
 * on iOS Safari and Android Chrome without delay.
 */
export function warmUp(): void {
  if (hasWarmedUp || typeof window === 'undefined') {
    return;
  }
  hasWarmedUp = true;
  const audio = getPlayer();
  if (audio) {
    audio.src = SILENT_WAV;
    audio.play()?.catch(() => {});
  }
  if (!window.speechSynthesis) return;
  try {
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0.01;
    silent.rate = 1.0;
    window.speechSynthesis.speak(silent);
  } catch (err) {
    console.warn('Speech warm-up failed:', err);
  }
}

/**
 * Stop any current speech and cancel all pending repeat timers immediately.
 */
export function stop(): void {
  if (repeatTimer) {
    clearTimeout(repeatTimer);
    repeatTimer = null;
  }
  repeatCount = 0;
  generation++;

  if (player) {
    player.onended = null;
    player.pause();
  }

  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
        currentUtterance.onpause = null;
        currentUtterance.onresume = null;
        currentUtterance.onmark = null;
        currentUtterance.onboundary = null;
      }
      // If synthesis is paused or hung, resume first so cancel clears the buffer cleanly
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();

      // Immediate follow-up tick to prevent WebKit/Chromium buffer trailing
      setTimeout(() => {
        try {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
          }
        } catch {}
      }, 25);
    } catch (err) {
      console.warn('SpeechSynthesis cancel error:', err);
    }
  }
  currentUtterance = null;
}

/** One sentence in the browser's voice for this language. */
function speakWithBrowser(text: string, lang: string, rate: number): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance = utterance;
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0; // Max volume

    // Select voice matching requested language if available
    const targetLang = clipLang(lang);
    const matchedVoice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(targetLang));
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    utterance.lang = targetLang === 'vi' ? 'vi-VN' : targetLang === 'en' ? 'en-US' : 'ja-JP';
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('SpeechSynthesis error:', err);
  }
}

/** Play a fetched clip; resolves false if the browser refused to play it. */
function playClip(url: string): Promise<boolean> {
  const audio = getPlayer();
  if (!audio) return Promise.resolve(false);
  audio.onended = null;
  audio.src = url;
  audio.currentTime = 0;
  audio.volume = 1.0;
  return Promise.resolve(audio.play())
    .then(() => true)
    .catch(() => false);
}

/**
 * Play a voice warning immediately and repeat it (up to 5 times) until stopped.
 * `clip` names the recorded sentence; `customText` is what the browser voice reads when the clip is not available.
 */
export function speak(customText?: string, lang: string = 'ja', clip: Clip = 'hangup'): void {
  stop();
  const text = customText?.trim() || clipText(clip, lang);
  const url = clipUrls.get(clipKey(clip, lang));
  if (!url) void preload(clip, lang); // next alert gets the recorded voice

  const browserOnce = () => {
    speakWithBrowser(text, lang, 0.9); // rate 0.9 for clear and deliberate urgent warning
    repeatCount++;
    repeatTimer = repeatCount < MAX_REPEATS ? setTimeout(browserOnce, REPEAT_MS) : null;
  };

  const clipOnce = () => {
    const mine = generation;
    playClip(url!).then((played) => {
      if (generation !== mine) return;
      if (!played) {
        browserOnce();
        return;
      }
      repeatCount++;
      player!.onended = () => {
        if (repeatCount < MAX_REPEATS) repeatTimer = setTimeout(clipOnce, CLIP_GAP_MS);
      };
    });
  };

  if (url) clipOnce();
  else browserOnce();
}

/**
 * Test function for Settings screen: the same voice the alert uses.
 */
export function testVoice(lang: string = 'ja'): void {
  stop();
  const mine = generation;
  preload('test', lang).then(async (ready) => {
    const url = ready ? clipUrls.get(clipKey('test', lang)) : undefined;
    const played = url ? await playClip(url) : false;
    if (!played && generation === mine) speakWithBrowser(clipText('test', lang), lang, 0.95);
  });
}
