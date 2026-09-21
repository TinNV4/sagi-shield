import React, {useEffect, useState} from 'react';
import {api, mockApiInstance} from './api/client';
import {CheckResult} from './api/types';
import {BottomNav, TabType} from './components/BottomNav';
import {DemoHelperModal} from './components/DemoHelperModal';
import {Header} from './components/Header';
import {OnboardingModal} from './components/OnboardingModal';
import {I18nProvider, useI18n} from './i18n';
import * as speech from './lib/speak';
import {BeforeYouPayScreen} from './pages/BeforeYouPayScreen';
import {CommunityScreen} from './pages/CommunityScreen';
import {FamilyScreen} from './pages/FamilyScreen';
import {GuardianViewScreen} from './pages/GuardianViewScreen';
import {HomeScreen} from './pages/HomeScreen';
import {HowItWorksScreen} from './pages/HowItWorksScreen';
import {LiveGuardScreen} from './pages/LiveGuardScreen';
import {QuickCheckScreen} from './pages/QuickCheckScreen';
import {RecoveryScreen} from './pages/RecoveryScreen';
import {ResultScreen} from './pages/ResultScreen';
import {SettingsScreen} from './pages/SettingsScreen';

type FullTabType = TabType | 'result';

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
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<FullTabType>(() => {
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
  const [activeCheckResult, setActiveCheckResult] = useState<CheckResult | null>(null);
  const [isDemoHelperOpen, setIsDemoHelperOpen] = useState<boolean>(() => {
    return window.location.pathname.includes('demo') || window.location.hash.includes('demo');
  });
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
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

  const handleSetKioskMode = (enabled: boolean) => {
    setIsKioskMode(enabled);
    try {
      localStorage.setItem('sagi_kiosk_mode', String(enabled));
    } catch {}
    if (enabled) {
      setCurrentTab('guard');
    }
  };

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
      handleSetKioskMode(true);
    } else {
      handleSetKioskMode(false);
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
            onCheckCompleted={(result) => {
              setActiveCheckResult(result);
              navigateTo('result');
            }}
          />
        )}

        {currentTab === 'pay' && (
          <BeforeYouPayScreen
            onPrecheckCompleted={(result) => {
              setActiveCheckResult(result);
              navigateTo('result');
            }}
            onCancel={() => navigateTo('home')}
          />
        )}

        {currentTab === 'result' && activeCheckResult && (
          <ResultScreen
            result={activeCheckResult}
            onBack={handleGoBack}
            onGoRecovery={() => navigateTo('recovery')}
            onNotifyFamily={() => {
              api.notifyFamily(activeCheckResult, lang).catch(() => {});
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
            alertOnHigh={alertGuardians}
            onToggleAlertOnHigh={handleToggleAlertGuardians}
          />
        )}

        {currentTab === 'guardian_view' && (
          <GuardianViewScreen onBack={() => navigateTo('family')} />
        )}

        {currentTab === 'community' && (
          <CommunityScreen />
        )}

        {currentTab === 'how_it_works' && (
          <HowItWorksScreen onBack={handleGoBack} />
        )}

        {currentTab === 'settings' && (
          <SettingsScreen
            isKioskMode={isKioskMode}
            onSetKioskMode={handleSetKioskMode}
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
