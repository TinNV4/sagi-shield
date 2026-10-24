import {describe, expect, it} from 'vitest';
import type {Household} from '../api/types';
import type {AuthUser} from './auth';
import {
  formatPairCode,
  deviceHousehold,
  guardianRows,
  guardianScreenState,
  householdLabel,
  householdRouteFailure,
  kioskFromHousehold,
  kioskUnlockActive,
  KIOSK_UNLOCK_MS,
  guardianName,
  manageActions,
  marketForLang,
  memberScreenState,
  newHighAlert,
  nextPhoneFlow,
  resendWaitMs,
  RESEND_AFTER_MS,
  selectedHousehold,
  toE164,
} from './householdState';

const household = (over: Partial<Household> = {}): Household => ({
  household_id: 'h1',
  name: '',
  member_name: 'Mom',
  market: 'ja',
  live_guard_enabled: false,
  devices: 1,
  guardians: [],
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('memberScreenState', () => {
  it('is loading until the sign-in answered, then until the households arrived', () => {
    expect(memberScreenState({uid: undefined, households: null, failed: false})).toEqual({kind: 'loading'});
    expect(memberScreenState({uid: 'dev', households: null, failed: false})).toEqual({kind: 'loading'});
  });

  it('says pairing is unavailable when the sign-in returned null; no household is looked at', () => {
    expect(memberScreenState({uid: null, households: [household()], failed: false})).toEqual({kind: 'unavailable'});
    expect(memberScreenState({uid: null, households: null, failed: false, authEnabled: false})).toEqual({kind: 'unavailable'});
  });

  it('a build with sign-in whose anonymous sign-in failed or was slow offers a retry, not "not available"', () => {
    expect(memberScreenState({uid: null, households: null, failed: false, authEnabled: true})).toEqual({kind: 'signin_failed'});
  });

  it('a browser signed in as a guardian gets a notice, never a household code', () => {
    expect(memberScreenState({uid: 'g1', households: [household()], failed: false, guardianSession: true})).toEqual({kind: 'guardian_session'});
    expect(memberScreenState({uid: 'g1', households: null, failed: false, guardianSession: true})).toEqual({kind: 'guardian_session'});
    expect(memberScreenState({uid: null, households: null, failed: false, guardianSession: true})).toEqual({kind: 'unavailable'});
  });

  it('offers to create a household when there is none', () => {
    expect(memberScreenState({uid: 'dev', households: [], failed: false})).toEqual({kind: 'create'});
  });

  it('shows the first household when one exists', () => {
    const h = household();
    expect(memberScreenState({uid: 'dev', households: [h, household({household_id: 'h2'})], failed: false})).toEqual({kind: 'household', household: h});
  });

  it('a failed call is an error with a retry, never an empty "create" state', () => {
    expect(memberScreenState({uid: 'dev', households: [], failed: true})).toEqual({kind: 'error'});
    expect(memberScreenState({uid: 'dev', households: null, failed: true})).toEqual({kind: 'error'});
  });
});

describe('marketForLang', () => {
  it('maps the English UI to ja, as the API language does', () => {
    expect(marketForLang('en')).toBe('ja');
    expect(marketForLang('ja')).toBe('ja');
    expect(marketForLang('vi')).toBe('vi');
  });
});

describe('formatPairCode', () => {
  it('groups six digits and leaves anything else as a placeholder', () => {
    expect(formatPairCode('123456')).toBe('123-456');
    expect(formatPairCode('')).toBe('--- ---');
    expect(formatPairCode('12')).toBe('--- ---');
  });
});

describe('guardianRows', () => {
  it('lists names with the owner mark and keeps the order', () => {
    const rows = guardianRows(household({guardians: [{name: 'Taro', owner: true, me: false}, {name: '', owner: false, me: false}]}));
    expect(rows).toEqual([
      {key: 'g-0', name: 'Taro', owner: true, me: false},
      {key: 'g-1', name: '', owner: false, me: false},
    ]);
  });
});

describe('guardianName', () => {
  const fallback = (n: number) => `Guardian ${n}`;
  it('a guardian without a name (phone sign-in) is "Guardian N" by list position, never "Primary Guardian"', () => {
    expect(guardianName({name: ''}, 0, fallback)).toBe('Guardian 1');
    expect(guardianName({name: '  '}, 2, fallback)).toBe('Guardian 3');
    expect(guardianName({name: 'Taro'}, 1, fallback)).toBe('Taro');
  });
});

describe('phone sign-in steps', () => {
  it('code sent -> code step; send again stays there with a new time; change number goes back', () => {
    const sent = nextPhoneFlow({step: 'number'}, {type: 'code_sent', to: '+819012345678', at: 1000});
    expect(sent).toEqual({step: 'code', sentTo: '+819012345678', sentAt: 1000});
    expect(nextPhoneFlow(sent, {type: 'code_sent', to: '+819012345678', at: 50000})).toEqual({step: 'code', sentTo: '+819012345678', sentAt: 50000});
    expect(nextPhoneFlow(sent, {type: 'change_number'})).toEqual({step: 'number'});
  });

  it('send again waits a little after each SMS (Firebase blocks rapid resends)', () => {
    const sent = {step: 'code' as const, sentTo: '+81', sentAt: 1000};
    expect(resendWaitMs(sent, 1000)).toBe(RESEND_AFTER_MS);
    expect(resendWaitMs(sent, 1000 + RESEND_AFTER_MS - 1)).toBe(1);
    expect(resendWaitMs(sent, 1000 + RESEND_AFTER_MS)).toBe(0);
    expect(resendWaitMs({step: 'number'}, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------- guardian side

const user = (over: Partial<AuthUser> = {}): AuthUser => ({uid: 'u1', anonymous: false, name: 'Hanako', ...over});
const base = {isMock: false, authKnown: true, user: user(), households: [household()] as Household[] | null, failure: null as unknown};

describe('guardianScreenState', () => {
  it('waits for the stored session before deciding anything', () => {
    expect(guardianScreenState({...base, authKnown: false, user: null})).toEqual({kind: 'loading'});
  });

  it('an anonymous device whose household load failed gets an error with a retry, never the sign-in card', () => {
    // a visiting relative on flaky Wi-Fi must not be able to replace the device's identity with a guardian sign-in
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: null, failure: {status: 503}})).toEqual({kind: 'error'});
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: null, failure: new Error('offline')})).toEqual({kind: 'error'});
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: null, failure: {status: 401}})).toEqual({kind: 'error'});
  });

  it('not signed in, or only the anonymous device account: the sign-in card', () => {
    expect(guardianScreenState({...base, user: null})).toEqual({kind: 'signin', expired: false});
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: []})).toEqual({kind: 'signin', expired: false});
  });

  it("the protected person's own device (anonymous, with a household) gets a notice instead of sign-in buttons", () => {
    const h = household({member_name: 'Mom'});
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: [h]})).toEqual({kind: 'protected_device', household: h});
  });

  it('an anonymous user whose households are still loading waits', () => {
    expect(guardianScreenState({...base, user: user({anonymous: true}), households: null})).toEqual({kind: 'loading'});
  });

  it('a 401 that survived the client retry is "session expired" with the sign-in card, never an empty list', () => {
    const state = guardianScreenState({...base, households: null, failure: {status: 401}});
    expect(state).toEqual({kind: 'signin', expired: true});
  });

  it('another failure is an error with a retry', () => {
    expect(guardianScreenState({...base, households: null, failure: {status: 503}})).toEqual({kind: 'error'});
    expect(guardianScreenState({...base, households: null, failure: new Error('x')})).toEqual({kind: 'error'});
  });

  it('signed in: loading until the households arrived, then empty or the dashboard', () => {
    expect(guardianScreenState({...base, households: null})).toEqual({kind: 'loading'});
    expect(guardianScreenState({...base, households: []})).toEqual({kind: 'empty'});
    expect(guardianScreenState(base)).toEqual({kind: 'dashboard'});
  });

  it('the demo (mock API) needs no sign-in', () => {
    expect(guardianScreenState({...base, isMock: true, authKnown: false, user: null})).toEqual({kind: 'dashboard'});
  });
});

describe('selectedHousehold', () => {
  const a = household({household_id: 'a'});
  const b = household({household_id: 'b'});
  it('keeps the chosen one, falls back to the first, is null without households', () => {
    expect(selectedHousehold([a, b], 'b')).toBe(b);
    expect(selectedHousehold([a, b], 'gone')).toBe(a);
    expect(selectedHousehold([a, b], null)).toBe(a);
    expect(selectedHousehold([], 'a')).toBeNull();
    expect(selectedHousehold(null, 'a')).toBeNull();
  });
});

describe('newHighAlert', () => {
  const alert = (risk: 'HIGH' | 'MEDIUM') => ({risk_level: risk}) as any;
  it('speaks only when a HIGH one arrived on top of a list that was already loaded', () => {
    expect(newHighAlert(2, [alert('HIGH'), alert('MEDIUM'), alert('MEDIUM')])).toBe(true);
    expect(newHighAlert(2, [alert('MEDIUM'), alert('MEDIUM'), alert('MEDIUM')])).toBe(false);
    expect(newHighAlert(2, [alert('HIGH'), alert('HIGH')])).toBe(false);
  });
  it('the first load of a household (and an empty first list) never speaks', () => {
    expect(newHighAlert(null, [alert('HIGH')])).toBe(false);
    expect(newHighAlert(0, [alert('HIGH')])).toBe(false);
  });
});

describe('manageActions', () => {
  const owner = household({
    guardians: [
      {name: 'Me', owner: true, me: true, uid: 'u1'},
      {name: 'Sis', owner: false, me: false, uid: 'u2'},
    ],
  });
  const member = household({
    guardians: [
      {name: 'Boss', owner: true, me: false, uid: 'u9'},
      {name: 'Me', owner: false, me: true, uid: 'u1'},
    ],
  });

  it('the owner can remove and hand over to the others, reset the devices and delete, but not leave', () => {
    expect(manageActions(owner)).toEqual({
      isOwner: true,
      canDelete: true,
      canResetDevices: true,
      leaveUid: null,
      ownerCannotLeave: true,
      others: [{uid: 'u2', name: 'Sis'}],
    });
  });

  it('a non-owner guardian can only leave', () => {
    expect(manageActions(member)).toEqual({
      isOwner: false,
      canDelete: false,
      canResetDevices: false,
      leaveUid: 'u1',
      ownerCannotLeave: false,
      others: [],
    });
  });

  it('nothing to reset when no device is paired', () => {
    expect(manageActions({...owner, devices: 0}).canResetDevices).toBe(false);
  });

  it('without uids (the list view) nobody can be picked', () => {
    const noUid = household({guardians: [{name: 'Me', owner: true, me: true}, {name: 'Sis', owner: false, me: false}]});
    expect(manageActions(noUid).others).toEqual([]);
  });
});

describe('householdLabel / deleteName', () => {
  it('prefers the protected person, then the household name, then the fallback', () => {
    expect(householdLabel(household({member_name: 'Mom', name: 'Home'}), 'x')).toBe('Mom');
    expect(householdLabel(household({member_name: '', name: 'Home'}), 'x')).toBe('Home');
    expect(householdLabel(household({member_name: '', name: ''}), 'x')).toBe('x');
  });
});

describe('toE164', () => {
  it('keeps an international number, converts a national one by market', () => {
    expect(toE164('+81 90-1234-5678', 'ja')).toBe('+819012345678');
    expect(toE164('090-1234-5678', 'ja')).toBe('+819012345678');
    expect(toE164('0912 345 678', 'vi')).toBe('+84912345678');
  });
  it('rejects what cannot be a number', () => {
    expect(toE164('', 'ja')).toBeNull();
    expect(toE164('abc', 'ja')).toBeNull();
    expect(toE164('123', 'ja')).toBeNull();
  });
});

describe('householdRouteFailure', () => {
  it('403 means no longer a guardian, 404 means the household is gone; both resync the list', () => {
    expect(householdRouteFailure({status: 403})).toEqual({reload: true, messageKey: 'guardian.no_longer_member'});
    expect(householdRouteFailure({status: 404})).toEqual({reload: true, messageKey: 'guardian.household_gone'});
  });
  it('anything else is left to the generic error handling', () => {
    for (const e of [{status: 401}, {status: 429}, {status: 503}, {status: 409}, new Error('x'), null, undefined]) expect(householdRouteFailure(e)).toBeNull();
  });
});

describe('device heartbeat and kiosk', () => {
  it('deviceHousehold is the first household, null when there is none or the list is not loaded', () => {
    expect(deviceHousehold(null)).toBeNull();
    expect(deviceHousehold([])).toBeNull();
    expect(deviceHousehold([household({household_id: 'a'}), household({household_id: 'b'})])?.household_id).toBe('a');
  });

  it('kioskFromHousehold follows live_guard_enabled and is false without a household', () => {
    expect(kioskFromHousehold(null)).toBe(false);
    expect(kioskFromHousehold(household({live_guard_enabled: false}))).toBe(false);
    expect(kioskFromHousehold(household({live_guard_enabled: true}))).toBe(true);
  });

  it('an unlock from Settings holds for 24 hours and ignores a missing or broken value', () => {
    const now = 1_000_000;
    expect(KIOSK_UNLOCK_MS).toBe(24 * 3600 * 1000);
    expect(kioskUnlockActive(String(now + 1), now)).toBe(true);
    expect(kioskUnlockActive(String(now), now)).toBe(false);
    expect(kioskUnlockActive(String(now - 1), now)).toBe(false);
    expect(kioskUnlockActive(null, now)).toBe(false);
    expect(kioskUnlockActive('soon', now)).toBe(false);
  });
});