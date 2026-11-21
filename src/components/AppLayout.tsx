import {AlertTriangle, Download, LogOut, Menu, X} from 'lucide-react';
import React, {useState} from 'react';
import {Link, NavLink, useLocation} from 'react-router-dom';
import {
  APP_SECTIONS,
  BOTTOM_NAV_SECTIONS,
  CURRENT_APP_STAGE,
  type NavSection,
} from '../config/navigation';
import {useAuth} from '../context/AuthContext';
import {getStoredLastBackupAt} from '../repositories/backupRepository';
import {BrandLogo} from './BrandLogo';
import {OfflineIndicator} from './OfflineIndicator';
import {PWAInstallButton} from './PWAInstallButton';
import {SectionIcon} from './SectionIcon';

const GROUP_LABELS: Record<NavSection['group'], string> = {
  primary: 'نظرة عامة',
  operations: 'العمليات والحركة المالية',
  inventory_parties: 'الأصناف والمخازن والجهات',
  system: 'التقارير والإدارة',
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const AppLayout: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {session, companySettings, can, logout} = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);
  const location = useLocation();

  const currentSection =
    APP_SECTIONS.find((s) => s.path === location.pathname) ?? APP_SECTIONS[0];

  const lastBackupAt = companySettings?.lastBackupAt ?? getStoredLastBackupAt();
  const isBackupStale = !lastBackupAt || Date.now() - lastBackupAt >= ONE_DAY_MS;
  const showBackupReminder =
    can('backup.manage') &&
    isBackupStale &&
    !backupBannerDismissed &&
    location.pathname !== '/backup';

  const groupedSections: Array<{group: NavSection['group']; items: NavSection[]}> = [
    {group: 'primary', items: APP_SECTIONS.filter((s) => s.group === 'primary')},
    {group: 'operations', items: APP_SECTIONS.filter((s) => s.group === 'operations')},
    {
      group: 'inventory_parties',
      items: APP_SECTIONS.filter((s) => s.group === 'inventory_parties'),
    },
    {
      group: 'system',
      items: APP_SECTIONS.filter((s) => {
        if (s.group !== 'system') return false;
        if (s.path === '/users') return can('users.manage');
        return true;
      }),
    },
  ];

  const renderNavContent = (onItemClick?: () => void) => (
    <div className="flex flex-col h-full bg-[#0B1F3A] text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <BrandLogo logoDataUrl={companySettings?.logoDataUrl} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {companySettings?.companyName ?? 'نُخبة البن للتوزيع'}
            </p>
            <p className="text-xs text-[#DBBA4B] truncate">
              {session?.user.name} · {session?.role.nameAr}
            </p>
          </div>
        </div>
        {onItemClick && (
          <button
            type="button"
            onClick={onItemClick}
            aria-label="إغلاق القائمة"
            className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groupedSections.map((groupBlock) => (
          <div key={groupBlock.group}>
            <p className="px-3 mb-2 text-xs font-semibold text-slate-400">
              {GROUP_LABELS[groupBlock.group]}
            </p>
            <ul className="space-y-1">
              {groupBlock.items.map((item) => {
                const isLockedByPermission =
                  item.requiredPermission && !can(item.requiredPermission);
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={onItemClick}
                      className={({isActive}) =>
                        `min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-[#C9A227] text-[#0B1F3A]'
                            : 'text-slate-100 hover:bg-white/10'
                        }`
                      }
                    >
                      {({isActive}) => (
                        <>
                          <span className="flex items-center gap-3 min-w-0">
                            <SectionIcon
                              name={item.iconName}
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-[#0B1F3A]' : 'text-[#DBBA4B]'
                              }`}
                            />
                            <span className="truncate">{item.titleAr}</span>
                          </span>
                          {item.implementedInStage > CURRENT_APP_STAGE && (
                            <span
                              className={`text-[11px] font-medium shrink-0 ${
                                isActive ? 'text-[#0B1F3A]/80' : 'text-slate-400'
                              }`}
                            >
                              م{item.implementedInStage}
                            </span>
                          )}
                          {isLockedByPermission &&
                            item.implementedInStage <= CURRENT_APP_STAGE && (
                            <span className="text-[11px] font-medium text-amber-300 shrink-0">
                              مقيد
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <button
          type="button"
          onClick={() => {
            onItemClick?.();
            void logout();
          }}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold text-white transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 text-[#DBBA4B]" />
          <span>تبديل المستخدم / خروج</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Persistent Sidebar */}
      <aside className="no-print hidden lg:block lg:w-72 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen border-l border-slate-200">
        {renderNavContent()}
      </aside>

      {/* Mobile Slide-out Drawer */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/55 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">
            {renderNavContent(() => setDrawerOpen(false))}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 h-14 bg-[#0B1F3A] text-white border-b border-[#C9A227]/30 px-3 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="فتح القائمة الجانبية"
              className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white hover:bg-white/10 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden">
              <BrandLogo logoDataUrl={companySettings?.logoDataUrl} size="sm" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white truncate">
              {currentSection.titleAr}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => void logout()}
              title="تسجيل خروج"
              className="hidden sm:flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{session?.user.name}</span>
              <span className="text-[#DBBA4B]">·</span>
              <span className="text-slate-300">{session?.role.nameAr}</span>
              <LogOut className="w-3.5 h-3.5 text-[#DBBA4B] ms-1" />
            </button>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8">
          {showBackupReminder && (
            <div
              role="region"
              aria-label="تذكير النسخ الاحتياطي اليومي"
              className="no-print mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-950">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">تذكير النسخ الاحتياطي اليومي: </span>
                  <span>
                    {lastBackupAt
                      ? 'مرّ أكثر من 24 ساعة على آخر نسخة احتياطية محفوظة.'
                      : 'لم يتم أخذ أي نسخة احتياطية للبيانات المحلية حتى الآن.'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to="/backup"
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-3.5 text-xs font-bold text-white hover:bg-[#133159]"
                >
                  <Download className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>نسخ احتياطي الآن</span>
                </Link>
                <button
                  type="button"
                  aria-label="إخفاء التذكير"
                  onClick={() => setBackupBannerDismissed(true)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-amber-300 text-amber-900 hover:bg-amber-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="التنقل السريع"
        className="no-print fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-5 h-16 items-center">
          {BOTTOM_NAV_SECTIONS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({isActive}) =>
                `min-h-[48px] flex flex-col items-center justify-center gap-1 px-1 transition-colors ${
                  isActive ? 'text-[#0B1F3A]' : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {({isActive}) => (
                <>
                  <div
                    className={`flex items-center justify-center rounded-xl px-3 py-1 transition-colors ${
                      isActive ? 'bg-[#0B1F3A] text-[#C9A227]' : ''
                    }`}
                  >
                    <SectionIcon name={tab.iconName} className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-[11px] leading-none truncate max-w-full ${
                      isActive ? 'font-bold text-[#0B1F3A]' : 'font-medium'
                    }`}
                  >
                    {tab.shortTitleAr}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
};
