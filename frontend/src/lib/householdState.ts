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
  | {kind: 'guardian_session'}
  | {kind: 'error'}
  | {kind: 'create'}
  | {kind: 'household'; household: Household};

/**
 * `uid`: undefined = the sign-in has not answered yet, null = it answered "not available" (no Firebase on this
 * build, or it failed). `households`: null = not loaded yet. A failed call is an error with a retry, never an
 * empty "create" state: offering to create a second household because a request failed would be wrong.
 */
export function memberScreenState(input: {
  uid: string | null | undefined;
  households: Household[] | null;
  failed: boolean;
  /** This browser is signed in as a guardian (Google / phone), not as a protected device. */
  guardianSession?: boolean;
}): MemberScreenState {
  if (input.uid === undefined) return {kind: 'loading'};
  if (input.uid === null) return {kind: 'unavailable'};
  if (input.guardianSession) return {kind: 'guardian_session'};
  if (input.failed) return {kind: 'error'};
  if (input.households === null) return {kind: 'loading'};
  if (input.households.length === 0) return {kind: 'create'};
  return {kind: 'household', household: input.households[0]};
}

/** The API knows two markets; the English UI is served with the Japanese pack, as `apiLang` does. */
export const marketForLang = (lang: string): 'ja' | 'vi' => (lang === 'vi' ? 'vi' : 'ja');

/** "123456" -> "123-456"; anything that is not six digits is the placeholder. */
export const formatPairCode = (code: string): string => (/^\d{6}$/.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : '--- ---');

export interface GuardianRow {
  key: string;
  name: string;
  owner: boolean;
}

export const guardianRows = (household: Household): GuardianRow[] =>
  household.guardians.map((g, i) => ({key: `g-${i}`, name: g.name, owner: g.owner}));

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
      // out of its household. Only a device without a household may go on to sign in.
      if (input.failure !== null && input.failure !== undefined) return {kind: 'signin', expired: false};
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
    leaveUid: !isOwner && me?.uid ? me.uid : null,
    ownerCannotLeave: isOwner,
    others: isOwner ? household.guardians.filter((g) => !g.me && g.uid).map((g) => ({uid: g.uid!, name: g.name})) : [],
  };
}

/** What a household is called on a chip and in the delete confirmation: the protected person first. */
export const householdLabel = (household: Household, fallback: string): string => household.member_name || household.name || fallback;

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
