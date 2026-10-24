import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock,
  PhoneCall,
  Plus,
  RefreshCw,
  Settings,
  ShieldPlus,
  Users,
} from 'lucide-react';
import {api, ApiError, describeApiError, PAIR_FROM_LINK} from '../api/client';
import {FamilyAlertItem, Household} from '../api/types';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';
import {telHref} from '../components/TrustedContact';
import type {CardCode} from './SetupCardScreen';
import {pushPermission, pushToken} from '../lib/push';
import {AuthUser, cancelPhoneSignIn, confirmPhoneCode, onAuth, RECAPTCHA_CONTAINER_ID, signInGuardian, signOut} from '../lib/auth';
import {
  deviceStatusLabel,
  guardianName,
  guardianScreenState,
  householdLabel,
  householdRouteFailure,
  manageActions,
  marketForLang,
  newHighAlert,
  nextPhoneFlow,
  PhoneFlow,
  resendWaitMs,
  selectedHousehold,
  toE164,
} from '../lib/householdState';

// The protected person's number, kept on THIS (guardian) device only. The server never stores it,
// so the call button must not invent one.
const MEMBER_TEL_KEY = 'sagi_member_tel';
// "This browser registered its push token": per device, so the dashboard can say notifications are on.
const PUSH_KEY = 'sagi_push_on';
type PushState = 'on' | 'off' | 'blocked' | 'unsupported';
const readPushState = (): PushState => {
  const permission = pushPermission();
  if (permission === 'unsupported') return 'unsupported';
  if (permission === 'denied') return 'blocked';
  try {
    return permission === 'granted' && localStorage.getItem(PUSH_KEY) === '1' ? 'on' : 'off';
  } catch {
    return 'off';
  }
};
const rememberPush = () => {
  try {
    localStorage.setItem(PUSH_KEY, '1');
  } catch {}
};

const readMemberTel = () => {
  try {
    return localStorage.getItem(MEMBER_TEL_KEY) || '';
  } catch {
    return '';
  }
};

const statusOf = (err: unknown): number | null => (err instanceof ApiError ? err.status : null);

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const ddmmhhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${hhmm(iso)}`;
};

interface SignInCardProps {
  expired: boolean;
  onSignedIn: () => void;
}

/** Google or phone (SMS code). The invisible reCAPTCHA of the phone sign-in attaches to `recaptcha-container`. */
const SignInCard: React.FC<SignInCardProps> = ({expired, onSignedIn}) => {
  const {t, lang} = useI18n();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [flow, setFlow] = useState<PhoneFlow>({step: 'number'});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const codeSent = flow.step === 'code';
  const resendWait = resendWaitMs(flow, now);

  // "Send again" opens a little after each SMS: tick once a second while waiting
  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(resendWait, 1000));
    return () => clearTimeout(timer);
  }, [resendWait, now]);

  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    setFailed(false);
    try {
      if (!(await work())) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const google = () =>
    run(async () => {
      const result = await signInGuardian('google');
      if (result?.state !== 'signed_in') return false;
      onSignedIn();
      return true;
    });

  // first send and "Send again" alike: a new reCAPTCHA, a new SMS, the code field emptied
  const sendCode = () =>
    run(async () => {
      const number = toE164(phone, marketForLang(lang));
      if (!number) return false;
      const result = await signInGuardian('phone', number);
      if (result?.state !== 'code_sent') return false;
      const at = Date.now();
      setFlow((f) => nextPhoneFlow(f, {type: 'code_sent', to: number, at}));
      setNow(at);
      setCode('');
      return true;
    });

  const changeNumber = () => {
    cancelPhoneSignIn();
    setFlow((f) => nextPhoneFlow(f, {type: 'change_number'}));
    setCode('');
    setFailed(false);
  };

  const confirmCode = () =>
    run(async () => {
      const user = await confirmPhoneCode(code.replace(/\s/g, ''));
      if (!user) return false;
      onSignedIn();
      return true;
    });

  return (
    <div id="guardian-signin-card" className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 space-y-4">
      {expired && (
        <p role="alert" className="text-sm font-bold text-amber-800 dark:text-amber-300">
          {t('guardian.session_expired')}
        </p>
      )}
      <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('guardian.signin_title')}</h2>
      <button
        id="guardian-signin-google"
        onClick={google}
        disabled={busy}
        className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold disabled:opacity-40"
      >
        {t('guardian.signin_google')}
      </button>

      <div className="space-y-2">
        <label htmlFor="guardian-phone-input" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
          {t('guardian.phone_label')}
        </label>
        <input
          id="guardian-phone-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={codeSent}
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-lg"
        />
        {!codeSent && (
          <button
            id="guardian-signin-phone"
            onClick={sendCode}
            disabled={busy || phone.replace(/\D/g, '').length < 8}
            className="w-full min-h-[52px] rounded-xl border-2 border-[#1B4D3E] text-[#1B4D3E] dark:text-emerald-300 dark:border-emerald-400 text-base font-bold disabled:opacity-40"
          >
            {t('guardian.signin_phone')}
          </button>
        )}
      </div>

      {flow.step === 'code' && (
        <div className="space-y-2">
          <p id="guardian-code-sent-to" role="status" className="text-sm text-gray-700 dark:text-gray-300">
            {t('guardian.code_sent_to', {number: flow.sentTo})}
          </p>
          <label htmlFor="guardian-sms-input" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t('guardian.code_label')}
          </label>
          <input
            id="guardian-sms-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 font-mono text-2xl tracking-widest text-center"
          />
          <button
            onClick={confirmCode}
            disabled={busy || code.replace(/\D/g, '').length < 4}
            className="w-full min-h-[52px] rounded-xl bg-[#1B4D3E] text-white text-base font-bold disabled:opacity-40"
          >
            {t('common.confirm')}
          </button>
          <div className="flex gap-2">
            <button
              id="guardian-resend-code"
              onClick={sendCode}
              disabled={busy || resendWait > 0}
              className="flex-1 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-bold disabled:opacity-40"
            >
              {resendWait > 0 ? t('guardian.resend_wait', {s: Math.ceil(resendWait / 1000)}) : t('guardian.resend_code')}
            </button>
            <button
              id="guardian-change-number"
              onClick={changeNumber}
              disabled={busy}
              className="flex-1 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-bold disabled:opacity-40"
            >
              {t('guardian.change_number')}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
          {t('guardian.signin_failed')}
        </p>
      )}
      <div id={RECAPTCHA_CONTAINER_ID} />
    </div>
  );
};

type PendingAction =
  | {kind: 'remove' | 'handover'; uid: string; name: string}
  | {kind: 'leave'; uid: string}
  | {kind: 'delete'}
  | {kind: 'reset_devices'};

interface GuardianViewScreenProps {
  onBack: () => void;
  /** Open the printable setup card of a household; `code` is the one just issued (omitted: the card asks for one). */
  onOpenCard: (household: Household, code?: CardCode) => void;
  /** The household to show first (coming back from its setup card). */
  initialSelectedId?: string | null;
}

export const GuardianViewScreen: React.FC<GuardianViewScreenProps> = ({onBack, onOpenCard, initialSelectedId = null}) => {
  const {t, lang} = useI18n();

  const [authState, setAuthState] = useState<{known: boolean; user: AuthUser | null}>({known: false, user: null});
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const initialSelectedRef = useRef(initialSelectedId);
  const [failure, setFailure] = useState<unknown>(null);
  // "you are no longer a guardian of this household" / "it is gone": said once, in words, after the list was resynced
  const [notice, setNotice] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<FamilyAlertItem[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsError, setAlertsError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const prevAlertCountRef = useRef<number | null>(null);
  const polledIdRef = useRef<string | null>(null);

  const [addOpen, setAddOpen] = useState(Boolean(PAIR_FROM_LINK));
  const [codeInput, setCodeInput] = useState(PAIR_FROM_LINK);
  const [nameInput, setNameInput] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [joining, setJoining] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [detail, setDetail] = useState<Household | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  // "Protect a parent": the new household is created here, then its setup card opens
  const [protectOpen, setProtectOpen] = useState(false);
  const [protectName, setProtectName] = useState('');
  const [protectMarket, setProtectMarket] = useState<'ja' | 'vi'>(() => marketForLang(lang));
  const [protectLive, setProtectLive] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const [protectError, setProtectError] = useState<string | null>(null);
  // settings in the manage sheet (editable by the owner only)
  const [settingsForm, setSettingsForm] = useState({member_name: '', name: '', live: false});
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ok: boolean; text: string} | null>(null);

  const [memberTel, setMemberTel] = useState(readMemberTel);
  const [telInput, setTelInput] = useState('');
  const [push, setPush] = useState<PushState>(readPushState);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => onAuth((user) => setAuthState({known: true, user})), []);

  // an anonymous device account counts too: its households decide between the notice and the sign-in card
  const hasUser = api.isMock || Boolean(authState.user);
  const state = guardianScreenState({isMock: api.isMock, authKnown: authState.known, user: authState.user, households, failure});
  const selected = selectedHousehold(households, selectedId);
  const polledId = state.kind === 'dashboard' ? (selected?.household_id ?? null) : null;

  const noteFailure = (err: unknown) => {
    if (statusOf(err) === 401) setFailure(err);
  };

  // A household route that answers 401 (session gone), 403 (no longer a guardian) or 404 (household gone):
  // true when handled here. 403 / 404 resync the list, so a removed guardian does not keep a "live" dashboard.
  const handleRouteError = (err: unknown): boolean => {
    if (statusOf(err) === 401) {
      setFailure(err);
      return true;
    }
    const gone = householdRouteFailure(err);
    if (!gone) return false;
    setNotice(t(gone.messageKey));
    setManageOpen(false);
    void loadHouseholds();
    return true;
  };

  const loadHouseholds = useCallback(async () => {
    try {
      setHouseholds(await api.myHouseholds());
      setFailure(null);
    } catch (err) {
      setFailure(err);
    }
  }, []);

  // households of whoever is signed in (a different account starts from nothing)
  const uid = authState.user?.uid;
  useEffect(() => {
    setHouseholds(null);
    const ready = hasUser && (api.isMock || authState.known);
    setSelectedId(ready ? initialSelectedRef.current : null); // only the first load keeps the household we came back to
    if (ready) {
      initialSelectedRef.current = null;
      void loadHouseholds();
    }
  }, [hasUser, uid, authState.known, loadHouseholds]);

  // the device status line follows the household list: refresh it quietly (a blip is not an error screen)
  useEffect(() => {
    if (state.kind !== 'dashboard') return;
    const timer = setInterval(() => api.myHouseholds().then(setHouseholds).catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [state.kind]);

  const saveMemberTel = () => {
    const tel = telInput.trim().slice(0, 30);
    if (!tel) return;
    try {
      localStorage.setItem(MEMBER_TEL_KEY, tel);
    } catch {}
    setMemberTel(tel);
  };

  // API labels (fake_police, ...) are contract values, not text for people
  const typeLabel = (code: string) => {
    const label = t(`types.${code}`);
    return label.startsWith('types.') ? t('types.unknown') : label;
  };

  const handleJoin = async () => {
    setLinkError(false);
    setJoining(true);
    try {
      // the permission prompt rides on this click; a refusal or a slow token never stops the pairing
      const token = await pushToken();
      const joined = await api.joinHousehold(codeInput, nameInput.trim() || undefined, token ?? undefined);
      if (token) rememberPush();
      setPush(readPushState());
      setCodeInput('');
      setNameInput('');
      setAddOpen(false);
      setNotice(null);
      await loadHouseholds();
      setSelectedId(joined.household_id);
    } catch (err) {
      noteFailure(err);
      setLinkError(true);
    } finally {
      setJoining(false);
    }
  };

  const registerPushEverywhere = async (token: string) => {
    // a guardian is notified per household: the same browser token goes to each of them
    await Promise.all((households ?? []).map((h) => api.registerHouseholdPush(h.household_id, token)));
  };

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const token = await pushToken();
      if (token) {
        await registerPushEverywhere(token);
        rememberPush();
      }
    } catch {
      // the dashboard keeps polling: an alert still shows here
    } finally {
      setPush(readPushState());
      setPushBusy(false);
    }
  };

  // browsers rotate push tokens: re-register quietly whenever the dashboard opens with notifications on
  const householdKey = (households ?? []).map((h) => h.household_id).join(',');
  useEffect(() => {
    if (state.kind !== 'dashboard' || readPushState() !== 'on') return;
    pushToken()
      .then((token) => {
        if (token) return registerPushEverywhere(token);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, householdKey]);

  const fetchAlerts = async (id: string, silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const data = await api.householdAlerts(id);
      if (polledIdRef.current !== id) return; // the user switched household while this was on its way
      if (newHighAlert(prevAlertCountRef.current, data)) {
        // Play sound and vibration alert
        speech.speak(t('guardian.alert_spoken'), lang, 'guardian');
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([400, 200, 400]);
        }
      }
      prevAlertCountRef.current = data.length;
      setAlerts(data);
      setAlertsLoaded(true);
      setAlertsError(null);
    } catch (err) {
      if (polledIdRef.current !== id) return;
      // an expired session must show as such, never as "no alerts"
      if (!handleRouteError(err)) setAlertsError(err);
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  // the recorded alert voice, in memory before the first HIGH alert arrives
  useEffect(() => {
    void speech.preload('guardian', lang);
  }, [lang]);

  // Poll the selected household every 5 seconds; another household starts from an empty, unannounced list
  useEffect(() => {
    polledIdRef.current = polledId;
    prevAlertCountRef.current = null;
    setAlerts([]);
    setAlertsLoaded(false);
    setAlertsError(null);
    if (!polledId) return;
    void fetchAlerts(polledId);
    const interval = setInterval(() => void fetchAlerts(polledId, true), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledId]);

  // ---- manage sheet ----
  useEffect(() => {
    setPending(null);
    setManageError(null);
    setDetail(null);
    if (!manageOpen || !polledId) return;
    let cancelled = false;
    api
      .householdDetail(polledId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => {
        if (cancelled || handleRouteError(err)) return;
        setManageError(describeApiError(err, t));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageOpen, polledId]);

  const runPending = async () => {
    if (!pending || !polledId) return;
    setManaging(true);
    setManageError(null);
    try {
      if (pending.kind === 'remove' || pending.kind === 'leave') await api.removeGuardian(polledId, pending.uid);
      else if (pending.kind === 'handover') await api.handOver(polledId, pending.uid);
      else if (pending.kind === 'reset_devices') await api.resetHouseholdDevices(polledId);
      else await api.deleteHousehold(polledId);
      setPending(null);
      await loadHouseholds();
      if (pending.kind === 'leave' || pending.kind === 'delete') setManageOpen(false);
      else setDetail(await api.householdDetail(polledId));
    } catch (err) {
      setPending(null);
      if (!handleRouteError(err)) setManageError(statusOf(err) === 409 ? t('guardian.owner_cannot_leave') : describeApiError(err, t));
    } finally {
      setManaging(false);
    }
  };

  const handleProtect = async () => {
    setProtecting(true);
    setProtectError(null);
    try {
      const created = await api.createHousehold({member_name: protectName.trim() || undefined, market: protectMarket});
      let household = created.household;
      if (protectLive) {
        try {
          household = await api.updateHousehold(created.household_id, {live_guard_enabled: true});
        } catch (err) {
          setNotice(describeApiError(err, t)); // the household exists: the toggle can be set again in Settings
        }
      }
      setProtectOpen(false);
      setProtectName('');
      setProtectLive(false);
      await loadHouseholds();
      setSelectedId(created.household_id);
      onOpenCard(household, {pair_code: created.pair_code, expiresAt: Date.now() + created.expires_in * 1000});
    } catch (err) {
      if (statusOf(err) === 401) setFailure(err);
      else setProtectError(describeApiError(err, t));
    } finally {
      setProtecting(false);
    }
  };

  useEffect(() => {
    setSettingsMsg(null);
    if (detail) setSettingsForm({member_name: detail.member_name, name: detail.name, live: detail.live_guard_enabled});
  }, [detail]);

  const saveSettings = async () => {
    if (!polledId || !detail) return;
    const fields: {member_name?: string; name?: string; live_guard_enabled?: boolean} = {};
    if (settingsForm.member_name.trim() !== detail.member_name) fields.member_name = settingsForm.member_name.trim();
    if (settingsForm.name.trim() !== detail.name) fields.name = settingsForm.name.trim();
    if (settingsForm.live !== detail.live_guard_enabled) fields.live_guard_enabled = settingsForm.live;
    if (Object.keys(fields).length === 0) return;
    setSettingsBusy(true);
    setSettingsMsg(null);
    try {
      await api.updateHousehold(polledId, fields);
      await loadHouseholds();
      setDetail(await api.householdDetail(polledId));
      setSettingsMsg({ok: true, text: t('guardian.settings_saved')});
    } catch (err) {
      if (!handleRouteError(err)) setSettingsMsg({ok: false, text: describeApiError(err, t)});
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleSignOut = async () => {
    setManageOpen(false);
    // this browser's push token must not keep receiving the households' alerts after sign-out (best effort)
    if (readPushState() === 'on' && households?.length) {
      const token = await pushToken();
      if (token) await Promise.allSettled(households.map((h) => api.unregisterHouseholdPush(h.household_id, token)));
    }
    try {
      localStorage.removeItem(PUSH_KEY);
    } catch {}
    setPush(readPushState());
    setNotice(null);
    await signOut();
  };

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

  const label = (h: Household) => householdLabel(h, t('guardian.member_fallback'));
  const shownName = (g: {name: string}, i: number) => guardianName(g, i, (n) => t('family.guardian_fallback', {n}));
  const actions = detail ? manageActions(detail) : null;
  const device = selected ? deviceStatusLabel(selected.device_status, Date.now()) : null;
  const fieldClass = 'w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-base';
  const pendingText = !pending
    ? ''
    : pending.kind === 'delete'
      ? t('guardian.delete_confirm', {name: selected ? label(selected) : ''})
      : pending.kind === 'reset_devices'
        ? t('guardian.reset_devices_confirm', {name: selected ? label(selected) : ''})
        : `${t(pending.kind === 'handover' ? 'guardian.hand_over' : pending.kind === 'remove' ? 'guardian.remove' : 'guardian.leave')}${
            pending.kind === 'leave' ? '' : `: ${pending.name}`
          }`;

  const protectForm = (
    <div id="guardian-protect-card" className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 space-y-3">
      <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('guardian.protect_parent')}</h2>
      <label htmlFor="protect-name-input" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
        {t('guardian.parent_name')}
      </label>
      <input id="protect-name-input" maxLength={40} value={protectName} onChange={(e) => setProtectName(e.target.value)} className={fieldClass} />
      <label htmlFor="protect-market-select" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
        {t('guardian.market')}
      </label>
      <select
        id="protect-market-select"
        value={protectMarket}
        onChange={(e) => setProtectMarket(e.target.value === 'vi' ? 'vi' : 'ja')}
        className={fieldClass}
      >
        <option value="ja">{t('guardian.market_ja')}</option>
        <option value="vi">{t('guardian.market_vi')}</option>
      </select>
      <label className="flex items-start gap-3 text-sm font-bold text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={protectLive} onChange={(e) => setProtectLive(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0" />
        <span>{t('guardian.live_guard_toggle')}</span>
      </label>
      <p className="text-xs text-gray-600 dark:text-gray-400">{t('guardian.live_guard_help')}</p>
      <button
        id="protect-submit"
        onClick={handleProtect}
        disabled={protecting}
        className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold disabled:opacity-40"
      >
        {t('guardian.protect_parent')}
      </button>
      {protectError && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{protectError}</p>}
    </div>
  );

  const addCard = (
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
      <label htmlFor="guardian-name-input" className="block text-sm font-bold text-gray-700 dark:text-gray-300">
        {t('guardian.your_name_label')}
      </label>
      <input
        id="guardian-name-input"
        autoComplete="name"
        maxLength={40}
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-lg"
      />
      <button
        onClick={handleJoin}
        disabled={joining || codeInput.replace(/\D/g, '').length !== 6}
        className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold disabled:opacity-40"
      >
        {t('guardian.link_btn')}
      </button>
      {linkError && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{t('guardian.link_fail')}</p>}
    </div>
  );

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

        {polledId && (
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
              {t('guardian.polling_desc')}
            </span>
            <button
              onClick={() => void fetchAlerts(polledId)}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500"
              title={t('guardian.manual_refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {(state.kind === 'dashboard' || state.kind === 'empty') && push !== 'unsupported' && (
        <div id="guardian-push-card" className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
          <BellRing className={`w-5 h-5 shrink-0 ${push === 'on' ? 'text-emerald-600' : 'text-gray-400'}`} />
          {push === 'off' ? (
            <button
              onClick={enablePush}
              disabled={pushBusy}
              className="flex-1 min-h-[44px] rounded-lg bg-[#1B4D3E] text-white text-sm font-bold disabled:opacity-50"
            >
              {t('guardian.push_enable')}
            </button>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300">{t(push === 'on' ? 'guardian.push_on' : 'guardian.push_blocked')}</p>
          )}
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

      {state.kind === 'loading' && (
        <p role="status" className="text-sm font-bold text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </p>
      )}

      {notice && (state.kind === 'dashboard' || state.kind === 'empty') && (
        <p id="guardian-notice" role="status" className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400 text-sm font-bold text-amber-900 dark:text-amber-200">
          {notice}
        </p>
      )}

      {state.kind === 'protected_device' && (
        <p id="guardian-device-is-protected" role="status" className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/30 text-base font-bold text-gray-900 dark:text-white">
          {t('guardian.device_is_protected', {name: householdLabel(state.household, t('guardian.member_fallback'))})}
        </p>
      )}

      {state.kind === 'signin' && (
        <SignInCard
          expired={state.expired}
          onSignedIn={() => {
            setFailure(null);
            void loadHouseholds();
          }}
        />
      )}

      {state.kind === 'error' && (
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-red-300 space-y-3">
          <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{describeApiError(failure, t)}</p>
          <button
            onClick={() => {
              setFailure(null);
              void loadHouseholds();
            }}
            className="min-h-[48px] px-5 rounded-xl bg-[#1B4D3E] text-white text-base font-bold"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {state.kind === 'empty' && (
        <>
          <button
            id="guardian-protect-parent-empty"
            onClick={() => setProtectOpen((open) => !open)}
            className="w-full min-h-[56px] rounded-xl bg-[#1B4D3E] text-white text-lg font-bold"
          >
            {t('guardian.protect_parent')}
          </button>
          {protectOpen && protectForm}
          {addCard}
          {!api.isMock && (
            <button onClick={handleSignOut} className="text-sm font-bold text-gray-600 dark:text-gray-300 underline">
              {t('guardian.sign_out')}
            </button>
          )}
        </>
      )}

      {state.kind === 'dashboard' && households && selected && (
        <>
          {/* household switcher + actions */}
          <div className="space-y-3">
            {households.length > 1 && (
              <div id="guardian-household-chips" role="tablist" className="flex flex-wrap gap-2">
                {households.map((h) => (
                  <button
                    key={h.household_id}
                    role="tab"
                    aria-selected={h.household_id === selected.household_id}
                    onClick={() => {
                      setNotice(null);
                      setSelectedId(h.household_id);
                    }}
                    className={`min-h-[40px] px-4 rounded-full text-sm font-bold border-2 transition ${
                      h.household_id === selected.household_id
                        ? 'bg-[#1B4D3E] border-[#1B4D3E] text-white'
                        : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {label(h)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                id="guardian-protect-parent"
                onClick={() => setProtectOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-sm font-bold bg-[#1B4D3E] border-2 border-[#1B4D3E] text-white"
              >
                <ShieldPlus className="w-4 h-4" />
                <span>{t('guardian.protect_parent')}</span>
              </button>
              <button
                id="guardian-add-household"
                onClick={() => setAddOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-sm font-bold border-2 border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200"
              >
                <Plus className="w-4 h-4" />
                <span>{t('guardian.add_household')}</span>
              </button>
              <button
                id="guardian-manage"
                onClick={() => setManageOpen((open) => !open)}
                aria-expanded={manageOpen}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-sm font-bold border-2 border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200"
              >
                <Settings className="w-4 h-4" />
                <span>{t('guardian.manage')}</span>
              </button>
            </div>
          </div>

          {device && (
            <p id="guardian-device-status" role="status" className="flex flex-wrap items-center gap-x-3 text-sm font-bold">
              <span
                className={
                  device.kind === 'listening' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'
                }
              >
                {device.kind === 'listening' && t('guardian.status_listening', {time: hhmm(device.at!)})}
                {device.kind === 'seen' && t('guardian.status_seen', {time: ddmmhhmm(device.at!)})}
                {device.kind === 'none' && t('guardian.status_none')}
              </span>
              <button id="guardian-show-card" onClick={() => onOpenCard(selected)} className="underline text-[#1B4D3E] dark:text-emerald-300">
                {t('guardian.show_card')}
              </button>
            </p>
          )}

          {protectOpen && protectForm}
          {addOpen && addCard}

          {manageOpen && (
            <div id="guardian-manage-sheet" className="p-5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-gray-300 dark:border-gray-700 space-y-4">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {t('guardian.manage')}: {label(selected)}
              </h2>

              {!detail && !manageError && <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>}

              {detail && actions && (
                <>
                  <ul className="space-y-2">
                    {detail.guardians.map((g, i) => (
                      <li key={g.uid ?? i} className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-bold text-gray-900 dark:text-white">
                          {shownName(g, i)}
                          {g.me && <span className="ml-1 font-normal text-gray-600 dark:text-gray-400">{t('family.you_marker')}</span>}
                          {g.owner && (
                            <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              {t('family.owner_badge')}
                            </span>
                          )}
                        </span>
                        {actions.others.some((o) => o.uid === g.uid) && g.uid && (
                          <span className="flex gap-2">
                            <button
                              onClick={() => setPending({kind: 'handover', uid: g.uid!, name: shownName(g, i)})}
                              className="min-h-[40px] px-3 rounded-lg border border-gray-300 dark:border-gray-700 font-bold"
                            >
                              {t('guardian.hand_over')}
                            </button>
                            <button
                              onClick={() => setPending({kind: 'remove', uid: g.uid!, name: shownName(g, i)})}
                              className="min-h-[40px] px-3 rounded-lg border border-red-300 text-red-700 dark:text-red-400 font-bold"
                            >
                              {t('guardian.remove')}
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  <div id="guardian-settings" className="space-y-2">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t('guardian.settings')}</h3>
                    <label htmlFor="settings-member-name" className="block text-sm text-gray-700 dark:text-gray-300">
                      {t('guardian.parent_name')}
                    </label>
                    <input
                      id="settings-member-name"
                      maxLength={40}
                      value={settingsForm.member_name}
                      disabled={!actions.isOwner}
                      onChange={(e) => setSettingsForm((f) => ({...f, member_name: e.target.value}))}
                      className={fieldClass}
                    />
                    <label htmlFor="settings-household-name" className="block text-sm text-gray-700 dark:text-gray-300">
                      {t('guardian.household_name')}
                    </label>
                    <input
                      id="settings-household-name"
                      maxLength={40}
                      value={settingsForm.name}
                      disabled={!actions.isOwner}
                      onChange={(e) => setSettingsForm((f) => ({...f, name: e.target.value}))}
                      className={fieldClass}
                    />
                    <label className="flex items-start gap-3 text-sm font-bold text-gray-800 dark:text-gray-200">
                      <input
                        id="settings-live-guard"
                        type="checkbox"
                        checked={settingsForm.live}
                        disabled={!actions.isOwner}
                        onChange={(e) => setSettingsForm((f) => ({...f, live: e.target.checked}))}
                        className="mt-0.5 h-6 w-6 shrink-0"
                      />
                      <span>{t('guardian.live_guard_toggle')}</span>
                    </label>
                    {actions.isOwner && (
                      <button
                        id="settings-save"
                        onClick={saveSettings}
                        disabled={settingsBusy}
                        className="w-full min-h-[48px] rounded-xl bg-[#1B4D3E] text-white font-bold disabled:opacity-40"
                      >
                        {t('guardian.settings_save')}
                      </button>
                    )}
                    {settingsMsg && (
                      <p role={settingsMsg.ok ? 'status' : 'alert'} className={`text-sm font-bold ${settingsMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        {settingsMsg.text}
                      </p>
                    )}
                  </div>

                  <p id="guardian-devices-count" className="text-sm text-gray-700 dark:text-gray-300">
                    {t('guardian.devices_count', {n: detail.devices})}
                  </p>

                  {actions.canResetDevices && (
                    <button
                      id="guardian-reset-devices"
                      onClick={() => setPending({kind: 'reset_devices'})}
                      className="w-full min-h-[48px] rounded-xl border-2 border-red-300 text-red-700 dark:text-red-400 font-bold"
                    >
                      {t('guardian.reset_devices')}
                    </button>
                  )}

                  {actions.ownerCannotLeave && <p className="text-xs text-gray-600 dark:text-gray-400">{t('guardian.owner_cannot_leave')}</p>}

                  {actions.leaveUid && (
                    <button
                      onClick={() => setPending({kind: 'leave', uid: actions.leaveUid!})}
                      className="w-full min-h-[48px] rounded-xl border-2 border-red-300 text-red-700 dark:text-red-400 font-bold"
                    >
                      {t('guardian.leave')}
                    </button>
                  )}

                  {actions.canDelete && (
                    <button
                      onClick={() => setPending({kind: 'delete'})}
                      className="w-full min-h-[48px] rounded-xl bg-red-700 text-white font-bold"
                    >
                      {t('guardian.delete_household')}
                    </button>
                  )}
                </>
              )}

              {pending && (
                <div role="alertdialog" className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 space-y-3">
                  <p className="text-sm font-bold text-red-900 dark:text-red-200">{pendingText}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPending(null)} disabled={managing} className="flex-1 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 font-bold">
                      {t('common.cancel')}
                    </button>
                    <button onClick={runPending} disabled={managing} className="flex-1 min-h-[44px] rounded-lg bg-red-700 text-white font-bold disabled:opacity-50">
                      {t('common.confirm')}
                    </button>
                  </div>
                </div>
              )}

              {manageError && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{manageError}</p>}

              {!api.isMock && (
                <button onClick={handleSignOut} className="text-sm font-bold text-gray-600 dark:text-gray-300 underline">
                  {t('guardian.sign_out')}
                </button>
              )}
            </div>
          )}

          {/* Alert List */}
          <div className="space-y-3.5">
            {alerts.length === 0 ? (
              alertsError ? (
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-red-300 text-center space-y-3">
                  <AlertTriangle className="w-10 h-10 mx-auto text-red-500" />
                  <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">{describeApiError(alertsError, t)}</p>
                </div>
              ) : !alertsLoaded ? (
                <p role="status" className="text-sm font-bold text-gray-500 dark:text-gray-400 text-center">{t('common.loading')}</p>
              ) : (
                <div className="p-8 text-center rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 text-gray-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
                  <p className="font-bold text-base text-gray-800 dark:text-gray-200">
                    {t('guardian.empty_title')}
                  </p>
                  <p className="text-xs mt-1">
                    {t('guardian.empty_desc')}
                  </p>
                </div>
              )
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
                      {t('guardian.stage_label', {stage: alert.stage, type: typeLabel(alert.scam_type)})}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-xs opacity-75 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatRelativeTime(alert.created_at)}</span>
                  </div>
                </div>

                {/* Member name */}
                <div className="text-lg sm:text-xl font-black">
                  {alert.member_name || t('guardian.member_fallback')}
                </div>

                {/* 2-line summary */}
                <p className="text-sm sm:text-base font-semibold leading-snug line-clamp-2 bg-white/70 dark:bg-slate-900/70 p-3 rounded-2xl border border-current/20">
                  {alert.summary}
                </p>

                {/* Big Call Now Button - only with a real number (mock alert or saved on this device) */}
                <div className="pt-1">
                  {alert.phone_tel || memberTel ? (
                    <a
                      href={telHref(alert.phone_tel || memberTel)}
                      className="w-full min-h-[52px] rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] active:scale-98 text-white font-bold text-base flex items-center justify-center gap-2 shadow-md transition"
                    >
                      <PhoneCall className="w-5 h-5 text-yellow-300" />
                      <span>{t('guardian.btn_call_member', {name: (alert.member_name || t('guardian.member_fallback')).split('（')[0]})}</span>
                    </a>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold opacity-80">{t('guardian.member_tel_hint')}</p>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          inputMode="tel"
                          value={telInput}
                          onChange={(e) => setTelInput(e.target.value)}
                          placeholder={t('guardian.member_tel_placeholder')}
                          className="flex-1 min-w-0 p-3 rounded-2xl bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-700 text-base text-gray-900 dark:text-white"
                        />
                        <button
                          onClick={saveMemberTel}
                          className="px-4 rounded-2xl bg-[#1B4D3E] hover:bg-[#143C30] text-white text-sm font-bold"
                        >
                          {t('guardian.member_tel_save')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
            )}
          </div>
        </>
      )}
    </div>
  );
};
