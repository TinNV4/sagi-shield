import {api} from '../api/client';
import {LiveSocketCallbacks, LiveSocketConnection} from '../api/types';

// SpeechRecognition type declarations for browsers that support it
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export interface LiveGuardController {
  stop: () => void;
  pause: (ms: number) => void;
  resume: () => void;
  reset: () => void;
  isPaused: () => boolean;
  canProcessLocally: boolean;
}

export type SpeechMode = 'local' | 'cloud' | 'blocked';

export interface LiveGuardOptions extends LiveSocketCallbacks {
  allowCloudFallback?: boolean;
  /** local = on-device; cloud = user opted in to the browser's cloud recognizer; blocked = not listening */
  onSpeechMode?: (mode: SpeechMode) => void;
}

export interface SpeechSupportDetails {
  supported: boolean;
  canProcessLocally: boolean;
  status: 'ready' | 'downloadable' | 'downloading' | 'unsupported';
  language: string;
  languageName: string;
}

const langTagOf = (lang: string) => (lang === 'ja' ? 'ja-JP' : lang === 'vi' ? 'vi-VN' : 'en-US');
const speechRec = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Asks the browser whether it can recognize this language ON THE DEVICE.
 * PRIVACY: the only source of truth is SpeechRecognition.available(). Never infer it from a
 * localStorage flag or from the mere existence of the `processLocally` property - doing so would
 * tell the user "audio stays on this device" while Chrome streams it to a cloud recognizer.
 */
export async function checkOnDeviceSpeechSupport(lang: string): Promise<SpeechSupportDetails> {
  const base = {language: langTagOf(lang), languageName: lang === 'ja' ? '日本語' : lang === 'vi' ? 'Tiếng Việt' : 'English'};
  const SpeechRec = speechRec();
  if (!SpeechRec) return {...base, supported: false, canProcessLocally: false, status: 'unsupported'};
  if (typeof SpeechRec.available !== 'function') return {...base, supported: true, canProcessLocally: false, status: 'unsupported'};
  try {
    const avail = await SpeechRec.available({langs: [base.language], processLocally: true});
    if (avail === 'available') return {...base, supported: true, canProcessLocally: true, status: 'ready'};
    if (avail === 'downloadable' || avail === 'downloading')
      return {...base, supported: true, canProcessLocally: false, status: avail};
  } catch (e) {
    console.warn('SpeechRecognition.available failed:', e);
  }
  return {...base, supported: true, canProcessLocally: false, status: 'unsupported'};
}

/**
 * Downloads the on-device language pack through the browser. Resolves true only if the browser
 * then reports the pack as available. No simulated progress: a fake "installed" state is a lie
 * about where the caller's voice goes.
 */
export async function installLanguagePack(
  lang: string,
  onProgress?: (percent: number, stepText: string) => void
): Promise<boolean> {
  const SpeechRec = speechRec();
  if (!SpeechRec || typeof SpeechRec.install !== 'function') return false;
  try {
    if (onProgress) onProgress(10, '...');
    await SpeechRec.install({langs: [langTagOf(lang)], processLocally: true});
  } catch (e) {
    console.warn('SpeechRecognition.install failed:', e);
    return false;
  }
  const ok = (await checkOnDeviceSpeechSupport(lang)).canProcessLocally;
  if (ok && onProgress) onProgress(100, 'OK');
  return ok;
}

/**
 * Starts the live protection session:
 * Connects WebSocket (or MockApi live simulation) and initializes on-device speech recognition.
 */
export function startLiveGuard(
  lang: string,
  mode: 'kiosk' | 'manual',
  options: LiveGuardOptions
): LiveGuardController {
  let isRunning = true;
  let isPausedState = false;
  let pauseTimeout: any = null;
  let recognition: any = null;

  // Initialize socket connection via API client
  const socketConn: LiveSocketConnection = api.connectLiveSocket(lang, mode, {
    onRisk: options.onRisk,
    onReset: options.onReset,
    onStatus: (status) => {
      if (!isPausedState) {
        options.onStatus(status);
      }
    },
    onTranscript: options.onTranscript,
    onError: options.onError,
  });

  // Setup Web Speech Recognition
  const SpeechRec =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  let canProcessLocally = false;

  if (!SpeechRec && options.onSpeechMode) options.onSpeechMode('blocked');
  if (SpeechRec) {
    try {
      recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = false; // PRIVACY & CONTRACT: Do not send interim results!
      recognition.maxAlternatives = 1;

      // Map language
      recognition.lang = langTagOf(lang);

      recognition.onresult = (event: any) => {
        if (!isRunning || isPausedState) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            const transcript = res[0].transcript.trim();
            if (transcript.length > 0) {
              // Send finalized text line over WebSocket
              socketConn.sendTranscript(transcript);
            }
          }
        }
      };

      recognition.onerror = (event: any) => {
        // Silently recover from common non-fatal speech recognition pauses (e.g. no-speech)
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          return;
        }
        console.warn('SpeechRecognition warning:', event.error);
      };

      recognition.onend = () => {
        // Auto-restart while running to maintain continuous guard
        if (isRunning && !isPausedState) {
          try {
            recognition.start();
          } catch (e) {
            setTimeout(() => {
              if (isRunning && !isPausedState) {
                try {
                  recognition.start();
                } catch {}
              }
            }, 1000);
          }
        }
      };

      // Start only after the browser CONFIRMS on-device recognition, or after an explicit opt-in.
      checkOnDeviceSpeechSupport(lang).then((support) => {
        if (!isRunning) return;
        canProcessLocally = support.canProcessLocally;
        controller.canProcessLocally = canProcessLocally;
        if (canProcessLocally) recognition.processLocally = true;
        const mode: SpeechMode = canProcessLocally ? 'local' : options.allowCloudFallback ? 'cloud' : 'blocked';
        if (options.onSpeechMode) options.onSpeechMode(mode);
        if (mode !== 'blocked' && !isPausedState) {
          try {
            recognition.start();
          } catch {}
        }
      });
    } catch (err) {
      console.warn('Web Speech API initialization warning:', err);
    }
  }

  const controller: LiveGuardController = {
    stop: () => {
      isRunning = false;
      if (pauseTimeout) clearTimeout(pauseTimeout);
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      socketConn.close();
    },

    pause: (ms: number) => {
      isPausedState = true;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      options.onStatus('disconnected');

      if (pauseTimeout) clearTimeout(pauseTimeout);
      pauseTimeout = setTimeout(() => {
        controller.resume();
      }, ms);
    },

    resume: () => {
      isPausedState = false;
      if (pauseTimeout) clearTimeout(pauseTimeout);
      if (isRunning && recognition) {
        try {
          recognition.start();
        } catch {}
      }
      options.onStatus('listening');
    },

    reset: () => {
      socketConn.sendReset();
    },

    isPaused: () => isPausedState,

    canProcessLocally,
  };

  return controller;
}
