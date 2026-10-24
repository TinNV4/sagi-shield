/**
 * Decisions of the two household screens, kept apart from React so they can be tested without a renderer:
 * which state the member screen is in, and (guardian side, below) what to poll and which actions a role sees.
 */
import type {Household} from '../api/types';

// ---------------------------------------------------------------- member side (FamilyScreen)

export type MemberScreenState =
  | {kind: 'loading'}
  | {kind: 'unavailable'}
  | {kind: 'error'}
  | {kind: 'create'}
  | {kind: 'household'; household: Household};

/**
 * `uid`: undefined = the sign-in has not answered yet, null = it answered "not available" (no Firebase on this
 * build, or it failed). `households`: null = not loaded yet. A failed call is an error with a retry, never an
 * empty "create" state: offering to create a second household because a request failed would be wrong.
 */
export function memberScreenState(input: {uid: string | null | undefined; households: Household[] | null; failed: boolean}): MemberScreenState {
  if (input.uid === undefined) return {kind: 'loading'};
  if (input.uid === null) return {kind: 'unavailable'};
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
