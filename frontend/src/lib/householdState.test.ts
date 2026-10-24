import {describe, expect, it} from 'vitest';
import type {Household} from '../api/types';
import type {AuthUser} from './auth';
import {
  formatPairCode,
  deviceHousehold,
  cardSteps,
  deviceStatusLabel,
  guardianRows,
  guardianScreenState,
  householdLabel,
  householdRouteFailure,
  isSystemAlert,
  kioskDecision,
  kioskFromHousehold,
  normalizePairCode,
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
describe('deviceStatusLabel', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  it('is none when no device is paired, whatever the status says', () => {
    expect(deviceStatusLabel(undefined, now, 0, true)).toEqual({kind: 'none'});
    expect(deviceStatusLabel({last_seen: null, listening: false}, now, 0, false)).toEqual({kind: 'none'});
  });

  it('is paired when a device joined but never sent a heartbeat (or an unreadable one)', () => {
    expect(deviceStatusLabel(undefined, now, 1, true)).toEqual({kind: 'paired'});
    expect(deviceStatusLabel({last_seen: null, listening: false}, now, 2, false)).toEqual({kind: 'paired'});
    expect(deviceStatusLabel({last_seen: 'garbage', listening: true}, now, 1, true)).toEqual({kind: 'paired'});
  });

  it('is listening while a listening heartbeat is fresh (a few missed beats are tolerated)', () => {
    const at = ago(2 * MIN);
    expect(deviceStatusLabel({last_seen: at, listening: true}, now, 1, true)).toEqual({kind: 'listening', at});
    expect(deviceStatusLabel({last_seen: ago(10 * MIN), listening: true}, now, 1, true).kind).toBe('listening');
  });

  it('a stale listening heartbeat is only "seen"', () => {
    const at = ago(11 * MIN);
    expect(deviceStatusLabel({last_seen: at, listening: true}, now, 1, true)).toEqual({kind: 'seen', at});
  });

  it('is seen up to and including 24 h, offline beyond', () => {
    expect(deviceStatusLabel({last_seen: ago(5 * HOUR), listening: false}, now, 1, true).kind).toBe('seen');
    expect(deviceStatusLabel({last_seen: ago(24 * HOUR), listening: false}, now, 1, true).kind).toBe('seen');
    const at = ago(24 * HOUR + 1);
    expect(deviceStatusLabel({last_seen: at, listening: false}, now, 1, true)).toEqual({kind: 'offline', at});
    expect(deviceStatusLabel({last_seen: ago(3 * 24 * HOUR), listening: true}, now, 1, true).kind).toBe('offline');
  });

  it('with Live Guard off an old heartbeat is not an outage: it stays "seen" with its time', () => {
    const at = ago(3 * 24 * HOUR);
    expect(deviceStatusLabel({last_seen: at, listening: false}, now, 1, false)).toEqual({kind: 'seen', at});
  });

  it('a heartbeat from a device that was since unpaired is none (devices is the truth)', () => {
    expect(deviceStatusLabel({last_seen: ago(MIN), listening: true}, now, 0, true)).toEqual({kind: 'none'});
  });

  it('a future timestamp counts as fresh, never a crash', () => {
    expect(deviceStatusLabel({last_seen: ago(-MIN), listening: false}, now, 1, true).kind).toBe('seen');
  });
});

describe('isSystemAlert', () => {
  it('the offline sweep notice is a system notice, scam alerts are not', () => {
    expect(isSystemAlert({scam_type: 'device_offline'})).toBe(true);
    for (const t of ['fake_police', 'unknown', 'safe', '']) expect(isSystemAlert({scam_type: t})).toBe(false);
  });
});

describe('kioskDecision', () => {
  const now = 1_000_000;
  const device = user({anonymous: true});
  const on = household({live_guard_enabled: true});
  const off = household({live_guard_enabled: false});
  const base = {user: device, household: on as Household | null, kioskOn: false, fromHousehold: false, unlockedUntil: null as string | null, now};

  it('a guardian browser (or no user) is never switched', () => {
    expect(kioskDecision({...base, user: user()})).toBe('keep');
    expect(kioskDecision({...base, user: null})).toBe('keep');
    expect(kioskDecision({...base, user: user(), household: off, kioskOn: true, fromHousehold: true})).toBe('keep');
  });

  it('a kiosk left in Settings during the last 24 h is kept as it is', () => {
    expect(kioskDecision({...base, unlockedUntil: String(now + 1)})).toBe('keep');
  });

  it('household on + kiosk off turns kiosk on; already on is kept', () => {
    expect(kioskDecision(base)).toBe('on');
    expect(kioskDecision({...base, unlockedUntil: String(now - 1)})).toBe('on');
    expect(kioskDecision({...base, kioskOn: true})).toBe('keep');
  });

  it('household off turns off only a kiosk the household turned on (also when the device left its household)', () => {
    expect(kioskDecision({...base, household: off, kioskOn: true, fromHousehold: true})).toBe('off');
    expect(kioskDecision({...base, household: null, kioskOn: true, fromHousehold: true})).toBe('off');
  });

  it('household off never touches a kiosk the person chose themselves', () => {
    expect(kioskDecision({...base, household: off, kioskOn: true, fromHousehold: false})).toBe('keep');
    expect(kioskDecision({...base, household: off, kioskOn: false, fromHousehold: false})).toBe('keep');
  });
});

describe('cardSteps', () => {
  it('lists open, code, charger without Live Guard', () => {
    expect(cardSteps(false)).toEqual(['card.step_open', 'card.step_code', 'card.step_charger']);
  });

  it('adds the microphone step before the charger with Live Guard', () => {
    expect(cardSteps(true)).toEqual(['card.step_open', 'card.step_code', 'card.step_mic', 'card.step_charger']);
  });
});

describe('memberScreenState: joining by code', () => {
  const base = {uid: 'dev', households: [] as Household[], failed: false};

  it('joinChosen opens the join view with the pre-filled code', () => {
    expect(memberScreenState({...base, joinChosen: true})).toEqual({kind: 'join'});
    expect(memberScreenState({...base, joinChosen: false})).toEqual({kind: 'create'});
  });

  it('a device that already has a household never gets the join view', () => {
    expect(memberScreenState({...base, households: [household()], joinChosen: true}).kind).toBe('household');
  });

  it('loading, errors and guardian sessions win over the join choice', () => {
    expect(memberScreenState({...base, households: null, joinChosen: true}).kind).toBe('loading');
    expect(memberScreenState({...base, failed: true, joinChosen: true}).kind).toBe('error');
    expect(memberScreenState({...base, guardianSession: true, joinChosen: true}).kind).toBe('guardian_session');
  });
});

describe('normalizePairCode', () => {
  it('keeps digits only, turns full-width digits into ASCII and stops at six', () => {
    expect(normalizePairCode('123-456')).toBe('123456');
    expect(normalizePairCode('１２３ ４５６７')).toBe('123456');
    expect(normalizePairCode('ab12')).toBe('12');
  });
});
