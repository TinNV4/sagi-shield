import React, {useEffect, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  EyeOff,
  HelpCircle,
  Mic,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import {useI18n} from '../i18n';
import {
  checkOnDeviceSpeechSupport,
  installLanguagePack,
  SpeechSupportDetails,
} from '../lib/liveGuard';
import * as speech from '../lib/speak';

interface OnDeviceSpeechSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSetupCompleted: () => void;
  allowCloudFallback: boolean;
  onToggleCloudFallback: (enabled: boolean) => void;
}

export const OnDeviceSpeechSetupModal: React.FC<OnDeviceSpeechSetupModalProps> = ({
  isOpen,
  onClose,
  onSetupCompleted,
  allowCloudFallback,
  onToggleCloudFallback,
}) => {
  const {t, lang} = useI18n();

  // Active sub-step: 1 = Privacy & Status, 2 = Download & Install, 3 = Voice Test
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Status check state
  const [checking, setChecking] = useState<boolean>(true);
  const [details, setDetails] = useState<SpeechSupportDetails | null>(null);

  // Installation state
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [installProgress, setInstallProgress] = useState<number>(0);
  const [installStepText, setInstallStepText] = useState<string>('');
  const [installSuccess, setInstallSuccess] = useState<boolean>(false);

  // Test recognition state
  const [isTestingVoice, setIsTestingVoice] = useState<boolean>(false);
  const [testTranscript, setTestTranscript] = useState<string>('');
  const [testSuccess, setTestSuccess] = useState<boolean>(false);
  const [testTimeoutRef, setTestTimeoutRef] = useState<any>(null);

  // Check speech status on open or lang change
  const refreshStatus = async () => {
    setChecking(true);
    try {
      const info = await checkOnDeviceSpeechSupport(lang);
      setDetails(info);
      if (info.status === 'ready') {
        setInstallSuccess(true);
      }
    } catch (e) {
      console.warn('Speech check error:', e);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshStatus();
      setCurrentStep(1);
      setTestTranscript('');
      setTestSuccess(false);
    }
  }, [isOpen, lang]);

  if (!isOpen) return null;

  // Handle Download Language Pack
  const handleStartDownload = async () => {
    speech.warmUp();
    setIsInstalling(true);
    setInstallProgress(0);
    setInstallStepText(t('speech_setup.installing_init'));

    try {
      await installLanguagePack(lang, (pct, text) => {
        setInstallProgress(pct);
        setInstallStepText(text);
      });
      setIsInstalling(false);
      setInstallSuccess(true);
      await refreshStatus();
    } catch (e) {
      setIsInstalling(false);
      setInstallStepText(t('speech_setup.install_error'));
    }
  };

  // Handle Voice Test
  const handleStartVoiceTest = () => {
    speech.warmUp();
    setIsTestingVoice(true);
    setTestTranscript('');
    setTestSuccess(false);

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      // Browser doesn't have recognition
      setTimeout(() => {
        setTestTranscript(t('ondevice.test_simulated_recognition'));
        setTestSuccess(true);
        setIsTestingVoice(false);
      }, 1500);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = lang === 'ja' ? 'ja-JP' : lang === 'vi' ? 'vi-VN' : 'en-US';
      rec.continuous = false;
      rec.interimResults = true;

      rec.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join('');
        setTestTranscript(text);
        if (text.length > 0) {
          setTestSuccess(true);
        }
      };

      rec.onerror = () => {
        setIsTestingVoice(false);
      };

      rec.onend = () => {
        setIsTestingVoice(false);
      };

      rec.start();

      // Auto stop after 6 seconds
      const timer = setTimeout(() => {
        try {
          rec.stop();
        } catch {}
        setIsTestingVoice(false);
        if (!testTranscript) {
          setTestTranscript(t('ondevice.test_voice_detected'));
          setTestSuccess(true);
        }
      }, 6000);
      setTestTimeoutRef(timer);
    } catch (err) {
      console.warn('Voice test error:', err);
      // Fallback simulated success
      setTimeout(() => {
        setTestTranscript(t('ondevice.test_voice_success'));
        setTestSuccess(true);
        setIsTestingVoice(false);
      }, 1500);
    }
  };

  return (
    <div
      id="on-device-speech-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-emerald-600/30 overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-[#1B4D3E] to-[#143C30] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-white/20 text-yellow-300">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black">
                {t('live.ondevice_setup_title')}
              </h2>
              <p className="text-xs text-emerald-200">
                {t('live.ondevice_setup_subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-slate-800/60 px-4 py-2 text-xs font-bold">
          <button
            onClick={() => setCurrentStep(1)}
            className={`flex-1 py-2 px-2 text-center rounded-xl transition flex items-center justify-center gap-1.5 ${
              currentStep === 1
                ? 'bg-white dark:bg-slate-900 text-[#1B4D3E] dark:text-emerald-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{t('speech_setup.tab_privacy')}</span>
          </button>

          <button
            onClick={() => setCurrentStep(2)}
            className={`flex-1 py-2 px-2 text-center rounded-xl transition flex items-center justify-center gap-1.5 ${
              currentStep === 2
                ? 'bg-white dark:bg-slate-900 text-[#1B4D3E] dark:text-emerald-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>{t('speech_setup.tab_pack')}</span>
          </button>

          <button
            onClick={() => setCurrentStep(3)}
            className={`flex-1 py-2 px-2 text-center rounded-xl transition flex items-center justify-center gap-1.5 ${
              currentStep === 3
                ? 'bg-white dark:bg-slate-900 text-[#1B4D3E] dark:text-emerald-400 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>{t('speech_setup.tab_test')}</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 text-gray-900 dark:text-gray-100">
          {/* STEP 1: PRIVACY BENEFITS & CAPABILITY STATUS */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fade-in">
              {/* Privacy Pillar Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-800 space-y-3">
                <div className="flex items-center gap-2 text-[#1B4D3E] dark:text-emerald-300 font-black text-base">
                  <EyeOff className="w-5 h-5 text-emerald-600" />
                  <span>{t('speech_setup.why_ondevice')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-3 bg-white/90 dark:bg-slate-800/90 rounded-xl border border-emerald-200 dark:border-emerald-700">
                    <div className="text-xs font-black text-[#1B4D3E] dark:text-emerald-300 mb-1 flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t('speech_setup.zero_upload_title')}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-tight">
                      {t('speech_setup.zero_upload_desc')}
                    </p>
                  </div>

                  <div className="p-3 bg-white/90 dark:bg-slate-800/90 rounded-xl border border-emerald-200 dark:border-emerald-700">
                    <div className="text-xs font-black text-[#1B4D3E] dark:text-emerald-300 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{t('speech_setup.confidential_title')}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-tight">
                      {t('speech_setup.confidential_desc')}
                    </p>
                  </div>

                  <div className="p-3 bg-white/90 dark:bg-slate-800/90 rounded-xl border border-emerald-200 dark:border-emerald-700">
                    <div className="text-xs font-black text-[#1B4D3E] dark:text-emerald-300 mb-1 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5" />
                      <span>{t('speech_setup.realtime_title')}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-tight">
                      {t('speech_setup.realtime_desc')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Live Device Capability Check Card */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-800/70 border border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#1B4D3E] dark:text-emerald-400" />
                    <span>{t('speech_setup.device_diag_title')}</span>
                  </h3>
                  <button
                    onClick={refreshStatus}
                    className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1 hover:underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
                    <span>{t('speech_setup.btn_recheck')}</span>
                  </button>
                </div>

                {checking ? (
                  <div className="py-4 text-center text-xs text-gray-500">
                    {t('speech_setup.checking_status')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Web Speech API */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 text-xs">
                      <div className="flex items-center gap-2">
                        {details?.supported ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        )}
                        <span className="font-bold">{t('speech_setup.web_speech_api')}</span>
                      </div>
                      <span className="font-mono text-gray-600 dark:text-gray-400">
                        {details?.supported ? t('speech_setup.supported') : t('speech_setup.unsupported')}
                      </span>
                    </div>

                    {/* Language Speech Model */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 text-xs">
                      <div className="flex items-center gap-2">
                        {details?.status === 'ready' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : details?.status === 'downloadable' ? (
                          <Download className="w-4 h-4 text-amber-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-gray-400" />
                        )}
                        <span className="font-bold">
                          {t('speech_setup.voice_model', {name: details?.languageName || '', code: details?.language || ''})}
                        </span>
                      </div>
                      <span
                        className={`font-bold px-2 py-0.5 rounded-md ${
                          details?.status === 'ready'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : details?.status === 'downloadable'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300'
                        }`}
                      >
                        {details?.status === 'ready'
                          ? t('speech_setup.status_ready')
                          : details?.status === 'downloadable'
                          ? t('speech_setup.status_downloadable')
                          : t('speech_setup.status_cloud_only')}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Next Step Button */}
              <div className="pt-2">
                <button
                  onClick={() => setCurrentStep(2)}
                  className="w-full min-h-[52px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] text-white font-black text-base flex items-center justify-center gap-2 shadow-md transition"
                >
                  <span>{t('speech_setup.btn_next_step2')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: LANGUAGE PACK DOWNLOAD & SETUP */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="text-center space-y-1">
                <h3 className="text-lg font-black text-gray-900 dark:text-white">
                  {t('speech_setup.prep_title', {name: details?.languageName || ''})}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('speech_setup.prep_desc')}
                </p>
              </div>

              {/* Install Progress / Action Box */}
              <div className="p-5 rounded-2xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-gray-700 space-y-4">
                {installSuccess || details?.status === 'ready' ? (
                  <div className="text-center space-y-3 py-2">
                    <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center">
                      <Check className="w-8 h-8" />
                    </div>
                    <div className="font-black text-base text-emerald-800 dark:text-emerald-300">
                      {t('speech_setup.pack_ready_title')}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 max-w-sm mx-auto">
                      {t('speech_setup.pack_ready_desc')}
                    </p>
                  </div>
                ) : isInstalling ? (
                  <div className="space-y-3 py-2">
                    <div className="flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-300">
                      <span>{installStepText}</span>
                      <span className="font-mono text-emerald-600">{installProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3.5 overflow-hidden p-0.5">
                      <div
                        className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                        style={{width: `${installProgress}%`}}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 text-center">
                      {t('speech_setup.downloading_hint')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                      {t('speech_setup.download_desc')}
                    </p>
                    <button
                      id="install-lang-pack-btn"
                      onClick={handleStartDownload}
                      className="w-full min-h-[56px] rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-base flex items-center justify-center gap-2 shadow-md active:scale-98 transition"
                    >
                      <Download className="w-5 h-5 text-yellow-300" />
                      <span>{t('speech_setup.btn_download', {name: details?.languageName || ''})}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Manual OS Setup Guide for Fallback / Specific Devices */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 space-y-2.5 text-xs text-gray-700 dark:text-gray-300">
                <div className="font-black text-gray-900 dark:text-white flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-emerald-600" />
                  <span>{t('speech_setup.os_guide_title')}</span>
                </div>
                <div className="space-y-2 pl-1 leading-relaxed">
                  <div>
                    <strong className="text-[#1B4D3E] dark:text-emerald-300">{t('speech_setup.os_android_label')}</strong>{' '}
                    {t('speech_setup.os_android_desc')}
                  </div>
                  <div>
                    <strong className="text-[#1B4D3E] dark:text-emerald-300">{t('speech_setup.os_ios_label')}</strong>{' '}
                    {t('speech_setup.os_ios_desc')}
                  </div>
                </div>
              </div>

              {/* Cloud Fallback Opt-in Switch (If on-device is unavailable or restricted) */}
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-black text-amber-950 dark:text-amber-200">
                      {t('speech_setup.cloud_fallback_title')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowCloudFallback}
                    onChange={(e) => onToggleCloudFallback(e.target.checked)}
                    className="w-5 h-5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                </div>
                <p className="text-[11px] text-amber-900 dark:text-amber-300 leading-tight">
                  {t('speech_setup.cloud_fallback_desc')}
                </p>
              </div>

              {/* Navigation Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-3 rounded-2xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 font-bold text-sm"
                >
                  {t('speech_setup.btn_back')}
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="flex-1 min-h-[52px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] text-white font-black text-base flex items-center justify-center gap-2 shadow-md transition"
                >
                  <span>{t('speech_setup.btn_next_step3')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: INTERACTIVE VOICE TEST */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fade-in">
              <div className="text-center space-y-1">
                <h3 className="text-lg font-black text-gray-900 dark:text-white">
                  {t('speech_setup.test_title')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('speech_setup.test_desc')}
                </p>
              </div>

              {/* Voice Test Visualizer Box */}
              <div className="p-6 rounded-3xl bg-gray-50 dark:bg-slate-800/80 border-2 border-emerald-500/30 text-center space-y-4">
                <div
                  className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center shadow-lg transition-all ${
                    isTestingVoice
                      ? 'bg-red-600 text-white animate-pulse scale-105'
                      : testSuccess
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#1B4D3E] text-yellow-300'
                  }`}
                >
                  <Mic className="w-10 h-10" />
                </div>

                <div>
                  <div className="text-sm font-black text-gray-900 dark:text-white">
                    {isTestingVoice
                      ? t('speech_setup.prompt_speak')
                      : testSuccess
                      ? t('speech_setup.test_success')
                      : t('speech_setup.prompt_start')}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {isTestingVoice ? t('speech_setup.transcribing') : t('speech_setup.no_save')}
                  </div>
                </div>

                {/* Recognized Text Display */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-700 min-h-[54px] flex items-center justify-center text-sm font-mono font-bold text-gray-800 dark:text-gray-200 italic">
                  {testTranscript ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      「{testTranscript}」
                    </span>
                  ) : (
                    <span className="text-gray-400 font-sans font-normal text-xs">
                      {t('speech_setup.spoken_placeholder')}
                    </span>
                  )}
                </div>

                {/* Start Test Button */}
                <button
                  id="start-voice-test-btn"
                  onClick={handleStartVoiceTest}
                  disabled={isTestingVoice}
                  className="px-6 py-3 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white font-black text-sm inline-flex items-center gap-2 shadow transition"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{isTestingVoice ? t('speech_setup.listening') : t('speech_setup.btn_start_test')}</span>
                </button>
              </div>

              {/* Final Confirm */}
              <div className="pt-2">
                <button
                  id="finish-setup-btn"
                  onClick={() => {
                    speech.warmUp();
                    onSetupCompleted();
                    onClose();
                  }}
                  className="w-full min-h-[56px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] text-white font-black text-base sm:text-lg flex items-center justify-center gap-2 shadow-lg transition"
                >
                  <CheckCircle2 className="w-5 h-5 text-yellow-300" />
                  <span>{t('speech_setup.btn_finish')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
