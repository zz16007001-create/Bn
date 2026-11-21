import {
  AlertTriangle,
  ArrowUpLeft,
  Banknote,
  CheckCircle2,
  Lock,
  Plus,
  Receipt,
  Shield,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Vault,
} from 'lucide-react';
import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {dashboardRepository, type DashboardSummary} from '../repositories/dashboardRepository';
import type {PermissionKey} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';
import {formatEGP, fromPiastres} from '../utils/money';

interface QuickActionDef {
  title: string;
  subtitle: string;
  to: string;
  permission?: PermissionKey;
  stage: number;
}

const QUICK_ACTIONS: QuickActionDef[] = [
  {
    title: 'فاتورة مبيعات جديدة',
    subtitle: 'إصدار فاتورة فورية للمندوب من قائمة واحدة',
    to: '/sales',
    permission: 'invoice.create',
    stage: 3,
  },
  {
    title: 'الخزنة والحركة اليومية',
    subtitle: 'الرصيد الافتتاحي، الإيداع والسحب، والإقفال اليومي',
    to: '/treasury',
    stage: 4,
  },
  {
    title: 'المصروفات التشغيلية',
    subtitle: 'النقل والوقود والعمالة والإيجار وربطها بالخزنة',
    to: '/expenses',
    permission: 'expenses.manage',
    stage: 4,
  },
  {
    title: 'التقارير والأرباح',
    subtitle: 'صافي الربح والتكلفة والمبيعات وتصدير Excel / PDF',
    to: '/reports',
    permission: 'reports.profit',
    stage: 4,
  },
  {
    title: 'فواتير المبيعات',
    subtitle: 'البحث والتعديل والإلغاء وإعادة الطباعة',
    to: '/invoices',
    stage: 3,
  },
  {
    title: 'تسجيل تحصيل من عميل',
    subtitle: 'سند قبض جزئي أو كلي وتحديث الحساب',
    to: '/collections',
    permission: 'collections.manage',
    stage: 3,
  },
  {
    title: 'العملاء وكشوف الحساب',
    subtitle: 'المديونيات وكشف الحساب القابل للطباعة',
    to: '/customers',
    stage: 3,
  },
  {
    title: 'المشتريات ومرتجع الشراء',
    subtitle: 'شراء ومرتجعات ومتوسط التكلفة المرجح',
    to: '/purchases',
    permission: 'invoice.create',
    stage: 4,
  },
  {
    title: 'الأصناف والوحدات',
    subtitle: 'القطعة والكرتونة واستيراد Excel',
    to: '/items',
    stage: 2,
  },
  {
    title: 'المخازن وسجل الحركات',
    subtitle: 'التحويل والجرد ومتابعة الأرصدة',
    to: '/warehouses',
    stage: 2,
  },
  {
    title: 'الموردون وكشوف الحساب',
    subtitle: 'الدفعات والمستحقات وكشف الحساب',
    to: '/suppliers',
    stage: 2,
  },
  {
    title: 'مرتجعات المبيعات',
    subtitle: 'بضاعة صالحة للمخزن أو تالفة وتعديل الربح',
    to: '/returns',
    stage: 3,
  },
];

export const HomePage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const canSeeProfit = can('reports.profit');
  const canCreateInvoice = can('invoice.create');

  useEffect(() => {
    let active = true;
    void dashboardRepository
      .getSummary()
      .then((data) => {
        if (active) setSummary(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleActions = QUICK_ACTIONS.filter(
    (action) => !action.permission || can(action.permission)
  );
  const hiddenActionsCount = QUICK_ACTIONS.length - visibleActions.length;

  const maxChartValue = summary
    ? Math.max(
        1,
        ...summary.last7DaysSeries.map((d) =>
          Math.max(d.salesPiastres, d.collectedPiastres, d.expensesPiastres)
        )
      )
    : 1;

  return (
    <div className="space-y-6">
      {/* Primary Brand Banner + Prominent New Invoice CTA */}
      <section className="rounded-2xl bg-[#0B1F3A] text-white p-5 sm:p-7 shadow-sm border border-[#C9A227]/30">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#DBBA4B]">
              أهلاً بك، {session?.user.name} · {session?.role.nameAr}
            </p>
            <h2 className="mt-1.5 text-xl sm:text-2xl font-bold text-white">
              {companySettings?.companyName ?? 'نُخبة البن للتوزيع'}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              لوحة المتابعة اليومية: الخزنة، المصروفات، مرتجعات المشتريات، والتقارير والأرباح الفعلية.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canCreateInvoice && (
              <Link
                to="/sales"
                className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#C9A227] px-5 py-2.5 text-sm font-bold text-[#0B1F3A] hover:bg-[#DBBA4B] transition-colors whitespace-nowrap shadow-sm"
              >
                <Plus className="w-5 h-5" />
                <span>فاتورة جديدة</span>
              </Link>
            )}
            <Link
              to="/treasury"
              className="min-h-[48px] inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15 transition-colors whitespace-nowrap"
            >
              <Vault className="w-4 h-4 text-[#DBBA4B]" />
              <span>الخزنة</span>
              <ArrowUpLeft className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Primary Stage 4 KPIs Grid */}
      <section aria-label="المؤشرات المالية اليومية والعامة">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums">
          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>مبيعات اليوم</span>
              <ShoppingCart className="w-4 h-4 text-[#C9A227]" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-[#0B1F3A]">
              {loading || !summary ? '...' : formatEGP(summary.todaySalesPiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              إجمالي الفواتير: {summary?.salesInvoicesCount ?? 0}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>مشتريات اليوم</span>
              <Truck className="w-4 h-4 text-[#0B1F3A]" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-[#0B1F3A]">
              {loading || !summary
                ? '...'
                : formatEGP(summary.todayPurchasesPiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              فواتير الشراء: {summary?.purchaseInvoicesCount ?? 0}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>المبالغ المحصلة (اليوم)</span>
              <Banknote className="w-4 h-4 text-emerald-700" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-emerald-700">
              {loading || !summary
                ? '...'
                : formatEGP(summary.todayCollectedPiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              الإجمالي: {summary ? formatEGP(summary.totalCollectedPiastres, currency) : '...'}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>رصيد الخزنة</span>
              <Vault className="w-4 h-4 text-[#C9A227]" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-[#0B1F3A]">
              {loading || !summary
                ? '...'
                : formatEGP(summary.totalTreasuryPiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">الفعلي المحصّل − المدفوع</p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>مديونيات العملاء</span>
              <Users className="w-4 h-4 text-red-700" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-red-700">
              {loading || !summary
                ? '...'
                : formatEGP(summary.totalCustomersDebtPiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              المتبقي بالفواتير:{' '}
              {summary ? formatEGP(summary.totalCustomerRemainingPiastres, currency) : '...'}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>مستحقات الموردين</span>
              <Receipt className="w-4 h-4 text-[#0B1F3A]" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-[#0B1F3A]">
              {loading || !summary
                ? '...'
                : formatEGP(summary.totalSuppliersPayablePiastres, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              عدد الموردين: {summary?.suppliersCount ?? 0}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>أصناف منخفضة المخزون</span>
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="mt-2 text-lg sm:text-xl font-bold text-amber-700">
              {loading || !summary ? '...' : summary.lowStockItems.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              من أصل {summary?.itemsCount ?? 0} صنف
            </p>
          </div>

          {canSeeProfit ? (
            <div className="rounded-2xl bg-[#FAF3DC] p-4 border border-[#C9A227]">
              <div className="flex items-center justify-between text-[#0B1F3A] text-xs font-bold">
                <span>صافي الربح</span>
                <TrendingUp className="w-4 h-4 text-[#9E7B14]" />
              </div>
              <p
                className={`mt-2 text-lg sm:text-xl font-bold ${
                  (summary?.netProfitPiastres ?? 0) >= 0 ? 'text-[#0B1F3A]' : 'text-red-700'
                }`}
              >
                {loading || !summary ? '...' : formatEGP(summary.netProfitPiastres, currency)}
              </p>
              <p className="mt-1 text-xs text-slate-700">
                مجمل الربح: {summary ? formatEGP(summary.grossProfitPiastres, currency) : '...'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-4 border border-slate-200">
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>المصروفات المسجلة</span>
                <Lock className="w-4 h-4 text-slate-400" />
              </div>
              <p className="mt-2 text-lg sm:text-xl font-bold text-[#0B1F3A]">
                {loading || !summary
                  ? '...'
                  : formatEGP(summary.totalExpensesPiastres, currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">الأرباح مخفية حسب الصلاحية</p>
            </div>
          )}
        </div>
      </section>

      {/* 7-Day Visual Chart + Low Stock Alert List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold text-[#0B1F3A]">
                مؤشر آخر 7 أيام (المبيعات مقابل التحصيلات والمصروفات)
              </h3>
              <p className="text-xs text-slate-500">عرض سريع للفرق بين المبيعات والتحصيل الفعلي</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#0B1F3A]" />
                المبيعات
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-600" />
                التحصيلات
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#C9A227]" />
                المصروفات
              </span>
            </div>
          </div>

          {loading || !summary ? (
            <p className="text-sm text-slate-500 py-8 text-center">جارٍ تحميل الرسم البياني...</p>
          ) : (
            <div className="grid grid-cols-7 gap-2 items-end h-44 pt-4 border-b border-slate-200">
              {summary.last7DaysSeries.map((pt) => {
                const salesH = Math.round((pt.salesPiastres / maxChartValue) * 100);
                const colH = Math.round((pt.collectedPiastres / maxChartValue) * 100);
                const expH = Math.round((pt.expensesPiastres / maxChartValue) * 100);
                return (
                  <div
                    key={pt.date}
                    title={`${pt.label}\nمبيعات: ${fromPiastres(pt.salesPiastres)} ${currency}\nتحصيلات: ${fromPiastres(pt.collectedPiastres)} ${currency}\nمصروفات: ${fromPiastres(pt.expensesPiastres)} ${currency}`}
                    className="h-full flex flex-col justify-end items-center gap-1.5"
                  >
                    <div className="w-full flex-1 flex items-end justify-center gap-1 px-0.5">
                      <div
                        style={{height: `${Math.max(4, salesH)}%`}}
                        className="w-2.5 sm:w-3.5 rounded-t bg-[#0B1F3A]"
                      />
                      <div
                        style={{height: `${Math.max(4, colH)}%`}}
                        className="w-2.5 sm:w-3.5 rounded-t bg-emerald-600"
                      />
                      <div
                        style={{height: `${Math.max(4, expH)}%`}}
                        className="w-2.5 sm:w-3.5 rounded-t bg-[#C9A227]"
                      />
                    </div>
                    <span className="text-[10px] sm:text-xs text-slate-600 font-semibold text-center leading-tight pb-1">
                      {pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-[#0B1F3A]">تنبيهات نقص المخزون</h3>
            <Link to="/warehouses" className="text-xs font-bold text-[#9E7B14] hover:underline">
              المخازن
            </Link>
          </div>
          {loading || !summary ? (
            <p className="text-sm text-slate-500">جارٍ التحميل...</p>
          ) : summary.lowStockItems.length === 0 ? (
            <p className="text-sm text-emerald-700 font-semibold py-4">
              جميع الأصناف متوفرة فوق الحد الأدنى.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm tabular-nums">
              {summary.lowStockItems.slice(0, 6).map((item) => (
                <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500">الحد الأدنى: {item.minStockQty}</p>
                  </div>
                  <span className="font-bold text-red-700 shrink-0">{item.qty} قطعة</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Permission-Driven Action Grid */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-bold text-[#0B1F3A]">الإجراءات المتاحة لصلاحياتك</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              تظهر الأزرار هنا تلقائياً حسب صلاحيات دور ({session?.role.nameAr})
            </p>
          </div>
          {hiddenActionsCount > 0 && (
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>{hiddenActionsCount} إجراءات مخفية لعدم توفر الصلاحية</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleActions.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="min-h-[68px] flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3.5 hover:border-[#0B1F3A] hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#0B1F3A] truncate">{action.title}</div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{action.subtitle}</div>
              </div>
              <span className="text-xs font-semibold text-[#9E7B14] shrink-0">
                {action.stage <= 4 ? 'جاهز' : `مرحلة ${action.stage}`}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Two-Column Split: 5-Stage Roadmap & Real Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-[#C9A227]" />
            <h3 className="text-base font-bold text-[#0B1F3A]">خطة المراحل الخمس</h3>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="py-2.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">1. النواة، القاعدة، الدخول، والهوية</span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                مكتملة
              </span>
            </li>
            <li className="py-2.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">2. الأصناف والوحدات، المخازن، الموردون، المشتريات</span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                مكتملة
              </span>
            </li>
            <li className="py-2.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">3. المبيعات السريعة، الفواتير، العملاء، التحصيلات، المرتجعات</span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                مكتملة
              </span>
            </li>
            <li className="py-2.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">
                4. الخزنة، المصروفات، مرتجعات المشتريات، التقارير والأرباح
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                مكتملة
              </span>
            </li>
            <li className="py-2.5 flex items-center justify-between gap-2 text-slate-600">
              <span>5. التحسينات النهائية، الطباعة الحرارية، والاعتماد التشغيلي</span>
              <span className="text-xs">المرحلة القادمة</span>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <h3 className="text-base font-bold text-[#0B1F3A] mb-3">أحدث حركات سجل التدقيق</h3>
          {loading ? (
            <p className="text-sm text-slate-500">جارٍ التحميل...</p>
          ) : !summary || summary.recentAuditLogs.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد حركات مسجلة بعد.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.recentAuditLogs.map((log) => (
                <li key={log.id} className="py-2.5">
                  <div className="text-sm font-medium text-slate-900">{log.summary}</div>
                  <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-2 tabular-nums">
                    <span>{log.actorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatArabicDateTime(log.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
