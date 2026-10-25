import React, {useEffect, useState} from 'react';
import {
  BarChart3,
  CreditCard,
  HelpCircle,
  Home,
  LifeBuoy,
  MoreHorizontal,
  PhoneCall,
  Search,
  Settings,
  Users,
  X,
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
  | 'setup_card'
  | 'admin'
  | 'privacy'
  | 'demo';

interface BottomNavProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  isKioskActive?: boolean;
}

type NavItem = {id: TabType; label: string; icon: React.FC<{className?: string}>};

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  isKioskActive = false,
}) => {
  const {t} = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [currentTab]);

  // If kiosk mode is active, prompt specifies:
  // "Exit kiosk only via Settings with a long-press (3 s) — so it is not closed by accident."
  // BottomNav can remain minimal or hidden during Kiosk Mode!
  if (isKioskActive) {
    return null;
  }

  // Seven labelled tabs collide on a 360 px phone: four everyday actions stay in the bar, the rest live behind "…".
  const primary: NavItem[] = [
    {id: 'home', label: t('nav.home'), icon: Home},
    {id: 'guard', label: t('nav.guard'), icon: PhoneCall},
    {id: 'quick', label: t('nav.quick'), icon: Search},
    {id: 'pay', label: t('nav.pay'), icon: CreditCard},
  ];
  const more: NavItem[] = [
    {id: 'recovery', label: t('nav.recovery'), icon: LifeBuoy},
    {id: 'family', label: t('nav.family'), icon: Users},
    {id: 'community', label: t('nav.community'), icon: BarChart3},
    {id: 'how_it_works', label: t('nav.how_it_works'), icon: HelpCircle},
    {id: 'settings', label: t('nav.settings'), icon: Settings},
  ];
  const inMore = more.some((m) => m.id === currentTab) || currentTab === 'guardian_view';

  const select = (id: TabType) => {
    speech.warmUp();
    onSelectTab(id);
    setMoreOpen(false);
  };

  const barButton = (key: string, label: string, Icon: NavItem['icon'], isActive: boolean, onClick: () => void, extra = {}) => (
    <button
      key={key}
      id={`nav-item-${key}`}
      onClick={onClick}
      className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 text-center transition-all ${
        isActive
          ? 'text-[#1B4D3E] dark:text-emerald-300 font-bold'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
      }`}
      {...extra}
    >
      <div className={`p-1 rounded-xl transition-colors ${isActive ? 'bg-emerald-100 dark:bg-emerald-900/50' : ''}`}>
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
      <span className="text-[11px] sm:text-xs tracking-tight mt-0.5 max-w-full truncate px-0.5">{label}</span>
    </button>
  );

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setMoreOpen(false)} aria-hidden="true" />
      )}
      <nav
        id="bottom-navigation-bar"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#122620]/95 backdrop-blur-md border-t border-emerald-950/10 dark:border-emerald-800/30 pb-safe shadow-lg"
        aria-label={t('nav.main_navigation')}
      >
        {moreOpen && (
          <div
            id="bottom-nav-more-sheet"
            className="max-w-2xl mx-auto px-3 pt-3 pb-2 grid grid-cols-3 gap-2 border-b border-emerald-950/10 dark:border-emerald-800/30"
          >
            {more.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-more-${item.id}`}
                  onClick={() => select(item.id)}
                  className={`flex flex-col items-center gap-1 rounded-2xl p-3 text-xs font-bold border transition ${
                    isActive
                      ? 'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-300 text-[#1B4D3E] dark:text-emerald-200'
                      : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <Icon className="w-6 h-6" />
                  <span className="text-center leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="max-w-2xl mx-auto px-1 flex items-center justify-around h-16 sm:h-18">
          {primary.map((item) => barButton(item.id, item.label, item.icon, currentTab === item.id && !moreOpen, () => select(item.id),
            {'aria-current': currentTab === item.id ? 'page' : undefined}))}
          {barButton('more', t('nav.more'), moreOpen ? X : MoreHorizontal, moreOpen || inMore, () => {
            speech.warmUp();
            setMoreOpen((v) => !v);
          }, {'aria-expanded': moreOpen, 'aria-controls': 'bottom-nav-more-sheet'})}
        </div>
      </nav>
    </>
  );
};
