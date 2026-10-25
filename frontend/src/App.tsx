import React, {Suspense, lazy, useEffect, useRef, useState} from 'react';
import {ADMIN_FROM_LINK, api, GUARDIAN_FROM_PUSH, JOIN_FROM_LINK, mockApiInstance, PAIR_FROM_LINK, SHARE_FROM_LINK} from './api/client';
import {readShareInbox, toCheckInput, type ShareCheckInput} from './lib/shareInbox';
import {CheckResult} from './api/types';
import {BottomNav, TabType} from './components/BottomNav';
import {DemoHelperModal} from './components/DemoHelperModal';
import {Header} from './components/Header';
import {OnboardingModal} from './components/OnboardingModal';
import {I18nProvider, useI18n} from './i18n';
import {currentUser, onAuth, type AuthUser} from './lib/auth';
import {afterResultTarget, deviceHousehold, kioskDecision, KIOSK_UNLOCK_MS} from './lib/householdState';
import * as speech from './lib/speak';
import {HomeScreen} from './pages/HomeScreen';
import {LiveGuardScreen} from './pages/LiveGuardScreen';
import type {CheckInput} from './pages/QuickCheckScreen';
import type {CardCode} from './pages/SetupCardScreen';
import type {Household} from './api/types';

// Home and Live Guard load with the shell (a kiosk tablet opens straight into the guard); every other screen is its
// own chunk, fetched on first visit and precached by the service worker, so the first paint on an old tablet is
// not paying for the charts of the Community screen. Each page module exports one named component.
const AdminScreen = lazy(() => import('./pages/AdminScreen').then((m) => ({default: m.AdminScreen})));
const BeforeYouPayScreen = lazy(() => import('./pages/BeforeYouPayScreen').then((m) => ({default: m.BeforeYouPayScreen})));
const CommunityScreen = lazy(() => import('./pages/CommunityScreen').then((m) => ({default: m.CommunityScreen})));
const FamilyScreen = lazy(() => import('./pages/FamilyScreen').then((m) => ({default: m.FamilyScreen})));
const GuardianViewScreen = lazy(() => import('./pages/GuardianViewScreen').then((m) => ({default: m.GuardianViewScreen})));
const HowItWorksScreen = lazy(() => import('./pages/HowItWorksScreen').then((m) => ({default: m.HowItWorksScreen})));
const QuickCheckScreen = lazy(() => import('./pages/QuickCheckScreen').then((m) => ({default: m.QuickCheckScreen})));
const RecoveryScreen = lazy(() => import('./pages/RecoveryScreen').then((m) => ({default: m.RecoveryScreen})));
const ResultScreen = lazy(() => import('./pages/ResultScreen').then((m) => ({default: m.ResultScreen})));
const SetupCardScreen = lazy(() => import('./pages/SetupCardScreen').then((m) => ({default: m.SetupCardScreen})));
const SettingsScreen = lazy(() => import('./pages/SettingsScreen').then((m) => ({default: m.SettingsScreen})));

type FullTabType = TabType | 'result';

const ScreenLoading: React.FC<{label: string}> = ({label}) => (
  <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-500 animate-fade-in" aria-busy="true">
    <p className="font-bold text-base">{label}</p>
  </div>
);

function AppContent() {
  const {lang, t} = useI18n();

  // App state with local persistence
  const [isKioskMode, setIsKioskMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sagi_kiosk_mode') === 'true';
    } catch {
      return false;
    }
  });

  const [speakEnabled, setSpeakEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sagi_speak_enabled');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const [alertGuardians, setAlertGuardians] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sagi_alert_guardians');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sagi_dark_mode');
      // Light unless the user chose dark: high contrast on white is the safer default for elderly users
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<FullTabType>(() => {
    if (ADMIN_FROM_LINK) return 'admin'; // /#admin: the pilot overview (the server decides who may read it)
    if (PAIR_FROM_LINK || GUARDIAN_FROM_PUSH) return 'guardian_view'; // a family member's QR code, or an alert notification
    if (SHARE_FROM_LINK) return 'quick'; // the OS share sheet handed a screenshot or text over
    if (JOIN_FROM_LINK) return 'family'; // the setup card's QR, scanned on the protected person's own device
    // If kiosk mode is active, opening goes straight to Live Guard!
    try {
      if (localStorage.getItem('sagi_kiosk_mode') === 'true') {
        return 'guard';
      }
      if (window.location.pathname.includes('demo') || window.location.hash.includes('demo')) {
        return 'home';
      }
    } catch {}
    return 'home';
  });

  const [navHistory, setNavHistory] = useState<FullTabType[]>([]);
  // the household whose setup card is open (and the code just issued for it, if any)
  const [cardTarget, setCardTarget] = useState<{household: Household; code?: CardCode} | null>(null);
  // shared from another app: read once from the share inbox, then handed to Quick Check
  const [sharedInput, setSharedInput] = useState<ShareCheckInput | null>(null);
  useEffect(() => {
    if (!SHARE_FROM_LINK) return;
    // nothing readable still hands Quick Check an empty input, so it says so instead of showing a blank screen
    readShareInbox()
      .then((shared) => setSharedInput(shared ? toCheckInput(shared) : {text: '', images: [], rejected: []}))
      .catch(() => setSharedInput({text: '', images: [], rejected: []}));
  }, []);
  const [activeCheckResult, setActiveCheckResult] = useState<CheckResult | null>(null);
  const [activeCheckInput, setActiveCheckInput] = useState<CheckInput>({});
  const [isDemoHelperOpen, setIsDemoHelperOpen] = useState<boolean>(() => {
    return window.location.pathname.includes('demo') || window.location.hash.includes('demo');
  });
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
    if (PAIR_FROM_LINK || GUARDIAN_FROM_PUSH || JOIN_FROM_LINK || SHARE_FROM_LINK || ADMIN_FROM_LINK) return false; // a guardian came to pair or to read an alert, not to set up a kiosk
    try {
      return localStorage.getItem('sagi_onboarding_completed') !== 'true';
    } catch {
      return false;
    }
  });

  // Apply dark mode class to <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('sagi_dark_mode', String(darkMode));
    } catch {}
  }, [darkMode]);

  // Global warm up on first touch/click
  useEffect(() => {
    const handleFirstGesture = () => {
      speech.warmUp();
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
    window.addEventListener('pointerdown', handleFirstGesture);
    window.addEventListener('keydown', handleFirstGesture);
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, []);

  const navigateTo = (tab: FullTabType) => {
    speech.warmUp();
    setNavHistory((prev) => [...prev, currentTab]);
    setCurrentTab(tab);
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  // An alert notification clicked while the app is already open (public/push-sw.js): switch to the dashboard
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'sagi:open-guardian') setCurrentTab('guardian_view');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const handleGoBack = () => {
    speech.warmUp();
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory((h) => h.slice(0, -1));
      setCurrentTab(prev);
    } else {
      setCurrentTab('home');
    }
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  // A check that came in through the OS share sheet ends back in Live Guard on a kiosk device (the guard restarts as it
  // does for kiosk mode), otherwise at Home; any other check goes back the usual way.
  const handleResultBack = () => {
    if (!SHARE_FROM_LINK) return handleGoBack();
    speech.warmUp();
    setNavHistory([]);
    setCurrentTab(afterResultTarget({kioskMode: isKioskMode, cameFromShare: true}));
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const handleSetKioskMode = (enabled: boolean) => {
    setIsKioskMode(enabled);
    try {
      localStorage.setItem('sagi_kiosk_mode', String(enabled));
    } catch {}
    if (enabled) {
      setCurrentTab('guard');
    }
  };

  // A kiosk the person chose (onboarding, Settings) is theirs: `sagi_kiosk_user_chosen` is set while it is on, and
  // kioskDecision then neither turns it off with the household's switch nor marks it as the household's.
  const handleUserKioskMode = (enabled: boolean) => {
    try {
      localStorage.removeItem('sagi_kiosk_from_household');
      if (enabled) localStorage.setItem('sagi_kiosk_user_chosen', '1');
      else localStorage.removeItem('sagi_kiosk_user_chosen');
    } catch {}
    handleSetKioskMode(enabled);
  };

  // Leaving kiosk mode in Settings holds against the household's switch for 24 h (a visit, a repair); turning it on clears it.
  const handleSettingsKioskMode = (enabled: boolean) => {
    try {
      if (enabled) localStorage.removeItem('sagi_kiosk_unlocked_until');
      else localStorage.setItem('sagi_kiosk_unlocked_until', String(Date.now() + KIOSK_UNLOCK_MS));
    } catch {}
    handleUserKioskMode(enabled);
  };

  // The household's Live Guard switch drives this device's kiosk mode (kioskDecision): at start-up, right after
  // joining, and whenever the app comes back to the foreground. 'on' is the onboarding's kiosk path and records that
  // the household turned it on (`sagi_kiosk_from_household`), so switching Live Guard off later can undo exactly that.
  // The screen moves only when kiosk actually turns on from off.
  const authUserRef = useRef<AuthUser | null>(null);
  const applyHouseholdKiosk = (household: Household | null) => {
    let kioskOn = false;
    let fromHousehold = false;
    let userChosen = false;
    let unlockedUntil: string | null = null;
    try {
      kioskOn = localStorage.getItem('sagi_kiosk_mode') === 'true';
      fromHousehold = localStorage.getItem('sagi_kiosk_from_household') === '1';
      userChosen = localStorage.getItem('sagi_kiosk_user_chosen') === '1';
      unlockedUntil = localStorage.getItem('sagi_kiosk_unlocked_until');
    } catch {}
    const decision = kioskDecision({user: authUserRef.current ?? currentUser(), household, kioskOn, fromHousehold, userChosen, unlockedUntil, now: Date.now()});
    if (decision === 'on') {
      setIsOnboardingOpen(false);
      handleSetKioskMode(true);
      try {
        localStorage.setItem('sagi_kiosk_from_household', '1');
      } catch {}
    } else if (decision === 'mark') {
      try {
        localStorage.setItem('sagi_kiosk_from_household', '1');
      } catch {}
    } else if (decision === 'off') {
      setIsKioskMode(false);
      try {
        localStorage.setItem('sagi_kiosk_mode', 'false');
        localStorage.removeItem('sagi_kiosk_from_household');
      } catch {}
    }
  };
  const applyHouseholdKioskRef = useRef(applyHouseholdKiosk);
  applyHouseholdKioskRef.current = applyHouseholdKiosk;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const recheck = () => {
      if (inFlight || !(authUserRef.current ?? currentUser())?.anonymous) return;
      inFlight = true;
      api
        .myHouseholds()
        .then((households) => {
          if (!cancelled) applyHouseholdKioskRef.current(deviceHousehold(households));
        })
        .catch(() => {}) // a failed check changes nothing; the next foregrounding tries again
        .finally(() => {
          inFlight = false;
        });
    };
    // a guardian who came to pair or to read an alert, or a share, does not set up a kiosk on the first look
    let firstCheckDone = Boolean(PAIR_FROM_LINK || GUARDIAN_FROM_PUSH || JOIN_FROM_LINK || SHARE_FROM_LINK || ADMIN_FROM_LINK);
    const off = onAuth((user) => {
      authUserRef.current = user;
      if (firstCheckDone || !user?.anonymous) return;
      firstCheckDone = true;
      recheck();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleToggleSpeak = (enabled: boolean) => {
    setSpeakEnabled(enabled);
    try {
      localStorage.setItem('sagi_speak_enabled', String(enabled));
    } catch {}
  };

  const handleToggleAlertGuardians = (enabled: boolean) => {
    setAlertGuardians(enabled);
    try {
      localStorage.setItem('sagi_alert_guardians', String(enabled));
    } catch {}
  };

  // Demo Helper Triggers (Follow-up 5)
  const handleTriggerHighRiskLive = () => {
    speech.warmUp();
    navigateTo('guard');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('sagi-demo-action', { detail: { action: 'high_risk' } }));
    }, 200);
  };

  const handleTriggerGuardianAlert = () => {
    speech.warmUp();
    if ('addMockAlert' in mockApiInstance) {
      (mockApiInstance as any).addMockAlert({
        id: 'alert-' + Date.now(),
        created_at: new Date().toISOString(),
        member_name: t('demo.mock_alert_mother'),
        risk_level: 'HIGH',
        scam_type: 'fake_police',
        stage: 5,
        summary: t('demo.mock_alert_summary'),
        phone_tel: '090-1234-5678',
      });
    }
    navigateTo('guardian_view');
  };

  const handleTriggerSessionReset = () => {
    speech.warmUp();
    navigateTo('guard');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('sagi-demo-action', { detail: { action: 'reset' } }));
    }, 200);
  };

  const handleOnboardingComplete = (mode: 'kiosk' | 'individual') => {
    setIsOnboardingOpen(false);
    if (mode === 'kiosk') {
      handleUserKioskMode(true);
    } else {
      handleUserKioskMode(false);
      navigateTo('home');
    }
  };

  return (
    <div
      id="app-root-container"
      className="min-h-screen flex flex-col bg-[#F7F9F8] dark:bg-[#0E1A16] text-gray-900 dark:text-gray-100 font-sans transition-colors selection:bg-emerald-200"
    >
      {/* Top Header (Shown in all views except full takeover) */}
      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        onOpenDemoHelper={() => setIsDemoHelperOpen(true)}
        onNavigateHome={() => navigateTo('home')}
      />

      {/* Main Content Area */}
      <main className={`flex-1 ${!isKioskMode ? 'pb-24' : 'pb-6'} pt-2`}>
       <Suspense fallback={<ScreenLoading label={t('common.loading')} />}>
        {currentTab === 'home' && (
          <HomeScreen onNavigate={(tab) => navigateTo(tab)} />
        )}

        {currentTab === 'guard' && (
          <LiveGuardScreen
            isKioskMode={isKioskMode}
            onExitKioskRequest={() => navigateTo('settings')}
            speakEnabled={speakEnabled}
          />
        )}

        {currentTab === 'quick' && (
          <QuickCheckScreen
            initialInput={sharedInput}
            onCheckCompleted={(result, input) => {
              setActiveCheckResult(result);
              setActiveCheckInput(input);
              navigateTo('result');
            }}
          />
        )}

        {currentTab === 'pay' && (
          <BeforeYouPayScreen
            onPrecheckCompleted={(result) => {
              setActiveCheckResult(result);
              setActiveCheckInput({});
              navigateTo('result');
            }}
            onCancel={() => navigateTo('home')}
          />
        )}

        {currentTab === 'result' && activeCheckResult && (
          <ResultScreen
            result={activeCheckResult}
            checkInput={activeCheckInput}
            onBack={handleResultBack}
            onGoRecovery={() => navigateTo('recovery')}
            onNotifyFamily={() => {
              api.notifyMyHousehold(activeCheckResult, lang).catch(() => {});
              navigateTo('family');
            }}
          />
        )}

        {currentTab === 'recovery' && (
          <RecoveryScreen onBack={handleGoBack} />
        )}

        {currentTab === 'family' && (
          <FamilyScreen
            onOpenGuardianView={() => navigateTo('guardian_view')}
            onJoined={(household) => applyHouseholdKiosk(household)}
            alertOnHigh={alertGuardians}
            onToggleAlertOnHigh={handleToggleAlertGuardians}
          />
        )}

        {currentTab === 'guardian_view' && (
          <GuardianViewScreen
            onBack={() => navigateTo('family')}
            initialSelectedId={cardTarget?.household.household_id ?? null}
            onOpenCard={(household, code) => {
              setCardTarget({household, code});
              navigateTo('setup_card');
            }}
          />
        )}

        {currentTab === 'setup_card' && cardTarget && (
          <SetupCardScreen household={cardTarget.household} initialCode={cardTarget.code} onBack={handleGoBack} />
        )}

        {currentTab === 'community' && (
          <CommunityScreen />
        )}

        {currentTab === 'how_it_works' && (
          <HowItWorksScreen onBack={handleGoBack} />
        )}

        {currentTab === 'admin' && <AdminScreen onBack={handleGoBack} />}

        {currentTab === 'settings' && (
          <SettingsScreen
            onOpenAdmin={() => navigateTo('admin')}
            isKioskMode={isKioskMode}
            onSetKioskMode={handleSettingsKioskMode}
            speakEnabled={speakEnabled}
            onToggleSpeak={handleToggleSpeak}
            alertGuardians={alertGuardians}
            onToggleAlertGuardians={handleToggleAlertGuardians}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((prev) => !prev)}
            onExitKioskConfirm={() => navigateTo('home')}
            onReplayOnboarding={() => setIsOnboardingOpen(true)}
          />
        )}
       </Suspense>
      </main>

      {/* Bottom Navigation Bar (Hidden in Kiosk Mode for clean elderly tablet station) */}
      <BottomNav
        currentTab={currentTab as TabType}
        onSelectTab={(tab) => navigateTo(tab)}
        isKioskActive={isKioskMode}
      />

      {/* Demo Helper Modal (Trigger pitch video events easily) */}
      <DemoHelperModal
        isOpen={isDemoHelperOpen}
        onClose={() => setIsDemoHelperOpen(false)}
        onTriggerHighRiskLive={handleTriggerHighRiskLive}
        onTriggerGuardianAlert={handleTriggerGuardianAlert}
        onTriggerSessionReset={handleTriggerSessionReset}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
      />

      {/* 3-Screen Onboarding Sequence (First app load & re-playable) */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
