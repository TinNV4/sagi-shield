import React, {useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock,
  PhoneCall,
  RefreshCw,
  Shield,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {api, getFamilyId} from '../api/client';
import {FamilyAlertItem} from '../api/types';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

interface GuardianViewScreenProps {
  onBack: () => void;
}

export const GuardianViewScreen: React.FC<GuardianViewScreenProps> = ({onBack}) => {
  const {t} = useI18n();

  const [alerts, setAlerts] = useState<FamilyAlertItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const prevAlertCountRef = useRef<number>(0);
  const [linked, setLinked] = useState<boolean>(api.isMock || !!getFamilyId());
  const [codeInput, setCodeInput] = useState('');
  const [linkError, setLinkError] = useState(false);

  const handleLink = async () => {
    setLinkError(false);
    try {
      await api.linkFamily(codeInput);
      setLinked(true);
      fetchAlerts();
    } catch {
      setLinkError(true);
    }
  };

  const fetchAlerts = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const data = await api.getFamilyAlerts();
      // Check if new HIGH alert arrived while view was open
      if (data.length > prevAlertCountRef.current && prevAlertCountRef.current > 0) {
        const newest = data[0];
        if (newest && newest.risk_level === 'HIGH') {
          // Play sound and vibration alert
          speech.speak(t('guardian.alert_spoken'));
          if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([400, 200, 400]);
          }
        }
      }
      prevAlertCountRef.current = data.length;
      setAlerts(data);
      if (!silent) setIsRefreshing(false);
    } catch (e) {
      if (!silent) setIsRefreshing(false);
    }
  };

  // Poll every 5 seconds
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(() => {
      fetchAlerts(true);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatRelativeTime = (isoString: string) => {
    try {
      const diff = Date.now() - new Date(isoString).getTime();
      const mins = Math.floor(diff / (1000 * 60));
      if (mins < 1) return t('guardian.time_just_now');
      if (mins < 60) return t('guardian.time_mins_ago', {mins});
      const hours = Math.floor(mins / 60);
      if (hours < 24) return t('guardian.time_hours_ago', {hours});
      return t('guardian.time_days_ago', {days: Math.floor(hours / 24)});
    } catch {
      return isoString;
    }
  };

  return (
    <div id="guardian-view-screen" className="max-w-2xl mx-auto px-4 py-6 space-y-5 animate-fade-in">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('guardian.back_btn')}</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
            {t('guardian.polling_desc')}
          </span>
          <button
            onClick={() => fetchAlerts()}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500"
            title={t('guardian.manual_refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!linked && (
        <div id="guardian-link-card" className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 space-y-3">
          <label htmlFor="guardian-code-input" className="block text-base font-bold text-gray-900 dark:text-white">
            {t('guardian.link_title')}
          </label>
          <input
            id="guardian-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="123-456"
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 font-mono text-2xl tracking-widest text-center"
          />
          <button
            onClick={handleLink}
            disabled={codeInput.replace(/\D/g, '').length !== 6}
            className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold disabled:opacity-40"
          >
            {t('guardian.link_btn')}
          </button>
          {linkError && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{t('guardian.link_fail')}</p>}
        </div>
      )}

      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2.5">
          <Users className="w-7 h-7 text-[#1B4D3E] dark:text-emerald-400" />
          <span>{t('guardian.title')}</span>
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('guardian.subtitle')}
        </p>
      </div>

      {/* Alert List */}
      <div className="space-y-3.5">
        {alerts.length === 0 ? (
          <div className="p-8 text-center rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 text-gray-500">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
            <p className="font-bold text-base text-gray-800 dark:text-gray-200">
              {t('guardian.empty_title')}
            </p>
            <p className="text-xs mt-1">
              {t('guardian.empty_desc')}
            </p>
          </div>
        ) : (
          alerts.map((alert) => {
            const isHigh = alert.risk_level === 'HIGH';
            return (
              <div
                key={alert.id}
                className={`rounded-3xl p-5 border-2 shadow-sm transition space-y-3 ${
                  isHigh
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-500 text-red-950 dark:text-red-100'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-950 dark:text-amber-100'
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full font-black text-xs tracking-wider uppercase text-white shadow-xs ${
                        isHigh ? 'bg-red-600' : 'bg-amber-500'
                      }`}
                    >
                      {t('guardian.risk_badge', {level: alert.risk_level})}
                    </span>
                    <span className="text-xs font-bold opacity-75">
                      {t('guardian.stage_label', {stage: alert.stage, type: alert.scam_type})}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-xs opacity-75 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatRelativeTime(alert.created_at)}</span>
                  </div>
                </div>

                {/* Member name */}
                <div className="text-lg sm:text-xl font-black">
                  {alert.member_name}
                </div>

                {/* 2-line summary */}
                <p className="text-sm sm:text-base font-semibold leading-snug line-clamp-2 bg-white/70 dark:bg-slate-900/70 p-3 rounded-2xl border border-current/20">
                  {alert.summary}
                </p>

                {/* Big Call Now Button */}
                <div className="pt-1">
                  <a
                    href={`tel:${alert.phone_tel || '090-1234-5678'}`}
                    className="w-full min-h-[52px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-98 text-white font-bold text-base flex items-center justify-center gap-2 shadow-md transition"
                  >
                    <PhoneCall className="w-5 h-5 text-yellow-300" />
                    <span>{t('guardian.btn_call_member', {name: alert.member_name.split('（')[0]})}</span>
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
