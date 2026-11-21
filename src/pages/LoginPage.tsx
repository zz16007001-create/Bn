import {Delete, KeyRound, ShieldCheck, UserPlus} from 'lucide-react';
import React, {useEffect, useState} from 'react';
import {BrandLogo} from '../components/BrandLogo';
import {PWAInstallButton} from '../components/PWAInstallButton';
import {useAuth} from '../context/AuthContext';
import {authRepository, type LoginUserSummary} from '../repositories/authRepository';

export const LoginPage: React.FC = () => {
  const {hasUsers, companySettings, setupInitialAdmin, loginWithPin} = useAuth();

  // First-run setup state
  const [companyName, setCompanyName] = useState(
    companySettings?.companyName ?? 'نُخبة البن للتوزيع'
  );
  const [adminName, setAdminName] = useState('');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [setupPin, setSetupPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // Standard login state
  const [usersList, setUsersList] = useState<LoginUserSummary[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (companySettings?.companyName) {
      setCompanyName(companySettings.companyName);
    }
  }, [companySettings]);

  useEffect(() => {
    if (!hasUsers) return;
    let active = true;
    void authRepository.listActiveUsersForLogin().then((list) => {
      if (!active) return;
      setUsersList(list);
      if (list.length > 0 && !identifier) {
        setIdentifier(list[0].username);
      }
    });
    return () => {
      active = false;
    };
  }, [hasUsers, identifier]);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupPin !== confirmPin) {
      setError('رمز PIN وتأكيده غير متطابقين.');
      return;
    }
    setSubmitting(true);
    try {
      await setupInitialAdmin({
        name: adminName,
        username: adminUsername,
        pin: setupPin,
        companyName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تهيئة النظام.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPin(identifier, pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const appendDigit = (digit: string) => {
    if (pin.length >= 8) return;
    setError(null);
    setPin((prev) => prev + digit);
  };

  const handleBackspace = () => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  return (
    <div className="min-h-screen bg-[#0B1F3A] flex flex-col justify-between px-4 py-6 sm:px-6">
      <div className="w-full max-w-md mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandLogo logoDataUrl={companySettings?.logoDataUrl} size="sm" />
          <span className="text-sm font-bold text-white">
            {companySettings?.companyName ?? 'نُخبة البن للتوزيع'}
          </span>
        </div>
        <PWAInstallButton />
      </div>

      <main className="w-full max-w-md mx-auto my-6">
        <div className="rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-slate-200">
          {!hasUsers ? (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="h-12 w-12 rounded-2xl bg-[#0B1F3A] text-[#C9A227] flex items-center justify-center shrink-0">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[#0B1F3A]">تهيئة النظام لأول مرة</h1>
                  <p className="text-xs text-slate-600 mt-0.5">
                    إنشاء حساب مدير النظام وتجهيز قاعدة البيانات المحلية
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-800"
                >
                  {error}
                </div>
              )}

              <form onSubmit={(e) => void handleSetupSubmit(e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    اسم الشركة
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="مثال: شركة نُخبة البن للتوزيع"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    الاسم الكامل لمدير النظام
                  </label>
                  <input
                    type="text"
                    required
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="مثال: أحمد محمود"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    اسم الدخول
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 text-left focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                      رمز PIN (4–8 أرقام)
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="\d{4,8}"
                      maxLength={8}
                      required
                      dir="ltr"
                      value={setupPin}
                      onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-center text-lg font-bold tracking-widest tabular-nums focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                      تأكيد PIN
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="\d{4,8}"
                      maxLength={8}
                      required
                      dir="ltr"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-center text-lg font-bold tracking-widest tabular-nums focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0B1F3A] text-white text-base font-bold hover:bg-[#133159] active:scale-[0.99] transition-all disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5 text-[#C9A227]" />
                  <span>{submitting ? 'جارٍ التهيئة...' : 'بدء النظام وإنشاء المدير'}</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="h-12 w-12 rounded-2xl bg-[#0B1F3A] text-[#C9A227] flex items-center justify-center shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[#0B1F3A]">تسجيل الدخول</h1>
                  <p className="text-xs text-slate-600 mt-0.5">
                    اختر حسابك أو أدخل الاسم ثم رمز PIN
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-800"
                >
                  {error}
                </div>
              )}

              <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
                {usersList.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-2">الحسابات المتاحة</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {usersList.map((u) => {
                        const selected =
                          identifier.toLowerCase() === u.username.toLowerCase() ||
                          identifier === u.name;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setIdentifier(u.username);
                              setError(null);
                            }}
                            className={`min-h-[48px] px-3 py-2 rounded-xl border text-right transition-all cursor-pointer ${
                              selected
                                ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                                : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-[#C9A227]'
                            }`}
                          >
                            <div className="text-sm font-bold truncate">{u.name}</div>
                            <div
                              className={`text-[11px] truncate ${
                                selected ? 'text-[#DBBA4B]' : 'text-slate-500'
                              }`}
                            >
                              {u.roleNameAr}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    اسم المستخدم أو الاسم
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="أدخل اسم الدخول"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    رمز PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    required
                    dir="ltr"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3.5 text-center text-xl font-bold tracking-[0.4em] tabular-nums bg-slate-50 focus:border-[#0B1F3A] focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]/20"
                  />
                </div>

                {/* Touch-friendly mobile PIN keypad */}
                <div className="grid grid-cols-3 gap-2 pt-1" dir="ltr">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => appendDigit(digit)}
                      className="min-h-[48px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-lg font-bold text-[#0B1F3A] tabular-nums transition-colors cursor-pointer"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPin('')}
                    className="min-h-[48px] rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                  >
                    مسح
                  </button>
                  <button
                    type="button"
                    onClick={() => appendDigit('0')}
                    className="min-h-[48px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-lg font-bold text-[#0B1F3A] tabular-nums transition-colors cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleBackspace}
                    aria-label="حذف رقم"
                    className="min-h-[48px] rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !pin}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0B1F3A] text-white text-base font-bold hover:bg-[#133159] active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'جارٍ التحقق...' : 'دخول للنظام'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      <footer className="w-full max-w-md mx-auto text-center text-xs text-slate-300">
        نظام مالي ومخزني محلي · جميع المبالغ بالجنيه المصري (ج.م)
      </footer>
    </div>
  );
};
