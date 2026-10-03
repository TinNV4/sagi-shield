import React, {useEffect, useState} from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle,
  Globe2,
  Lock,
  MapPin,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {api} from '../api/client';
import {StatsResult} from '../api/types';
import {useI18n} from '../i18n';

export const CommunityScreen: React.FC = () => {
  const {t} = useI18n();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await api.getStats();
        setStats(data);
      } catch (err) {
        console.warn('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  if (loading || !stats) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-500 animate-fade-in">
        <div className="animate-spin text-3xl mb-3">📊</div>
        <p className="font-bold text-base">{t('community.loading')}</p>
      </div>
    );
  }

  // Format data for BarChart
  const scamTypeData = [
    {name: t('community.scam_fake_police'), count: stats.by_type.fake_police, fill: '#C62828'},
    {name: t('community.scam_refund'), count: stats.by_type.refund, fill: '#D97706'},
    {name: t('community.scam_family'), count: stats.by_type.family_impersonation, fill: '#F59E0B'},
    {name: t('community.scam_fake_billing'), count: stats.by_type.fake_billing, fill: '#6B7280'},
    {name: t('community.scam_investment'), count: stats.by_type.investment, fill: '#3B82F6'},
  ];

  const highRiskPct = stats.total_checks ? ((stats.high_risk / stats.total_checks) * 100).toFixed(1) : '0.0';
  // Computed from the data shown, never a fixed claim
  const totalReports = Object.values(stats.by_type).reduce((a, b) => a + b, 0);
  const topType = scamTypeData.reduce((a, b) => ((b.count || 0) > (a.count || 0) ? b : a), scamTypeData[0]);
  const topTypePct = totalReports && topType.count ? Math.round((topType.count / totalReports) * 100) : 0;
  const regions = Object.entries(stats.by_region).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div id="community-dashboard" className="max-w-3xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-[#1B4D3E] dark:text-emerald-300 text-xs font-bold uppercase tracking-wider mb-2">
          <Globe2 className="w-3.5 h-3.5" />
          <span>{t('community.network_badge')}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
          {t('community.title')}
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
          {t('community.subtitle')}
        </p>
      </div>

      {!!stats.simulated_reports && (
        <div
          id="community-simulated-note"
          className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-start gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t('community.simulated_note', {n: stats.simulated_reports.toLocaleString()})}</span>
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Total Checks */}
        <div className="p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {t('community.kpi_total')}
            </span>
            <Users className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white font-mono">
            {stats.total_checks.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-bold mt-1">
            {t('community.kpi_total_desc')}
          </div>
        </div>

        {/* High Risk Cases */}
        <div className="p-4 sm:p-5 rounded-3xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 shadow-xs">
          <div className="flex items-center justify-between text-red-700 dark:text-red-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {t('community.kpi_high_title')}
            </span>
            <ShieldAlert className="w-5 h-5 text-red-600" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-red-700 dark:text-red-300 font-mono">
            {stats.high_risk.toLocaleString()}
          </div>
          <div className="text-xs text-red-600 dark:text-red-400 font-bold mt-1">
            {t('community.kpi_high_desc')}
          </div>
        </div>

        {/* % High Risk */}
        <div className="p-4 sm:p-5 rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 shadow-xs">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">
              {t('community.kpi_high_pct')}
            </span>
            <TrendingUp className="w-5 h-5 text-amber-600" />
          </div>
          <div className="text-3xl sm:text-4xl font-black text-amber-700 dark:text-amber-300 font-mono">
            {highRiskPct}%
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 font-bold mt-1">
            {t('community.kpi_high_pct_desc')}
          </div>
        </div>
      </div>

      {/* 14-DAY TREND LINE CHART */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
              <span>{t('community.trend_title')}</span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('community.trend_desc')}
            </p>
          </div>
        </div>

        <div className="h-60 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.trend} margin={{top: 5, right: 10, left: -20, bottom: 5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#88888820" />
              <XAxis dataKey="date" tick={{fontSize: 11}} stroke="#88888880" />
              <YAxis tick={{fontSize: 11}} stroke="#88888880" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  border: 'none',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#1B4D3E"
                strokeWidth={3}
                dot={{r: 4, fill: '#1B4D3E'}}
                activeDot={{r: 6}}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SCAM TYPES BREAKDOWN (BAR CHART) */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#1B4D3E] dark:text-emerald-400" />
            <span>{t('community.by_type_title')}</span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {topTypePct ? t('community.by_type_desc', {type: topType.name, pct: topTypePct}) : t('community.by_type_empty')}
          </p>
        </div>

        <div className="h-64 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scamTypeData} margin={{top: 10, right: 10, left: -15, bottom: 20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#88888820" />
              <XAxis dataKey="name" tick={{fontSize: 11}} stroke="#88888880" />
              <YAxis tick={{fontSize: 11}} stroke="#88888880" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  border: 'none',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* REGIONAL HOTSPOTS (JAPAN PREFECTURES + VIETNAM PROVINCES) */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-red-500" />
            <span>{t('community.by_region_title')}</span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('community.by_region_desc')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {regions.map(([region, count]) => (
            <div
              key={region}
              className="p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-gray-700 flex flex-col justify-between"
            >
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                {region}
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-black font-mono text-[#1B4D3E] dark:text-emerald-400">
                  {count}
                </span>
                <span className="text-[10px] text-gray-400">{t('community.unit_cases')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PERMANENT ANONYMIZATION PRIVACY NOTE */}
      <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 flex items-start gap-3 text-xs text-emerald-900 dark:text-emerald-200">
        <Lock className="w-5 h-5 flex-shrink-0 text-[#1B4D3E] dark:text-emerald-400 mt-0.5" />
        <p className="leading-relaxed">
          {t('community.anonymized_note')}
        </p>
      </div>
    </div>
  );
};
