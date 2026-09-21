import React, {useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileText,
  LifeBuoy,
  PhoneCall,
  Send,
  Share2,
  Sparkles,
} from 'lucide-react';
import {api} from '../api/client';
import {RecoveryChecklistItem} from '../api/types';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface ChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  time: string;
}

interface RecoveryScreenProps {
  onBack: () => void;
}

// The server owns the steps; a box the user ticked by hand stays ticked.
const mergeTicks = (prev: RecoveryChecklistItem[], next: RecoveryChecklistItem[]) =>
  next.map((item, i) => ({...item, done: item.done || !!prev[i]?.done}));

export const RecoveryScreen: React.FC<RecoveryScreenProps> = ({onBack}) => {
  const {t, lang} = useI18n();

  const [sessionId] = useState(() => crypto.randomUUID()); // the id is the only key to this chat: must be unguessable
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [draftStatement, setDraftStatement] = useState<string | null>(null);
  const [copiedStatement, setCopiedStatement] = useState(false);

  // Pinned checklist state
  const [checklist, setChecklist] = useState<RecoveryChecklistItem[]>([
    {
      step: t('recovery.checklist_step_bank'),
      done: false,
      tel: '0120-110-110',
    },
    {
      step: t('recovery.checklist_step_police'),
      done: false,
      tel: '110',
    },
    {
      step: t('recovery.checklist_step_evidence'),
      done: false,
    },
    {
      step: t('recovery.checklist_step_family'),
      done: false,
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Initial welcome on mount
  useEffect(() => {
    const initRecovery = async () => {
      setIsSending(true);
      try {
        const res = await api.recovery(sessionId, 'INIT_RECOVERY', lang);
        setIsSending(false);
        setMessages([
          {
            id: 'm-1',
            sender: 'agent',
            text: res.reply,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
          },
        ]);
        if (res.checklist) setChecklist((prev) => mergeTicks(prev, res.checklist));
        if (res.draft_statement) setDraftStatement(res.draft_statement);
      } catch (e) {
        setIsSending(false);
      }
    };
    initRecovery();
  }, [sessionId, lang]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages]);

  const handleSendMessage = async (msgText: string) => {
    const text = msgText.trim();
    if (!text || isSending) return;

    speech.warmUp();
    setInputMsg('');

    const newMsg: ChatMessage = {
      id: 'usr-' + Date.now(),
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    };

    setMessages((prev) => [...prev, newMsg]);
    setIsSending(true);

    try {
      const res = await api.recovery(sessionId, text, lang);
      setIsSending(false);
      setMessages((prev) => [
        ...prev,
        {
          id: 'agent-' + Date.now(),
          sender: 'agent',
          text: res.reply,
          time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        },
      ]);
      if (res.checklist) setChecklist((prev) => mergeTicks(prev, res.checklist));
      if (res.draft_statement) setDraftStatement(res.draft_statement);
    } catch {
      setIsSending(false);
    }
  };

  const toggleChecklistDone = (index: number) => {
    setChecklist((prev) =>
      prev.map((item, idx) => (idx === index ? {...item, done: !item.done} : item))
    );
  };

  const handleCopyStatement = () => {
    if (!draftStatement) return;
    navigator.clipboard.writeText(draftStatement);
    setCopiedStatement(true);
    setTimeout(() => setCopiedStatement(false), 2000);
  };

  const handleShareStatement = async () => {
    if (!draftStatement) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('recovery.statement_memo_title'),
          text: draftStatement,
        });
      } catch {}
    } else {
      handleCopyStatement();
    }
  };

  return (
    <div id="recovery-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('pay.back_home')}</span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs font-black">
          <LifeBuoy className="w-4 h-4" />
          <span>{t('recovery.title')}</span>
        </div>
      </div>

      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('recovery.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('recovery.subtitle')}
        </p>
      </div>

      {/* PINNED CHECKLIST ABOVE THE CHAT */}
      <div
        id="recovery-pinned-checklist"
        className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-red-200 dark:border-red-900/50 shadow-md p-4 sm:p-5 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
          <h2 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{t('recovery.checklist_title')}</span>
          </h2>
          <span className="text-xs font-bold text-gray-500 font-mono">
            {checklist.filter((c) => c.done).length} / {checklist.length} {t('recovery.btn_mark_done')}
          </span>
        </div>

        <div className="space-y-2.5">
          {checklist.map((item, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-2xl border transition flex items-start gap-3 ${
                item.done
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 text-gray-500 dark:text-gray-400 line-through'
                  : 'bg-gray-50 dark:bg-slate-800/60 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
              }`}
            >
              <input
                id={`check-step-${idx}`}
                type="checkbox"
                checked={item.done}
                onChange={() => toggleChecklistDone(idx)}
                className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 mt-0.5 cursor-pointer"
              />
              <div className="flex-1">
                <label
                  htmlFor={`check-step-${idx}`}
                  className="text-xs sm:text-sm font-bold block cursor-pointer leading-snug"
                >
                  {item.step}
                </label>
                {item.tel && (
                  <div className="mt-2">
                    <a
                      href={`tel:${item.tel}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1B4D3E] text-white text-xs font-bold shadow hover:bg-[#143C30]"
                    >
                      <PhoneCall className="w-3.5 h-3.5 text-yellow-300" />
                      <span>{t('result.hotline_call')} ({item.tel})</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DRAFT STATEMENT CARD (WHEN READY) */}
      {draftStatement && (
        <div
          id="draft-statement-card"
          className="rounded-3xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-800 p-4 sm:p-5 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span>{t('recovery.draft_title')}</span>
            </h3>
            <div className="flex gap-2">
              <button
                onClick={handleCopyStatement}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-amber-900 dark:text-amber-200 border border-amber-300 text-xs font-bold flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedStatement ? t('recovery.btn_copied') : t('recovery.btn_copy')}</span>
              </button>
              <button
                onClick={handleShareStatement}
                className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold flex items-center gap-1"
              >
                <Share2 className="w-3 h-3" />
                <span>{t('recovery.btn_share')}</span>
              </button>
            </div>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
            {t('recovery.draft_desc')}
          </p>
          <pre className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 text-xs sm:text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
            {draftStatement}
          </pre>
        </div>
      )}

      {/* CHAT WITH RECOVERY AGENT */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-sm p-4 space-y-4">
        <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${
                m.sender === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[85%] p-3.5 rounded-2xl text-sm sm:text-base font-semibold leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-[#1B4D3E] text-white rounded-br-none'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-bl-none'
                }`}
              >
                {m.text}
              </div>
              <span className="text-[10px] text-gray-400 mt-1 px-1">{m.time}</span>
            </div>
          ))}
          {isSending && (
            <div className="flex items-center gap-2 text-xs text-gray-500 italic p-2">
              <span className="animate-spin">⏳</span>
              <span>{t('quick.checking')}</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick reply chips */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1.5">
            {t('recovery.quick_reply_title')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => handleSendMessage(t('recovery.reply_bank'))}
              className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-xs font-bold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700"
            >
              {t('recovery.reply_bank')}
            </button>
            <button
              onClick={() => handleSendMessage(t('recovery.reply_cashcard'))}
              className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-xs font-bold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700"
            >
              {t('recovery.reply_cashcard')}
            </button>
            <button
              onClick={() => handleSendMessage(t('recovery.reply_emoney'))}
              className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-xs font-bold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700"
            >
              {t('recovery.reply_emoney')}
            </button>
            <button
              onClick={() => handleSendMessage(t('recovery.reply_crypto'))}
              className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950 text-xs font-bold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700"
            >
              {t('recovery.reply_crypto')}
            </button>
          </div>
        </div>

        {/* Input Bar */}
        <div className="flex gap-2 pt-1">
          <input
            id="recovery-input"
            type="text"
            value={inputMsg}
            onChange={(e) => setInputMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage(inputMsg);
            }}
            placeholder={t('recovery.input_placeholder')}
            className="flex-1 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
          />
          <button
            onClick={() => handleSendMessage(inputMsg)}
            disabled={!inputMsg.trim() || isSending}
            className="p-3 rounded-2xl bg-[#1B4D3E] text-white disabled:bg-gray-300 hover:bg-[#143C30] transition"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prominent Legal Disclaimer */}
      <div className="p-4 rounded-2xl bg-gray-100 dark:bg-slate-900 border border-gray-300 dark:border-gray-800 flex items-start gap-3 text-xs text-gray-600 dark:text-gray-400">
        <AlertCircle className="w-5 h-5 flex-shrink-0 text-gray-500 mt-0.5" />
        <p className="leading-relaxed">
          {t('recovery.disclaimer')}
        </p>
      </div>
    </div>
  );
};
