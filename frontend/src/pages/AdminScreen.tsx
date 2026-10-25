import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, RefreshCw} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {api, ApiError} from '../api/client';
import type {AdminSummary} from '../api/types';
import {useI18n} from '../i18n';
import {adminScreenState, agreementRate, latencyLine, sectionState, type AdminSection} from '../lib/adminState';

const DAY_CHOICES = [1, 7, 30] as const;
const LEVEL_COLORS: Record<string, string> = {LOW: '#059669', MEDIUM: '#d97706', HIGH: '#dc2626'};

const Card: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => (
  <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 space-y-2">
    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h3>
    {children}
  </div>
);

/** Aggregates only: counts, rates, latency. The server never sends text, numbers or ids, and nothing here asks for them. */
export const AdminScreen: React.FC<{onBack?: () => void}> = ({onBack}) => {
  const {t} = useI18n();
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<{status: number; detail: string | null} | null>(null);

  // the selection the screen shows now: a slow answer for an earlier choice must not replace a newer one
  const wanted = useRef(days);
  wanted.current = days;

  const load = useCallback(async (d: number) => {
    setData(null);
    setError(null);
    try {
      const res = await api.adminSummary(d);
      if (d === wanted.current && res.days === d) setData(res);
    } catch (err) {
      if (d !== wanted.current) return;
      setError(err instanceof ApiError ? {status: err.status, detail: err.detail} : {status: 0, detail: null});
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const state = adminScreenState({data, error});

  const perDay = useMemo(() => {
    const byDay = new Map<string, {day: string; LOW: number; MEDIUM: number; HIGH: number}>();
    for (const v of data?.verdicts ?? []) {
      const row = byDay.get(v.day) ?? {day: v.day, LOW: 0, MEDIUM: 0, HIGH: 0};
      if (v.level === 'LOW' || v.level === 'MEDIUM' || v.level === 'HIGH') row[v.level] += v.n;
      byDay.set(v.day, row);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [data]);

  const perKindLang = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of data?.verdicts ?? []) m.set(`${v.kind}|${v.lang}`, (m.get(`${v.kind}|${v.lang}`) ?? 0) + v.n);
    return [...m.entries()].map(([k, n]) => ({kind: k.split('|')[0], lang: k.split('|')[1], n}));
  }, [data]);

  const sec = (s: AdminSection) => (data ? sectionState(data, s) : 'ok');
  const unavailableLine = <p className="text-sm text-amber-800 dark:text-amber-300">{t('admin.section_unavailable')}</p>;
  const noData = <p className="text-sm text-gray-500">{t('admin.no_data')}</p>;
  const pairTable = (rows: {key: string; n: number}[]) => (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-gray-100 dark:border-gray-800">
            <td className="py-1.5">{r.key}</td>
            <td className="py-1.5 text-right font-mono font-bold">{r.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const rate = (fb: {n: number; correct: number}) => {
    const r = agreementRate(fb);
    return r === null ? t('admin.no_answers') : `${r}% (${fb.correct}/${fb.n})`;
  };

  return (
    <div id="admin-screen" className="max-w-3xl mx-auto px-4 py-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black text-gray-900 dark:text-white">{t('admin.title')}</h2>
        {onBack && (
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 dark:text-gray-300">
            <ArrowLeft className="w-4 h-4" />
            <span>{t('result.btn_back')}</span>
          </button>
        )}
      </div>

      <div className="flex gap-2" role="group" aria-label={t('admin.range')}>
        {DAY_CHOICES.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            aria-pressed={days === d}
            className={`min-h-[40px] px-4 rounded-xl border text-sm font-bold ${
              days === d ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-gray-700'
            }`}
          >
            {t('admin.days', {n: d})}
          </button>
        ))}
      </div>

      {state.kind === 'loading' && <p className="text-center text-gray-500 font-bold py-8">{t('common.loading')}</p>}

      {state.kind === 'sign_in' && (
        <div id="admin-sign-in" className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400 text-sm font-bold">
          {t('admin.sign_in_needed')}
        </div>
      )}

      {state.kind === 'forbidden' && (
        <div id="admin-forbidden" className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400 text-sm font-bold">
          {t('admin.not_admin')}
        </div>
      )}

      {state.kind === 'unavailable' && (
        <div id="admin-unavailable" className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400 space-y-3">
          <p className="text-sm font-bold">{state.detail || t('admin.unavailable')}</p>
          <button
            type="button"
            onClick={() => void load(days)}
            className="min-h-[40px] px-4 rounded-xl bg-[#1B4D3E] text-white text-sm font-bold inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('admin.retry')}</span>
          </button>
        </div>
      )}

      {state.kind === 'data' && data && (
        <>
          <Card title={t('admin.verdicts_per_day')}>
            {sec('verdicts') === 'unavailable' ? (
              unavailableLine
            ) : perDay.length === 0 ? (
              noData
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perDay} margin={{top: 10, right: 10, left: -20, bottom: 0}}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip />
                    <Legend />
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                      <Bar key={level} dataKey={level} stackId="v" fill={LEVEL_COLORS[level]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title={t('admin.by_kind')}>
            {sec('verdicts') === 'unavailable' ? (
              unavailableLine
            ) : perKindLang.length === 0 ? (
              noData
            ) : (
            <table className="w-full text-sm">
              <tbody>
                {perKindLang.map((r) => (
                  <tr key={`${r.kind}|${r.lang}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1.5">{r.kind}</td>
                    <td className="py-1.5">{r.lang}</td>
                    <td className="py-1.5 text-right font-mono font-bold">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card title={t('admin.rule_hits')}>
              {sec('rule_hits') === 'unavailable'
                ? unavailableLine
                : sec('rule_hits') === 'empty'
                  ? noData
                  : pairTable(data.rule_hits.map((r) => ({key: r.name, n: r.n})))}
            </Card>
            <Card title={t('admin.playbooks')}>
              {sec('reasons') === 'unavailable'
                ? unavailableLine
                : sec('reasons') === 'empty'
                  ? noData
                  : pairTable(data.reasons.map((r) => ({key: r.playbook, n: r.n})))}
            </Card>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card title={t('admin.live')}>
              {sec('live') === 'unavailable' ? (
                unavailableLine
              ) : (
                <p className="text-sm font-bold">
                  {t('admin.live_line', {calls: data.live.calls, looks: data.live.looks, alarms: data.live.alarms})}
                </p>
              )}
            </Card>
            <Card title={t('admin.latency')}>
              {sec('latency') === 'unavailable' ? (
                unavailableLine
              ) : (
                <>
                  <p className="text-sm font-bold">
                    {t('admin.latency_check')}: <span className="font-mono">{latencyLine(data.latency_ms?.check)}</span>
                  </p>
                  <p className="text-sm font-bold">
                    {t('admin.latency_live')}: <span className="font-mono">{latencyLine(data.latency_ms?.live_look)}</span>
                  </p>
                </>
              )}
            </Card>
            <Card title={t('admin.agreement')}>
              {sec('feedback') === 'unavailable' ? (
                unavailableLine
              ) : (
                <>
                  <p className="text-sm font-bold">
                    {t('admin.agreement_checks')}: {rate(data.feedback.checks)}
                  </p>
                  <p className="text-sm font-bold">
                    {t('admin.agreement_alerts')}: {rate(data.feedback.alerts)}
                  </p>
                </>
              )}
            </Card>
            <Card title={t('admin.households')}>
              {sec('households') === 'unavailable' ? (
                unavailableLine
              ) : (
                <p className="text-sm font-bold">
                  {t('admin.households_line', {
                    n: data.households.n,
                    on: data.households.live_guard_on,
                    seen: data.households.devices_seen_24h,
                  })}
                </p>
              )}
            </Card>
          </div>

          {data.unavailable && data.unavailable.length > 0 && (
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {t('admin.partial')} {data.unavailable.join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  );
};
