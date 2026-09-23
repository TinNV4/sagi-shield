import React, {useEffect, useMemo, useState} from 'react';
import {
  FileText,
  Globe,
  Image,
  Mic,
  Phone,
  Search,
  Sparkles,
  Upload,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {api} from '../api/client';
import {CheckResult} from '../api/types';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

export type QuickCheckTab = 'text' | 'screenshot' | 'recording' | 'phone' | 'link';

export interface CheckInput {
  url?: string;
  text?: string;
}

interface QuickCheckScreenProps {
  onCheckCompleted: (result: CheckResult, input: CheckInput) => void;
}

export const QuickCheckScreen: React.FC<QuickCheckScreenProps> = ({onCheckCompleted}) => {
  const {t, lang} = useI18n();

  const [activeTab, setActiveTab] = useState<QuickCheckTab>('text');
  const [inputText, setInputText] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [screenshots, setScreenshots] = useState<File[]>([]); // up to MAX_SCREENSHOTS, in the order they were taken
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Sample presets for demo
  const samplePresets = [
    {
      id: 'jp-police',
      labelKey: 'quick.preset_fake_police',
      tab: 'text' as const,
      text: t('quick.sample_jp_police_text'),
      phone: '+81-50-1234-5678',
    },
    {
      id: 'jp-refund',
      labelKey: 'quick.preset_refund',
      tab: 'text' as const,
      text: t('quick.sample_jp_refund_text'),
      phone: '0120-999-888',
    },
    {
      id: 'vi-police',
      labelKey: 'quick.preset_vi_police',
      tab: 'text' as const,
      text: t('quick.sample_vi_police_text'),
      link: 'http://vneid-dichvucong.online/app-install',
    },
    {
      id: 'safe-reminder',
      labelKey: 'quick.preset_safe',
      tab: 'text' as const,
      text: t('quick.sample_safe_text'),
      phone: '03-3210-0000',
    },
  ];

  const handleApplyPreset = (preset: typeof samplePresets[0]) => {
    speech.warmUp();
    setActiveTab(preset.tab);
    setInputText(preset.text);
    if (preset.phone) setPhoneNumber(preset.phone);
    if (preset.link) setLinkUrl(preset.link);
    setErrorMsg('');
  };

  const MAX_SCREENSHOTS = 5;
  const addScreenshots = (files: FileList | null) => {
    if (!files) return;
    const next = [...screenshots, ...Array.from(files).filter((f) => f.type.startsWith('image/'))];
    setScreenshots(next.slice(0, MAX_SCREENSHOTS));
    setErrorMsg(next.length > MAX_SCREENSHOTS ? t('quick.images_limit') : '');
  };

  // Listen to the recording before / after sending it (object URL lives only in this tab)
  const audioSource = activeTab === 'recording' ? audioBlob || selectedFile : null;
  const audioPreviewUrl = useMemo(() => (audioSource ? URL.createObjectURL(audioSource) : null), [audioSource]);
  useEffect(() => () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
  }, [audioPreviewUrl]);

  const handleExecuteCheck = async () => {
    speech.warmUp();
    setErrorMsg('');

    // Validation
    if (activeTab === 'text' && !inputText.trim()) {
      setErrorMsg(t('quick.input_placeholder'));
      return;
    }
    if (activeTab === 'screenshot' && screenshots.length === 0) {
      setErrorMsg(t('quick.validation_file'));
      return;
    }
    if (activeTab === 'phone' && !phoneNumber.trim()) {
      setErrorMsg(t('quick.validation_phone'));
      return;
    }
    if (activeTab === 'link' && !linkUrl.trim()) {
      setErrorMsg(t('quick.validation_link'));
      return;
    }
    if (activeTab === 'recording' && !selectedFile && !audioBlob) {
      setErrorMsg(t('quick.validation_audio'));
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('lang', lang);

      if (activeTab === 'text') {
        formData.append('text', inputText);
      } else if (activeTab === 'phone') {
        // No filler text next to a number or a file: the server must be able to tell "nothing could be
        // analyzed" (503) from "analyzed and found nothing" - a placeholder sentence would hide the difference.
        formData.append('phone', phoneNumber);
      } else if (activeTab === 'link') {
        formData.append('url', linkUrl);
        formData.append('text', linkUrl); // lets the model reason about the domain itself
      } else if (activeTab === 'screenshot') {
        // one field per image, in order: the server reads them as one story when they belong together
        screenshots.forEach((f) => formData.append('images', f));
      } else if (activeTab === 'recording' && audioBlob) {
        formData.append('audio', audioBlob, 'recording.wav');
      } else if (activeTab === 'recording' && selectedFile) {
        formData.append('audio', selectedFile);
      }

      const result = await api.check(formData);
      setIsLoading(false);
      // what the deep check may search later: a link or the pasted text (domains only; never the number)
      onCheckCompleted(result, activeTab === 'link' ? {url: linkUrl} : activeTab === 'text' ? {text: inputText} : {});
    } catch (err: any) {
      setIsLoading(false);
      setErrorMsg(err.message || t('quick.error_general'));
    }
  };

  return (
    <div id="quick-check-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('quick.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300">
          {t('quick.subtitle')}
        </p>
      </div>

      {/* Demo Preset Buttons */}
      <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-[#1B4D3E] dark:text-emerald-300 uppercase tracking-wide">
          <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
          <span>{t('quick.presets_title')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {samplePresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleApplyPreset(preset)}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-700 text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 transition active:scale-95 shadow-2xs"
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 5 Input Tabs */}
      <div className="flex rounded-2xl bg-gray-100 dark:bg-slate-800 p-1 border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <button
          onClick={() => setActiveTab('text')}
          className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition ${
            activeTab === 'text'
              ? 'bg-white dark:bg-[#1B4D3E] text-[#1B4D3E] dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{t('quick.tab_text')}</span>
        </button>

        <button
          onClick={() => setActiveTab('screenshot')}
          className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition ${
            activeTab === 'screenshot'
              ? 'bg-white dark:bg-[#1B4D3E] text-[#1B4D3E] dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Image className="w-4 h-4" />
          <span>{t('quick.tab_screenshot')}</span>
        </button>

        <button
          onClick={() => setActiveTab('phone')}
          className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition ${
            activeTab === 'phone'
              ? 'bg-white dark:bg-[#1B4D3E] text-[#1B4D3E] dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Phone className="w-4 h-4" />
          <span>{t('quick.tab_phone')}</span>
        </button>

        <button
          onClick={() => setActiveTab('link')}
          className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition ${
            activeTab === 'link'
              ? 'bg-white dark:bg-[#1B4D3E] text-[#1B4D3E] dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>{t('quick.tab_link')}</span>
        </button>

        <button
          onClick={() => setActiveTab('recording')}
          className={`flex-1 min-w-[72px] py-2.5 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition ${
            activeTab === 'recording'
              ? 'bg-white dark:bg-[#1B4D3E] text-[#1B4D3E] dark:text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
          }`}
        >
          <Mic className="w-4 h-4" />
          <span>{t('quick.tab_recording')}</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
        {activeTab === 'text' && (
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
              {t('quick.label_text')}
            </label>
            <textarea
              id="quick-text-input"
              rows={6}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t('quick.text_placeholder')}
              className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-[#1B4D3E] focus:outline-none text-base sm:text-lg resize-none"
            />
          </div>
        )}

        {activeTab === 'screenshot' && (
          <div className="space-y-3">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('quick.label_screenshot')}
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addScreenshots(e.dataTransfer.files); }}
              className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-6 text-center hover:border-emerald-600 dark:hover:border-emerald-400 transition cursor-pointer bg-gray-50 dark:bg-slate-800/60 relative"
            >
              <input
                id="screenshot-file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => { addScreenshots(e.target.files); e.target.value = ''; }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <Upload className="w-10 h-10 mx-auto text-[#1B4D3E] dark:text-emerald-400 mb-2" />
              <div className="space-y-1">
                <div className="text-base font-bold text-gray-800 dark:text-gray-200">
                  {t('quick.image_drag_prompt')}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('quick.image_formats')}
                </div>
              </div>
            </div>
            {screenshots.length > 0 && (
              <ul id="screenshot-list" className="space-y-1">
                {screenshots.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2">
                    <span className="truncate text-emerald-700 dark:text-emerald-300 font-bold">
                      {i + 1}. {f.name} ({(f.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      type="button"
                      aria-label={t('quick.remove_image')}
                      onClick={() => setScreenshots(screenshots.filter((_, j) => j !== i))}
                      className="ml-3 text-gray-500 hover:text-red-600 font-bold"
                    >
                      ×
                    </button>
                  </li>
                ))}
                <li className="text-xs text-gray-500 dark:text-gray-400 px-1">
                  {t('quick.images_hint').replace('{n}', String(screenshots.length)).replace('{max}', String(MAX_SCREENSHOTS))}
                </li>
              </ul>
            )}
          </div>
        )}

        {activeTab === 'phone' && (
          <div className="space-y-3">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('quick.label_phone')}
            </label>
            <input
              id="quick-phone-input"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={t('quick.phone_placeholder')}
              className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-lg font-mono focus:ring-2 focus:ring-[#1B4D3E] focus:outline-none"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('quick.phone_helper')}
            </p>
          </div>
        )}

        {activeTab === 'link' && (
          <div className="space-y-3">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('quick.label_link')}
            </label>
            <input
              id="quick-link-input"
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={t('quick.url_placeholder')}
              className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-base font-mono focus:ring-2 focus:ring-[#1B4D3E] focus:outline-none"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('quick.link_helper')}
            </p>
          </div>
        )}

        {activeTab === 'recording' && (
          <div className="space-y-3">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('quick.label_recording')}
            </label>
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-6 text-center bg-gray-50 dark:bg-slate-800/60 relative">
              <input
                id="audio-file-input"
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <Mic className="w-10 h-10 mx-auto text-[#1B4D3E] dark:text-emerald-400 mb-2" />
              {selectedFile ? (
                <div className="text-emerald-700 dark:text-emerald-300 font-bold text-base">
                  {t('quick.file_selected')}{selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
                </div>
              ) : (
                <>
                  <div className="text-base font-bold text-gray-800 dark:text-gray-200">
                    {t('quick.audio_upload')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('quick.audio_formats')}
                  </div>
                </>
              )}
            </div>
            {audioPreviewUrl && (
              <audio id="audio-preview-player" controls preload="metadata" src={audioPreviewUrl} className="w-full" />
            )}
          </div>
        )}

        {/* Error message if any */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* HUGE CHECK BUTTON (WITH CALM LOADING STATE) */}
        <div className="pt-2">
          {isLoading ? (
            <div
              id="calm-loading-state"
              className="w-full min-h-[72px] rounded-2xl bg-emerald-800 text-white flex flex-col items-center justify-center p-4 shadow-lg text-center"
              role="status"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-400"></span>
                </span>
                <span className="text-lg sm:text-xl font-bold tracking-tight">
                  {t('quick.checking')}
                </span>
              </div>
              <span className="text-xs text-emerald-200 mt-1">
                {t('quick.checking_subtext')}
              </span>
            </div>
          ) : (
            <button
              id="execute-quick-check-btn"
              onClick={handleExecuteCheck}
              className="w-full min-h-[72px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-98 text-white text-xl sm:text-2xl font-black shadow-xl flex items-center justify-center gap-3 transition"
            >
              <Search className="w-7 h-7 text-yellow-300" />
              <span>{t('quick.btn_check')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
