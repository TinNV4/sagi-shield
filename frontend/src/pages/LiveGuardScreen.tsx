import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Clock,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  Wifi,
  WifiOff,
  AlertTriangle,
  Info,
  Cpu,
  Download,
  Settings2,
} from 'lucide-react';
import {KillChainStage, LiveWsServerRiskMessage, RiskLevel} from '../api/types';
import {HighRiskTakeover} from '../components/HighRiskTakeover';
import {KillChainBar} from '../components/KillChainBar';
import {OnDeviceSpeechSetupModal} from '../components/OnDeviceSpeechSetupModal';
import {RiskMeter} from '../components/RiskMeter';
import {useI18n} from '../i18n';
import {
  audioFileSource,
  checkOnDeviceSpeechSupport,
  FileAudioSource,
  LiveGuardController,
  SpeechSupportDetails,
  startLiveGuard,
} from '../lib/liveGuard';
import * as speech from '../lib/speak';

interface LiveGuardScreenProps {
  isKioskMode: boolean;
  onExitKioskRequest?: () => void;
  speakEnabled?: boolean;
}

export const LiveGuardScreen: React.FC<LiveGuardScreenProps> = ({
  isKioskMode,
  onExitKioskRequest,
  speakEnabled = true,
}) => {
  const {t, lang} = useI18n();

  // Guard state
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [kioskStartedOnce, setKioskStartedOnce] = useState(() => {
    try {
      return localStorage.getItem('sagi_kiosk_initialized') === 'true';
    } catch {
      return false;
    }
  });

  // On-device speech recognition setup state
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [speechDetails, setSpeechDetails] = useState<SpeechSupportDetails | null>(null);

  // Check speech support on lang change
  const refreshSpeechStatus = useCallback(async () => {
    try {
      const details = await checkOnDeviceSpeechSupport(lang);
      setSpeechDetails(details);
    } catch (e) {
      console.warn('Check speech error:', e);
    }
  }, [lang]);

  useEffect(() => {
    refreshSpeechStatus();
  }, [refreshSpeechStatus]);

  // Risk state
  const [score, setScore] = useState<number>(0);
  const [level, setLevel] = useState<RiskLevel>('LOW');
  const [stage, setStage] = useState<KillChainStage>(0);
  const [maxStage, setMaxStage] = useState<KillChainStage>(0);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [lastAdvice, setLastAdvice] = useState<string>('');
  const [lastTrigger, setLastTrigger] = useState<string>('');
  const [isHighTakeover, setIsHighTakeover] = useState<boolean>(false);

  // Connection & Activity State
  const [status, setStatus] = useState<'idle' | 'listening' | 'checking' | 'connected' | 'reconnecting' | 'disconnected'>('idle');
  const [allowCloudFallback, setAllowCloudFallback] = useState<boolean>(false);
  const [showCloudOptInNotice, setShowCloudOptInNotice] = useState<boolean>(false);

  // Kiosk clock and idle dimming
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isDimmed, setIsDimmed] = useState<boolean>(false);
  const idleTimerRef = useRef<any>(null);
  const clockTapCountRef = useRef<number>(0);
  const clockTapTimerRef = useRef<any>(null);
  const [showDebugOverlay, setShowDebugOverlay] = useState<boolean>(false);

  // Wake Lock Ref
  const wakeLockRef = useRef<any>(null);
  const guardControllerRef = useRef<LiveGuardController | null>(null);

  // Update clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Screen Wake Lock Management
  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('WakeLock request error:', err);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch {}
    }
  }, []);

  // Re-acquire Wake Lock on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (isKioskMode || isRunning)) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock, isKioskMode, isRunning]);

  // Handle Idle Dimming for Kiosk Burn-in Protection
  const resetIdleTimer = useCallback(() => {
    setIsDimmed(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (isKioskMode) {
      idleTimerRef.current = setTimeout(() => {
        setIsDimmed(true);
      }, 60000); // 1 minute idle
    }
  }, [isKioskMode]);

  useEffect(() => {
    window.addEventListener('pointerdown', resetIdleTimer);
    resetIdleTimer();
    return () => {
      window.removeEventListener('pointerdown', resetIdleTimer);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  // Session reset event handler
  const handleSessionReset = useCallback(() => {
    setScore(0);
    setLevel('LOW');
    setStage(0);
    setMaxStage(0);
    setLastTranscript('');
    setLastAdvice('');
    setLastTrigger('');
    setIsHighTakeover(false);
    speech.stop();
  }, []);

  // Server risk message handler
  const handleRiskUpdate = useCallback((data: LiveWsServerRiskMessage) => {
    resetIdleTimer(); // Wake up screen on incoming speech
    setScore(data.risk_score);
    setLevel(data.risk_level);
    setStage(data.stage);
    setMaxStage((prev) => (data.stage > prev ? data.stage : prev));
    setLastAdvice(data.advice || '');
    setLastTrigger(data.trigger_phrase || '');
    if (data.transcript_tail) {
      setLastTranscript(data.transcript_tail);
    }

    if (data.risk_level === 'HIGH') {
      setIsHighTakeover(true);
      if (speakEnabled) {
        speech.speak(data.speak, lang);
      }
    }
  }, [resetIdleTimer, speakEnabled, lang]);

  // Start Guard Action
  const startGuard = useCallback((audioTrack?: MediaStreamTrack) => {
    speech.warmUp();
    acquireWakeLock();

    const controller = startLiveGuard(lang, isKioskMode ? 'kiosk' : 'manual', {
      allowCloudFallback,
      audioTrack,
      onSpeechError: (err) => audioTrack && setTestError(err),
      onSpeechMode: (m) => setShowCloudOptInNotice(m === 'blocked'),
      onRisk: handleRiskUpdate,
      onReset: handleSessionReset,
      onStatus: (st) => {
        if (st === 'listening') {
          setStatus('listening');
        } else if (st === 'checking') {
          setStatus('checking');
        } else if (st === 'connected') {
          setStatus('connected');
        } else if (st === 'reconnecting') {
          setStatus('reconnecting');
        } else if (st === 'disconnected') {
          setStatus('idle');
        }
      },
      onTranscript: (text) => {
        resetIdleTimer();
        setLastTranscript(text);
      },
      onError: (err) => {
        console.warn('LiveGuard error:', err);
      },
    });

    guardControllerRef.current = controller;
    setIsRunning(true);
    setIsPaused(false);

  }, [acquireWakeLock, lang, isKioskMode, allowCloudFallback, handleRiskUpdate, handleSessionReset, resetIdleTimer]);

  // ---- Test tools: a recorded call (file) or typed lines instead of the microphone ----
  const [testLine, setTestLine] = useState('');
  const [testFileName, setTestFileName] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testSourceRef = useRef<FileAudioSource | null>(null);

  const sendTestLine = () => {
    if (!guardControllerRef.current || !testLine.trim()) return;
    guardControllerRef.current.sendLine(testLine);
    setLastTranscript(testLine.trim());
    setTestLine('');
  };

  const playTestFile = async (file: File) => {
    setTestError(null);
    testSourceRef.current?.stop();
    if (guardControllerRef.current) guardControllerRef.current.stop();
    try {
      const source = await audioFileSource(file);
      testSourceRef.current = source;
      setTestFileName(file.name);
      startGuard(source.track);
      source.ended.then(() => {
        setTestFileName(null);
        // let the recognizer flush its last phrase, then go back to the microphone
        setTimeout(() => {
          if (testSourceRef.current !== source) return;
          source.stop();
          testSourceRef.current = null;
          if (guardControllerRef.current) guardControllerRef.current.stop();
          startGuard();
        }, 4000);
      });
    } catch (e) {
      setTestError(String(e));
    }
  };

  // Stop Guard Action
  const stopGuard = useCallback(() => {
    speech.stop();
    releaseWakeLock();
    if (guardControllerRef.current) {
      guardControllerRef.current.stop();
      guardControllerRef.current = null;
    }
    setIsRunning(false);
    setIsPaused(false);
    setStatus('idle');
  }, [releaseWakeLock]);

  // Pause for 30 minutes
  const togglePause = useCallback(() => {
    if (!guardControllerRef.current) return;
    if (isPaused) {
      guardControllerRef.current.resume();
      setIsPaused(false);
      setStatus('listening');
    } else {
      guardControllerRef.current.pause(30 * 60 * 1000);
      setIsPaused(true);
      setStatus('idle');
    }
  }, [isPaused]);

  // "I am safe now" click handler - guarantees all spoken alerts and vibrations cease immediately
  const handleSafeTap = useCallback(() => {
    setIsHighTakeover(false);
    speech.stop();
    if (typeof window !== 'undefined') {
      try {
        window.speechSynthesis?.cancel();
        if ('vibrate' in navigator) {
          navigator.vibrate(0);
        }
      } catch {}
    }
    if (guardControllerRef.current) {
      // Contract: Send { type: "reset" } when user taps "I am safe now"
      guardControllerRef.current.reset();
    }
    // Set level to caution/medium until the server emits session_reset
    setLevel('MEDIUM');
    setScore(45);
  }, []);

  // Kiosk Auto-start on mount if already authorized once
  useEffect(() => {
    if (isKioskMode && kioskStartedOnce && !isRunning) {
      startGuard();
    }
    return () => {
      if (isRunning) {
        stopGuard();
      }
    };
  }, [isKioskMode, kioskStartedOnce]);

  // Triple-tap clock for hidden debug overlay (Follow-up 2)
  const handleClockTap = () => {
    clockTapCountRef.current++;
    if (clockTapTimerRef.current) clearTimeout(clockTapTimerRef.current);
    if (clockTapCountRef.current >= 3) {
      setShowDebugOverlay((prev) => !prev);
      clockTapCountRef.current = 0;
    } else {
      clockTapTimerRef.current = setTimeout(() => {
        clockTapCountRef.current = 0;
      }, 700);
    }
  };

  // Demo Action Event Listener (Triggers instant simulation from Demo Helper Modal)
  useEffect(() => {
    const handleDemoAction = (e: any) => {
      const action = e.detail?.action;
      if (action === 'high_risk') {
        speech.warmUp();
        if (!isRunning) {
          startGuard();
        }
        const sampleText = t('live.demo_sample_text');
        const sampleAdvice = t('live.demo_sample_advice');
        const sampleTrigger = t('live.demo_sample_trigger');
        const sampleSpeak = t('live.demo_sample_speak');

        setScore(96);
        setLevel('HIGH');
        setStage(5);
        setMaxStage(5);
        setLastTranscript(sampleText);
        setLastAdvice(sampleAdvice);
        setLastTrigger(sampleTrigger);
        setIsHighTakeover(true);
        if (speakEnabled) {
          speech.speak(sampleSpeak, lang);
        }
      } else if (action === 'reset') {
        handleSessionReset();
      }
    };

    window.addEventListener('sagi-demo-action', handleDemoAction);
    return () => window.removeEventListener('sagi-demo-action', handleDemoAction);
  }, [isRunning, startGuard, lang, speakEnabled, handleSessionReset, t]);

  return (
    <div
      id="live-guard-container"
      className={`min-h-[calc(100vh-80px)] w-full transition-all duration-700 ${
        isDimmed ? 'opacity-40 brightness-75 bg-slate-950 text-slate-300' : ''
      }`}
    >
      {/* FULL-SCREEN RED TAKEOVER ON HIGH RISK */}
      {isHighTakeover && (
        <HighRiskTakeover
          onSafeTap={handleSafeTap}
          advice={lastAdvice}
          triggerPhrase={lastTrigger}
        />
      )}

      {/* Main Guard Layout */}
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6 space-y-5">
        {/* Kiosk Mode Banner / Clock Header */}
        {isKioskMode ? (
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-5 rounded-3xl bg-white/90 dark:bg-slate-900/90 border-2 border-emerald-700/40 shadow-sm backdrop-blur">
            <div className="flex items-center gap-3">
              <div
                className={`w-3.5 h-3.5 rounded-full ${
                  status === 'listening' || status === 'checking'
                    ? 'bg-emerald-500 animate-ping'
                    : status === 'reconnecting'
                    ? 'bg-gray-400'
                    : 'bg-emerald-600'
                }`}
              />
              <div>
                <div className="text-base sm:text-lg font-black text-gray-900 dark:text-white">
                  {t('live.status_connected')}
                </div>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {t('live.mode_kiosk')}
                </div>
              </div>
            </div>

            {/* Large Clock (Triple tap opens debug overlay) */}
            <div
              id="kiosk-clock"
              onClick={handleClockTap}
              className="mt-2 sm:mt-0 font-mono text-3xl sm:text-4xl font-black text-[#1B4D3E] dark:text-emerald-400 cursor-pointer select-none px-3 py-1 rounded-xl hover:bg-emerald-50 dark:hover:bg-slate-800 transition"
              title={t('live.debug_clock_hint')}
            >
              {currentTime}
            </div>

            {/* Pause 30 min button */}
            {isRunning && (
              <button
                id="kiosk-pause-btn"
                onClick={togglePause}
                className={`mt-2 sm:mt-0 px-4 py-2 rounded-xl text-sm font-bold border flex items-center gap-2 transition ${
                  isPaused
                    ? 'bg-amber-100 dark:bg-amber-950 border-amber-400 text-amber-900 dark:text-amber-200'
                    : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                <span>{isPaused ? t('live.btn_paused') : t('live.btn_pause_30')}</span>
              </button>
            )}
          </div>
        ) : (
          /* Manual Mode Instruction Card */
          <div className="p-4 sm:p-5 rounded-3xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 shadow-sm">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-2xl bg-[#1B4D3E] text-white flex-shrink-0 mt-0.5">
                <Volume2 className="w-6 h-6 text-yellow-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t('live.instruction_title')}
                </h2>
                <p className="mt-1 text-sm sm:text-base text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                  {t('live.instruction_desc')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* First-time Kiosk Mode Setup Tap */}
        {isKioskMode && !kioskStartedOnce && !isRunning && (
          <div className="p-8 text-center rounded-3xl bg-emerald-700 text-white shadow-xl space-y-4">
            <Shield className="w-16 h-16 mx-auto text-yellow-300 animate-bounce" />
            <h2 className="text-2xl sm:text-3xl font-black">
              {t('live.kiosk_tap_start')}
            </h2>
            <p className="text-emerald-100 max-w-md mx-auto text-sm sm:text-base">
              {t('live.kiosk_first_desc')}
            </p>
            <button
              id="kiosk-first-start-btn"
              onClick={() => {
                setKioskStartedOnce(true);
                try {
                  localStorage.setItem('sagi_kiosk_initialized', 'true');
                } catch {}
                startGuard();
              }}
              className="w-full max-w-sm min-h-[64px] rounded-2xl bg-white text-[#143C30] font-black text-xl shadow-lg hover:bg-emerald-50 active:scale-95 transition"
            >
              {t('live.kiosk_tap_start')}
            </button>
          </div>
        )}

        {/* On-Device Speech Recognition Status & Setup Banner */}
        <div
          id="on-device-status-banner"
          className={`p-3.5 sm:p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            speechDetails?.status === 'ready'
              ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`p-2 rounded-xl flex-shrink-0 mt-0.5 ${
                speechDetails?.status === 'ready'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-500 text-white'
              }`}
            >
              {speechDetails?.status === 'ready' ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <Cpu className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-2">
                <span>
                  {speechDetails?.status === 'ready'
                    ? t('live.ondevice_badge_ready')
                    : t('live.ondevice_badge_need_pack')}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/10 dark:bg-white/10">
                  {speechDetails?.languageName || (lang === 'vi' ? t('settings.lang_vi') : lang === 'en' ? t('settings.lang_en') : t('settings.lang_ja'))}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                {speechDetails?.status === 'ready'
                  ? t('live.ondevice_ready_desc')
                  : t('live.ondevice_need_pack_desc')}
              </p>
            </div>
          </div>

          <button
            id="open-speech-setup-btn"
            onClick={() => {
              speech.warmUp();
              setIsSetupModalOpen(true);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 flex-shrink-0 shadow-xs transition ${
              speechDetails?.status === 'ready'
                ? 'bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100/50'
                : 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            <span>{t('live.ondevice_setup_btn')}</span>
          </button>
        </div>

        {/* State Indicator Banner: "listening (on this device)" vs "text being checked" */}
        <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-3 h-3 rounded-full ${
                status === 'checking'
                  ? 'bg-amber-500 animate-ping'
                  : status === 'listening'
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <span className="text-sm sm:text-base font-bold text-gray-800 dark:text-gray-200">
              {status === 'checking'
                ? t('live.status_checking')
                : status === 'listening'
                ? t('live.status_listening')
                : isPaused
                ? t('live.btn_paused')
                : t('live.status_idle')}
            </span>
          </div>

          <div className="text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg">
            {t('live.ondevice_privacy')}
          </div>
        </div>

        {/* Local STT notice if on-device model not available */}
        {showCloudOptInNotice && !allowCloudFallback && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm flex items-start gap-3">
            <Info className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{t('live.local_stt_notice')}</p>
              <button
                onClick={() => {
                  setAllowCloudFallback(true);
                  setShowCloudOptInNotice(false);
                }}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs hover:bg-amber-700"
              >
                {t('live.local_stt_optin')}
              </button>
            </div>
          </div>
        )}

        {/* TEST TOOLS: feed a recorded call or typed lines through the same pipeline as the microphone */}
        <details className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/60 dark:bg-slate-900/60 p-3 text-sm">
          <summary className="cursor-pointer font-bold text-gray-700 dark:text-gray-200">{t('live.test_title')}</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('live.test_desc')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="live-test-audio"
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) playTestFile(f);
                  e.target.value = '';
                }}
                className="text-xs"
              />
              {testFileName && (
                <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300">▶ {testFileName}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                id="live-test-line"
                type="text"
                value={testLine}
                onChange={(e) => setTestLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendTestLine();
                }}
                placeholder={t('live.test_line_placeholder')}
                className="flex-1 p-2 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-sm"
              />
              <button
                onClick={sendTestLine}
                disabled={!isRunning || !testLine.trim()}
                className="px-3 py-2 rounded-xl bg-[#1B4D3E] text-white text-xs font-bold disabled:bg-gray-300"
              >
                {t('live.test_send')}
              </button>
            </div>
            {testError && <p className="text-xs font-semibold text-red-600">{testError}</p>}
          </div>
        </details>

        {/* Circular Risk Meter (0 - 100) */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-3xl p-4 sm:p-6 border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col items-center">
          <RiskMeter score={score} level={level} size={220} showDetails={true} />

          {/* Advice excerpt */}
          {lastAdvice && (
            <div className="mt-3 text-center text-sm sm:text-base font-bold text-gray-700 dark:text-gray-300 max-w-md bg-gray-50 dark:bg-gray-800/60 px-4 py-2 rounded-xl">
              {lastAdvice}
            </div>
          )}
        </div>

        {/* Kill-Chain Progress Bar (5 Steps: Authority → Threat → Secrecy → Move to app → Money) */}
        <KillChainBar currentStage={stage} maxReachedStage={maxStage} />

        {/* Last Transcript Line */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">
            {t('live.last_transcript')}
          </span>
          <p className="text-sm sm:text-base font-mono text-gray-700 dark:text-gray-300 italic min-h-[24px]">
            {lastTranscript ? `"${lastTranscript}"` : t('live.no_transcript_yet')}
          </p>
        </div>

        {/* Manual Mode Big Start / Stop Button */}
        {!isKioskMode && (
          <div className="pt-2">
            {!isRunning ? (
              <button
                id="manual-start-guard-btn"
                onClick={() => startGuard()}
                className="w-full min-h-[72px] rounded-3xl bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white text-xl sm:text-2xl font-black shadow-xl flex items-center justify-center gap-3 transition"
              >
                <Mic className="w-7 h-7 text-yellow-300 animate-pulse" />
                <span>{t('live.btn_start')}</span>
              </button>
            ) : (
              <button
                id="manual-stop-guard-btn"
                onClick={stopGuard}
                className="w-full min-h-[72px] rounded-3xl bg-gray-700 hover:bg-gray-800 active:scale-98 text-white text-xl sm:text-2xl font-black shadow-xl flex items-center justify-center gap-3 transition"
              >
                <MicOff className="w-7 h-7 text-red-400" />
                <span>{t('live.btn_stop')}</span>
              </button>
            )}
          </div>
        )}

        {/* Quick Demo Simulator & Trigger Bar */}
        <div
          id="live-demo-scenario-bar"
          className="p-3.5 sm:p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/80 shadow-xs"
        >
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-950 dark:text-amber-200 uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>{t('live.demo_panel_title')}</span>
            </div>
            <span className="text-[11px] text-amber-800/80 dark:text-amber-300">
              {t('live.demo_panel_hint')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              id="btn-live-test-high"
              type="button"
              onClick={() => {
                speech.warmUp();
                window.dispatchEvent(
                  new CustomEvent('sagi-demo-action', { detail: { action: 'high_risk' } })
                );
              }}
              className="px-3.5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{t('live.demo_btn_high')}</span>
            </button>

            <button
              id="btn-live-test-reset"
              type="button"
              onClick={() => {
                speech.warmUp();
                window.dispatchEvent(
                  new CustomEvent('sagi-demo-action', { detail: { action: 'reset' } })
                );
              }}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{t('live.demo_btn_reset')}</span>
            </button>
          </div>
        </div>

        {/* Privacy rule permanent notice */}
        <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-2 pb-4">
          {t('live.privacy_line')}
        </div>
      </div>

      {/* Hidden Debug Overlay (Triple-tap clock to toggle) */}
      {showDebugOverlay && (
        <div className="fixed bottom-20 right-4 z-40 p-4 rounded-2xl bg-black/90 text-green-400 font-mono text-xs max-w-xs shadow-2xl border border-green-600">
          <div className="flex justify-between items-center pb-2 border-b border-green-800 font-bold">
            <span>{t('live.debug_title')}</span>
            <button onClick={() => setShowDebugOverlay(false)} className="text-white" aria-label={t('common.close')}>✕</button>
          </div>
          <div className="mt-2 space-y-1">
            <div>{t('live.debug_status')}: {status}</div>
            <div>{t('live.debug_score')}: {score} | {t('live.debug_level')}: {level}</div>
            <div>{t('live.debug_stage')}: {stage} / {t('live.debug_max')}: {maxStage}</div>
            <div>{t('live.debug_wakelock')}: {wakeLockRef.current ? t('live.debug_active') : t('live.debug_inactive')}</div>
            <div>{t('live.debug_trigger')}: {lastTrigger || t('live.debug_none')}</div>
            <div className="truncate">{t('live.debug_last_msg')}: {lastTranscript || t('live.debug_none')}</div>
          </div>
        </div>
      )}
      {/* On-Device Speech Recognition Setup Modal */}
      <OnDeviceSpeechSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        onSetupCompleted={() => {
          refreshSpeechStatus();
          // If in manual mode, user can now start guard
        }}
        allowCloudFallback={allowCloudFallback}
        onToggleCloudFallback={(enabled) => setAllowCloudFallback(enabled)}
      />
    </div>
  );
};
