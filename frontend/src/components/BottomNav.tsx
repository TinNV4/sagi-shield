import React from 'react';
import {
  CreditCard,
  Home,
  LifeBuoy,
  PhoneCall,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import {useI18n} from '../i18n';
import * as speech from '../lib/speak';

export type TabType =
  | 'home'
  | 'guard'
  | 'quick'
  | 'pay'
  | 'recovery'
  | 'family'
  | 'community'
  | 'how_it_works'
  | 'settings'
  | 'guardian_view'
  | 'demo';

interface BottomNavProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  isKioskActive?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  isKioskActive = false,
}) => {
  const {t} = useI18n();

  // If kiosk mode is active, prompt specifies:
  // "Exit kiosk only via Settings with a long-press (3 s) — so it is not closed by accident."
  // BottomNav can remain minimal or hidden during Kiosk Mode!
  if (isKioskActive) {
    return null;
  }

  const navItems: {id: TabType; label: string; icon: React.FC<{className?: string}>}[] = [
    {id: 'home', label: t('nav.home'), icon: Home},
    {id: 'guard', label: t('nav.guard'), icon: PhoneCall},
    {id: 'quick', label: t('nav.quick'), icon: Search},
    {id: 'pay', label: t('nav.pay'), icon: CreditCard},
    {id: 'recovery', label: t('nav.recovery'), icon: LifeBuoy},
    {id: 'family', label: t('nav.family'), icon: Users},
    {id: 'settings', label: t('nav.settings'), icon: Settings},
  ];

  return (
    <nav
      id="bottom-navigation-bar"
      className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#122620]/95 backdrop-blur-md border-t border-emerald-950/10 dark:border-emerald-800/30 pb-safe shadow-lg"
      aria-label={t('nav.main_navigation')}
    >
      <div className="max-w-2xl mx-auto px-1 flex items-center justify-around h-16 sm:h-18">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => {
                speech.warmUp();
                onSelectTab(item.id);
              }}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition-all ${
                isActive
                  ? 'text-[#1B4D3E] dark:text-emerald-300 font-bold scale-105'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <div
                className={`p-1 rounded-xl transition-colors ${
                  isActive ? 'bg-emerald-100 dark:bg-emerald-900/50' : ''
                }`}
              >
                <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className="text-[10px] sm:text-xs tracking-tight mt-0.5 whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
