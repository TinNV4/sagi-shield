/**
 * Decisions of the two household screens, kept apart from React so they can be tested without a renderer:
 * which state the member screen is in, and (guardian side, below) what to poll and which actions a role sees.
 */
import type {FamilyAlertItem, Household} from '../api/types';
import type {AuthUser} from './auth';

// ---------------------------------------------------------------- member side (FamilyScreen)

export type MemberScreenState =
  | {kind: 'loading'}
  | {kind: 'unavailable'}
  | {kind: 'signin_failed'}
  | {kind: 'guardian_session'}
  | {kind: 'error'}
  | {kind: 'create'}
  | {kind: 'join'}
  | {kind: 'household'; household: Household};

/**
 * `uid`: undefined = the sign-in has not answered yet, null = it answered "no user" (no Firebase on this build, or
 * the sign-in failed / was too slow). `authEnabled` tells the two apart: only a build without Firebase is "not
 * available"; a failed sign-in gets a retry. `households`: null = not loaded yet. A failed call is an error with a
 * retry, never an empty "create" state: offering to create a second household because a request failed would be wrong.
 */
export function memberScreenState(input: {
  uid: string | null | undefined;
  households: Household[] | null;
  failed: boolean;
  /** This browser is signed in as a guardian (Google / phone), not as a protected device. */
  guardianSession?: boolean;
  /** The build has Firebase values (auth.ts `authEnabled`). */
  authEnabled?: boolean;
  /** The person chose "I have a code from my family" (or opened a /#join= link) on a device without a household. */
  joinChosen?: boolean;
}): MemberScreenState {
  if (input.uid === undefined) return {kind: 'loading'};
  if (input.uid === null) return input.authEnabled ? {kind: 'signin_failed'} : {kind: 'unavailable'};
  if (input.guardianSession) return {kind: 'guardian_session'};
  if (input.failed) return {kind: 'error'};
  if (input.households === null) return {kind: 'loading'};
  if (input.households.length === 0) return input.joinChosen ? {kind: 'join'} : {kind: 'create'};
  return {kind: 'household', household: input.households[0]};
}

/** What a code field keeps: ASCII digits only (full-width digits are folded by NFKC), at most six. */
export const normalizePairCode = (raw: string): string => raw.normalize('NFKC').replace(/\D/g, '').slice(0, 6);

/** The API knows two markets; the English UI is served with the Japanese pack, as `apiLang` does. */
export const marketForLang = (lang: string): 'ja' | 'vi' => (lang === 'vi' ? 'vi' : 'ja');

/** "123456" -> "123-456"; anything that is not six digits is the placeholder. */
export const formatPairCode = (code: string): string => (/^\d{6}$/.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : '--- ---');

export interface GuardianRow {
  key: string;
  name: string;
  owner: boolean;
  me: boolean;
}

export const guardianRows = (household: Household): GuardianRow[] =>
  household.guardians.map((g, i) => ({key: `g-${i}`, name: g.name, owner: g.owner, me: g.me}));

/** How a guardian is listed: their name, else "Guardian N" by list position (a phone sign-in carries no name). */
export const guardianName = (g: {name: string}, index: number, fallback: (n: number) => string): string =>
  g.name.trim() || fallback(index + 1);

// ---------------------------------------------------------------- guardian side (GuardianViewScreen)

export type GuardianScreenState =
  | {kind: 'loading'}
  | {kind: 'signin'; expired: boolean}
  | {kind: 'protected_device'; household: Household}
  | {kind: 'error'}
  | {kind: 'empty'}
  | {kind: 'dashboard'};

/** An ApiError is not imported here on purpose: any thrown value with `status: 401` counts. */
const isUnauthorized = (failure: unknown): boolean =>
  typeof failure === 'object' && failure !== null && (failure as {status?: unknown}).status === 401;

/**
 * Which screen a guardian sees. The demo API (`isMock`) needs no sign-in. A 401 that survived the client's one
 * retry means the session is gone: the sign-in card with a sentence saying so, never an empty "no alerts" list.
 */
export function guardianScreenState(input: {
  isMock: boolean;
  authKnown: boolean;
  user: AuthUser | null;
  households: Household[] | null;
  failure: unknown;
}): GuardianScreenState {
  if (!input.isMock) {
    if (!input.authKnown) return {kind: 'loading'};
    if (!input.user) return {kind: 'signin', expired: false};
    if (input.user.anonymous) {
      // The protected person's own device: a guardian sign-in here would replace its anonymous session and cut it
      // out of its household. Only a device known to have no household may go on to sign in; a failed load (flaky
      // Wi-Fi) is an error with a retry, so a visiting relative cannot replace the device's identity by accident.
      if (input.failure !== null && input.failure !== undefined) return {kind: 'error'};
      if (input.households === null) return {kind: 'loading'};
      return input.households.length > 0 ? {kind: 'protected_device', household: input.households[0]} : {kind: 'signin', expired: false};
    }
    if (isUnauthorized(input.failure)) return {kind: 'signin', expired: true};
  }
  if (input.failure !== null && input.failure !== undefined) return {kind: 'error'};
  if (input.households === null) return {kind: 'loading'};
  return input.households.length === 0 ? {kind: 'empty'} : {kind: 'dashboard'};
}

/** The household whose alerts are polled: the chosen one while it still exists, otherwise the first. */
export function selectedHousehold(households: Household[] | null, selectedId: string | null): Household | null {
  if (!households || households.length === 0) return null;
  return households.find((h) => h.household_id === selectedId) ?? households[0];
}

/**
 * Speak and vibrate only for a HIGH alert that arrived on top of a list already shown. `previousCount` is null on
 * the first load of a household (switching households resets it: another family's history is not "new").
 */
export function newHighAlert(previousCount: number | null, alerts: Pick<FamilyAlertItem, 'risk_level'>[]): boolean {
  return previousCount !== null && previousCount > 0 && alerts.length > previousCount && alerts[0]?.risk_level === 'HIGH';
}

export interface ManageActions {
  isOwner: boolean;
  canDelete: boolean;
  /** The owner may unpair every device (a lost or replaced phone); only shown while one is paired. */
  canResetDevices: boolean;
  /** The caller's own uid when they may leave (a non-owner); null for an owner, who hands over or deletes. */
  leaveUid: string | null;
  ownerCannotLeave: boolean;
  /** The other guardians that can be removed or made owner (needs the detail view: the list carries no uids). */
  others: {uid: string; name: string}[];
}

export function manageActions(household: Household): ManageActions {
  const me = household.guardians.find((g) => g.me);
  const isOwner = Boolean(me?.owner);
  return {
    isOwner,
    canDelete: isOwner,
    canResetDevices: isOwner && household.devices > 0,
    leaveUid: !isOwner && me?.uid ? me.uid : null,
    ownerCannotLeave: isOwner,
    others: isOwner ? household.guardians.filter((g) => !g.me && g.uid).map((g) => ({uid: g.uid!, name: g.name})) : [],
  };
}

/** What a household is called on a chip and in the delete confirmation: the protected person first. */
export const householdLabel = (household: Household, fallback: string): string => household.member_name || household.name || fallback;

/** "DD/MM HH:MM" in the viewer's local time. */
export function formatLocalDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * A chip label: the protected person, else the household name, else "Household from DD/MM HH:MM" (local time of the
 * ISO creation stamp) so two unnamed households, even made on the same day, do not look the same.
 */
export function householdChipLabel(household: Household, t: (path: string, params?: Record<string, string | number>) => string): string {
  const named = household.member_name || household.name;
  if (named) return named;
  const created = household.created_at ? new Date(household.created_at) : null;
  return created && Number.isFinite(created.getTime())
    ? t('guardian.household_created', {date: formatLocalDateTime(created)})
    : t('guardian.member_fallback');
}

// ---------------------------------------------------------------- phone sign-in (SignInCard)

/** Number entry, or waiting for the SMS code that was sent to `sentTo` at `sentAt` (ms). */
export type PhoneFlow = {step: 'number'} | {step: 'code'; sentTo: string; sentAt: number};
export type PhoneEvent = {type: 'code_sent'; to: string; at: number} | {type: 'change_number'};

/** Firebase refuses rapid resends (auth/too-many-requests): "Send again" opens this long after each SMS. */
export const RESEND_AFTER_MS = 30000;

/** A sent code (first or again) moves to / stays on the code step with the new time; "Change number" goes back. */
export function nextPhoneFlow(_flow: PhoneFlow, event: PhoneEvent): PhoneFlow {
  if (event.type === 'change_number') return {step: 'number'};
  return {step: 'code', sentTo: event.to, sentAt: event.at};
}

/** Milliseconds until "Send again" may be used; 0 = now (and always 0 on the number step). */
export function resendWaitMs(flow: PhoneFlow, now: number): number {
  if (flow.step !== 'code') return 0;
  return Math.max(0, flow.sentAt + RESEND_AFTER_MS - now);
}

const COUNTRY_CODE: Record<'ja' | 'vi', string> = {ja: '81', vi: '84'};

/** Firebase wants E.164. "+81 90-..." stays international; a national number loses its trunk 0 and gets the market's code. */
export function toE164(input: string, market: 'ja' | 'vi'): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  return `+${COUNTRY_CODE[market]}${digits.replace(/^0+/, '')}`;
}

/**
 * A household route answered 403 (not a guardian of it any more) or 404 (it is gone): the list on screen is out of
 * date. The action is always the same: reload the households, drop the gone one, say so in a translated sentence.
 * Null for any other failure (401 has its own path, the rest is the generic error).
 */
export function householdRouteFailure(failure: unknown): {reload: true; messageKey: string} | null {
  const status = typeof failure === 'object' && failure !== null ? (failure as {status?: unknown}).status : undefined;
  if (status === 403) return {reload: true, messageKey: 'guardian.no_longer_member'};
  if (status === 404) return {reload: true, messageKey: 'guardian.household_gone'};
  return null;
}

// ---------------------------------------------------------------- protected device (heartbeat, kiosk)

/** The household a protected device belongs to: for an anonymous user the first one; null while unknown. */
export const deviceHousehold = (households: Household[] | null): Household | null => households?.[0] ?? null;

/** A household with Live Guard switched on opens its device in kiosk mode. */
export const kioskFromHousehold = (household: Household | null): boolean => household?.live_guard_enabled ?? false;

/** Leaving kiosk mode in Settings holds against the household for this long (`sagi_kiosk_unlocked_until`). */
export const KIOSK_UNLOCK_MS = 24 * 3600 * 1000;

/** `raw` is the stored epoch-ms string; a missing or unreadable value is "not unlocked". */
export function kioskUnlockActive(raw: string | null, now: number): boolean {
  const until = raw === null ? NaN : Number(raw);
  return Number.isFinite(until) && until > now;
}

/**
 * What the household's Live Guard switch does to this device's kiosk mode, at start-up, after joining and whenever
 * the app comes back to the foreground. Only an anonymous user (a protected device) is ever switched; a kiosk left
 * in Settings during the last 24 h is kept. Household on + kiosk off -> 'on'. Household off (or no household any
 * more) -> 'off' only for a kiosk the household turned on (`fromHousehold`, `sagi_kiosk_from_household`); a kiosk
 * the person chose in onboarding or Settings (`userChosen`, `sagi_kiosk_user_chosen`) is never touched, not even
 * marked. 'keep' otherwise, so the screen does not move.
 */
export function kioskDecision(input: {
  user: AuthUser | null;
  household: Household | null;
  kioskOn: boolean;
  fromHousehold: boolean;
  /** The person turned this kiosk on themselves (onboarding or Settings): it is never marked as the household's. */
  userChosen: boolean;
  unlockedUntil: string | null;
  now: number;
}): 'on' | 'off' | 'keep' | 'mark' {
  if (!input.user?.anonymous) return 'keep';
  if (kioskUnlockActive(input.unlockedUntil, input.now)) return 'keep';
  // 'mark': a kiosk that was already on (an older build, or turned on by hand) while the household has Live Guard on gets the marker back-filled, so switching Live Guard off later can undo it.
  if (kioskFromHousehold(input.household)) return input.kioskOn ? (input.fromHousehold || input.userChosen ? 'keep' : 'mark') : 'on';
  return input.kioskOn && input.fromHousehold ? 'off' : 'keep';
}
/** After a check that came in through the OS share sheet a kiosk device returns to Live Guard, anything else to Home. */
export const afterResultTarget = (input: {kioskMode: boolean; cameFromShare: boolean}): 'guard' | 'home' =>
  input.kioskMode && input.cameFromShare ? 'guard' : 'home';

/** The shared text and the shared images are both present: the check uses the images, the text stays in the Text tab. */
export const shareNeedsTextHint = (input: {text: string; images: readonly unknown[]}): boolean => Boolean(input.text) && input.images.length > 0;

// ---------------------------------------------------------------- guardian dashboard: device status, setup card

/** A listening heartbeat older than this (three missed beats of `HEARTBEAT_EVERY_S` = 180) no longer says "listening". */
export const LISTENING_FRESH_MS = 10 * 60 * 1000;
/** Beyond this the device counts as never seen / gone (the server's offline sweep uses the same 24 h). */
export const DEVICE_SEEN_MS = 24 * 3600 * 1000;

export interface DeviceStatusLabel {
  kind: 'listening' | 'offline' | 'seen' | 'paired' | 'none';
  /** The heartbeat time (ISO), for `listening`, `offline` and `seen`. */
  at?: string;
}

/**
 * What the dashboard header says about the protected device. `none`: no device paired (`devices` = 0; "No device
 * yet" with the setup card link). `paired`: a device joined but has not sent a (readable) heartbeat yet.
 * `listening`: Live Guard reported listening within `LISTENING_FRESH_MS`. `seen`: a heartbeat up to and including
 * 24 h old. `offline`: Live Guard is on and the newest heartbeat is older than 24 h (the server's sweep has the same
 * rule); with Live Guard off an old heartbeat is not an outage, so it stays `seen` with its time. The text itself
 * is the screen's job.
 */
export function deviceStatusLabel(
  status: Household['device_status'],
  now: number,
  devices: number,
  liveGuardEnabled: boolean,
): DeviceStatusLabel {
  if (devices <= 0) return {kind: 'none'};
  const at = status?.last_seen ?? null;
  const time = at === null ? NaN : Date.parse(at);
  if (at === null || !Number.isFinite(time)) return {kind: 'paired'};
  const age = now - time;
  if (age > DEVICE_SEEN_MS) return liveGuardEnabled ? {kind: 'offline', at} : {kind: 'seen', at};
  if (status?.listening && age <= LISTENING_FRESH_MS) return {kind: 'listening', at};
  return {kind: 'seen', at};
}

/** The offline sweep's "device offline" notice is a system notice in the alert list, not a scam alert. */
export const isSystemAlert = (alert: {scam_type: string}): boolean => alert.scam_type === 'device_offline';

/** The grandparent's setup steps in order (i18n keys); the microphone step only when Live Guard is on. */
export const cardSteps = (liveGuard: boolean): string[] => [
  'card.step_open',
  'card.step_code',
  ...(liveGuard ? ['card.step_mic'] : []),
  'card.step_charger',
];
