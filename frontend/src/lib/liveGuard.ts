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
  /** Test tool: push one transcript line as if the recognizer had heard it. */
  sendLine: (text: string) => void;
  isPaused: () => boolean;
  canProcessLocally: boolean;
}

export type SpeechMode = 'local' | 'cloud' | 'blocked';

export interface LiveGuardOptions extends LiveSocketCallbacks {
  allowCloudFallback?: boolean;
  /** local = on-device; cloud = user opted in to the browser's cloud recognizer; blocked = not listening */
  onSpeechMode?: (mode: SpeechMode) => void;
  /** Test tool: recognize this track (a played audio file) instead of the microphone. Same pipeline otherwise. */
  audioTrack?: MediaStreamTrack;
  /** Recognizer errors worth showing in test mode (e.g. the browser cannot take a track). */
  onSpeechError?: (error: string) => void;
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

export interface FileAudioSource {
  track: MediaStreamTrack;
  ended: Promise<void>;
  stop: () => void;
}

/**
 * Plays an audio file and exposes it as a MediaStreamTrack, so a recorded call can go through the very same
 * on-device recognizer as the microphone (SpeechRecognition.start(track), Chrome 139+). The file is decoded
 * and played in this page only; nothing is uploaded.
 */
export async function audioFileSource(file: File, audible = true): Promise<FileAudioSource> {
  const ctx = new AudioContext();
  const el = new Audio(URL.createObjectURL(file));
  const node = ctx.createMediaElementSource(el);
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);
  if (audible) node.connect(ctx.destination);
  const stop = () => {
    el.pause();
    URL.revokeObjectURL(el.src);
    ctx.close().catch(() => {});
  };
  const ended = new Promise<void>((resolve) => el.addEventListener('ended', () => resolve(), {once: true}));
  await ctx.resume();
  await el.play();
  return {track: dest.stream.getAudioTracks()[0], ended, stop};
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
  // PRIVACY: null until checkOnDeviceSpeechSupport() decides. Every (re)start goes through
  // mayListen(), so pause/resume or the auto-restart can never turn a 'blocked' session into
  // one that streams audio to the browser's cloud recognizer.
  let speechMode: SpeechMode | null = null;
  const mayListen = () => speechMode === 'local' || speechMode === 'cloud';

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
  const SpeechRec = speechRec();

  let canProcessLocally = false;
  // Errors after which another start() would fail the same way: the microphone was refused, the browser blocks
  // the recognizer, or it has no model for this language. Restarting on these spun in a tight loop
  // (error -> end -> start -> error ...), so they end the session instead and the UI is told why.
  const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'bad-grammar']);
  let fatal = false;
  let lastStartAt = 0;
  let restartDelay = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  // With a test track: recognize the file. If this browser's start() ignores the argument it would silently
  // listen to the microphone instead, so the UI labels the mode and shows recognizer errors.
  const startRec = () => {
    lastStartAt = Date.now();
    return options.audioTrack ? recognition.start(options.audioTrack) : recognition.start();
  };
  // Kiosk auto-restart with back-off: a recognizer that ends right after starting (no microphone, a transient
  // network error in cloud mode) is retried at 0.5 s, 1 s, ... 10 s; one that ran for a while restarts at once.
  const scheduleRestart = () => {
    if (restartTimer) clearTimeout(restartTimer);
    restartDelay = Date.now() - lastStartAt < 2000 ? Math.min(Math.max(restartDelay * 2, 500), 10000) : 0;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!isRunning || isPausedState || fatal || !mayListen()) return;
      try {
        startRec();
      } catch {
        scheduleRestart();
      }
    }, restartDelay);
  };

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
        const error = String(event.error);
        // Silently recover from common non-fatal speech recognition pauses (e.g. no-speech); 'aborted' is our own stop()
        if (error === 'no-speech' || error === 'audio-capture' || error === 'aborted') {
          return;
        }
        console.warn('SpeechRecognition warning:', error);
        if (FATAL_ERRORS.has(error)) {
          fatal = true;
          speechMode = 'blocked';
          if (options.onSpeechMode) options.onSpeechMode('blocked');
          if (options.onError) options.onError(new Error(`speech recognition stopped: ${error}`));
        }
        if (options.onSpeechError) options.onSpeechError(error);
      };

      recognition.onend = () => {
        // Auto-restart while running to maintain continuous guard
        if (options.audioTrack && options.audioTrack.readyState === 'ended') return; // the file is over
        if (isRunning && !isPausedState && !fatal && mayListen()) scheduleRestart();
      };

      // Start only after the browser CONFIRMS on-device recognition, or after an explicit opt-in.
      checkOnDeviceSpeechSupport(lang).then((support) => {
        if (!isRunning) return;
        canProcessLocally = support.canProcessLocally;
        controller.canProcessLocally = canProcessLocally;
        if (canProcessLocally) recognition.processLocally = true;
        speechMode = canProcessLocally ? 'local' : options.allowCloudFallback ? 'cloud' : 'blocked';
        if (options.onSpeechMode) options.onSpeechMode(speechMode);
        if (mayListen() && !isPausedState) {
          try {
            startRec();
          } catch (e) {
            if (options.onSpeechError) options.onSpeechError(String(e));
          }
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
      if (restartTimer) clearTimeout(restartTimer);
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      socketConn.close();
    },

    pause: (ms: number) => {
      isPausedState = true;
      if (restartTimer) clearTimeout(restartTimer);
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
      if (isRunning && recognition && !fatal && mayListen()) {
        try {
          startRec();
        } catch {}
      }
      options.onStatus('listening');
    },

    reset: () => {
      socketConn.sendReset();
    },

    sendLine: (text: string) => {
      const line = text.trim();
      if (line) socketConn.sendTranscript(line);
    },

    isPaused: () => isPausedState,

    canProcessLocally,
  };

  return controller;
}
