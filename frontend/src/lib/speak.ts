/**
 * Voice Alert Synthesizer for Sagi Shield
 * Speaks loud alert warnings on HIGH scam risk and handles browser gesture warm-up.
 */

let repeatTimer: any = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let hasWarmedUp = false;
let repeatCount = 0;
const MAX_REPEATS = 5;

const DEFAULT_FALLBACK_TEXT: Record<string, string> = {
  ja: 'この通話は詐欺の可能性があります。電話を今すぐ切ってください。',
  vi: 'Cảnh báo! Cuộc gọi này có dấu hiệu lừa đảo. Hãy cúp máy ngay lập tức!',
  en: 'Warning! This call is very likely a scam. Hang up the phone immediately!',
};

/**
 * Call on first user touch/click anywhere in the app to unlock Web Speech API
 * on iOS Safari and Android Chrome without delay.
 */
export function warmUp(): void {
  if (hasWarmedUp || typeof window === 'undefined' || !window.speechSynthesis) {
    return;
  }
  try {
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0.01;
    silent.rate = 1.0;
    window.speechSynthesis.speak(silent);
    hasWarmedUp = true;
  } catch (err) {
    console.warn('Speech warm-up failed:', err);
  }
}

/**
 * Stop any current speech and cancel all pending repeat timers immediately.
 */
export function stop(): void {
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }
  repeatCount = 0;

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

/**
 * Play a voice warning immediately and repeat every 8 seconds (up to 5 times) until stopped.
 */
export function speak(customText?: string, lang: string = 'ja'): void {
  stop();

  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return;
  }

  const textToSpeak = customText?.trim() || DEFAULT_FALLBACK_TEXT[lang] || DEFAULT_FALLBACK_TEXT.ja;

  const playOnce = () => {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      currentUtterance = utterance;

      // Rate 0.9 for clear and deliberate urgent warning
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 1.0; // Max volume

      // Select voice matching requested language if available
      const voices = window.speechSynthesis.getVoices();
      const targetLang = lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : 'ja';
      const matchedVoice = voices.find(v => v.lang.toLowerCase().startsWith(targetLang));
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }
      utterance.lang = targetLang === 'vi' ? 'vi-VN' : targetLang === 'en' ? 'en-US' : 'ja-JP';

      window.speechSynthesis.speak(utterance);
      repeatCount++;

      if (repeatCount >= MAX_REPEATS) {
        if (repeatTimer) {
          clearInterval(repeatTimer);
          repeatTimer = null;
        }
      }
    } catch (err) {
      console.warn('SpeechSynthesis error:', err);
    }
  };

  playOnce();

  // Repeat every 8 seconds up to 5 times unless dismissed
  repeatTimer = setInterval(() => {
    if (repeatCount < MAX_REPEATS) {
      playOnce();
    } else {
      stop();
    }
  }, 8000);
}

/**
 * Test function for Settings screen
 */
export function testVoice(lang: string = 'ja'): void {
  stop();
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const sample: Record<string, string> = {
    ja: 'これはサギシールドの音声警告テストです。危険時はこのように声でお知らせします。',
    vi: 'Đây là âm thanh thử nghiệm của Sagi Shield. Ứng dụng sẽ cảnh báo bằng giọng nói khi có nguy hiểm.',
    en: 'This is a voice alert test for Sagi Shield. You will be warned aloud when danger is detected.',
  };

  const text = sample[lang] || sample.ja;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const targetLang = lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : 'ja';
    const matchedVoice = voices.find(v => v.lang.toLowerCase().startsWith(targetLang));
    if (matchedVoice) u.voice = matchedVoice;
    u.lang = targetLang === 'vi' ? 'vi-VN' : targetLang === 'en' ? 'en-US' : 'ja-JP';
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn('Voice test failed:', e);
  }
}
