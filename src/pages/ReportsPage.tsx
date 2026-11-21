import {
  BarChart3,
  FileSpreadsheet,
  Lock,
  Printer,
  Search,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import * as XLSX from 'xlsx';
import {useAuth} from '../context/AuthContext';
import {customerRepository, type CustomerWithTotals} from '../repositories/customerRepository';
import {itemRepository, type ItemWithDetails} from '../repositories/itemRepository';
import {
  reportsRepository,
  type ReportFilter,
  type ReportsBundle,
} from '../repositories/reportsRepository';
import {supplierRepository, type SupplierWithTotals} from '../repositories/supplierRepository';
import {TREASURY_SOURCE_LABELS} from '../repositories/treasuryRepository';
import type {TreasurySourceType} from '../types/domain';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres} from '../utils/money';

type ReportTab =
  | 'overview'
  | 'sales_profit'
  | 'purchases_top'
  | 'inventory'
  | 'parties_treasury';

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  purchase_in: 'شراء',
  sale_out: 'بيع',
  return_in: 'مرتجع بيع',
  return_out: 'مرتجع شراء',
  adjustment: 'تسوية جرد',
  shortage: 'عجز',
  surplus: 'زيادة',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  reversal: 'قيد عكسي',
};

export const ReportsPage: React.FC = () => {
  const {companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const canViewProfitReports = can('reports.profit');

  const [tab, setTab] = useState<ReportTab>('overview');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [itemId, setItemId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');

  const [items, setItems] = useState<ItemWithDetails[]>([]);
  const [customers, setCustomers] = useState<CustomerWithTotals[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithTotals[]>([]);
  const [bundle, setBundle] = useState<ReportsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      itemRepository.listItems({status: 'all'}),
      customerRepository.listCustomers(),
      supplierRepository.listSuppliers(),
    ]).then(([i, c, s]) => {
      setItems(i);
      setCustomers(c);
      setSuppliers(s);
    });
  }, []);

  const loadReports = useCallback(async () => {
    if (!canViewProfitReports) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filter: ReportFilter = {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        itemId: itemId || undefined,
        customerId: customerId || undefined,
        supplierId: supplierId || undefined,
        search: search || undefined,
        groupBy,
      };
      const data = await reportsRepository.generateReports(filter);
      setBundle(data);
    } finally {
      setLoading(false);
    }
  }, [canViewProfitReports, dateFrom, dateTo, itemId, customerId, supplierId, search, groupBy]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  if (!canViewProfitReports) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center max-w-lg mx-auto">
        <Lock className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[#0B1F3A]">صلاحية التقارير والأرباح غير متاحة</h2>
        <p className="mt-1 text-sm text-slate-600">
          تتضمن هذه الشاشة بيانات الأرباح والتكلفة ولا يطلع عليها إلا من لديه صلاحية تقارير الأرباح.
        </p>
      </div>
    );
  }

  const applyPreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    const today = todayISODate();
    if (preset === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (preset === 'week') {
      const dt = new Date(`${today}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 6);
      setDateFrom(dt.toISOString().slice(0, 10));
      setDateTo(today);
    } else if (preset === 'month') {
      setDateFrom(`${today.slice(0, 8)}01`);
      setDateTo(today);
    } else {
      setDateFrom('');
      setDateTo('');
    }
  };

  const handleExportExcel = () => {
    if (!bundle) return;
    const wb = XLSX.utils.book_new();

    const summaryRows = [
      {البند: 'إجمالي المبيعات (قبل المرتجع)', القيمة_جنيه: fromPiastres(bundle.kpis.grossSalesPiastres)},
      {البند: 'مرتجعات المبيعات', القيمة_جنيه: fromPiastres(bundle.kpis.salesReturnsPiastres)},
      {البند: 'صافي المبيعات', القيمة_جنيه: fromPiastres(bundle.kpis.netSalesPiastres)},
      {البند: 'المبالغ المحصلة فعلياً', القيمة_جنيه: fromPiastres(bundle.kpis.totalCollectedPiastres)},
      {البند: 'تكلفة البضاعة المباعة (COGS)', القيمة_جنيه: fromPiastres(bundle.kpis.totalCogsPiastres)},
      {البند: 'مجمل الربح', القيمة_جنيه: fromPiastres(bundle.kpis.grossProfitPiastres)},
      {البند: 'إجمالي المصروفات', القيمة_جنيه: fromPiastres(bundle.kpis.totalExpensesPiastres)},
      {البند: 'صافي الربح بعد المصروفات', القيمة_جنيه: fromPiastres(bundle.kpis.netProfitPiastres)},
      {البند: 'إجمالي المشتريات', القيمة_جنيه: fromPiastres(bundle.kpis.totalPurchasesPiastres)},
      {البند: 'رصيد الخزنة الحالي', القيمة_جنيه: fromPiastres(bundle.kpis.totalTreasuryBalancePiastres)},
      {البند: 'إجمالي مديونيات العملاء', القيمة_جنيه: fromPiastres(bundle.kpis.totalCustomersDebtPiastres)},
      {البند: 'إجمالي مستحقات الموردين', القيمة_جنيه: fromPiastres(bundle.kpis.totalSuppliersPayablePiastres)},
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'الملخص والأرباح');

    const invoiceRows = bundle.invoiceProfits.map((r) => ({
      رقم_الفاتورة: r.invoiceNumber,
      التاريخ: r.invoiceDate,
      العميل: r.customerName,
      صافي_المبيعات: fromPiastres(r.netSalesPiastres),
      المدفوع_عند_البيع: fromPiastres(r.paidAtSalePiastres),
      المتبقي: fromPiastres(r.remainingPiastres),
      التكلفة_COGS: fromPiastres(r.cogsPiastres),
      مجمل_الربح: fromPiastres(r.grossProfitPiastres),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoiceRows), 'ربح الفواتير');

    const topItemsRows = bundle.topSellingItems.map((i) => ({
      الكود: i.itemSku,
      الصنف: i.itemName,
      الكمية_المباعة_قطعة: i.netBaseQtySold,
      صافي_المبيعات: fromPiastres(i.netRevenuePiastres),
      التكلفة: fromPiastres(i.netCogsPiastres),
      الربح: fromPiastres(i.grossProfitPiastres),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topItemsRows), 'الأكثر مبيعاً');

    const customerRows = bundle.customersWithDebt.map((c) => ({
      الكود: c.code,
      العميل: c.name,
      الهاتف: c.phone,
      الرصيد_جنيه: fromPiastres(c.currentBalancePiastres),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerRows), 'أرصدة العملاء');

    const supplierRows = bundle.suppliersWithPayable.map((s) => ({
      الكود: s.code,
      المورد: s.name,
      الهاتف: s.phone,
      المستحق_جنيه: fromPiastres(s.currentBalancePiastres),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supplierRows), 'مستحقات الموردين');

    const treasuryRows = bundle.treasuryTransactions.map((t) => ({
      رقم_الحركة: t.transactionNumber,
      التاريخ: t.transactionDate,
      النوع: TREASURY_SOURCE_LABELS[t.sourceType as TreasurySourceType] ?? t.sourceType,
      الاتجاه: t.direction === 'in' ? 'وارد' : 'صادر',
      الخزنة: t.paymentMethodName,
      المبلغ: fromPiastres(t.amountPiastres),
      الرصيد_بعد: fromPiastres(t.balanceAfterPiastres),
      البيان: t.notes,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(treasuryRows), 'حركة الخزنة');

    XLSX.writeFile(wb, `تقرير-شامل-${todayISODate()}.xlsx`);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="space-y-5">
      {/* Header & Exports */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">التقارير والأرباح</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            مقارنة واضحة بين إجمالي المبيعات، المبالغ المحصلة فعلياً، تكلفة البضاعة المباعة، وصافي الربح.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!bundle}
            onClick={handleExportExcel}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>

          <button
            type="button"
            disabled={!bundle}
            onClick={handlePrintPdf}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-4 h-4 text-[#C9A227]" />
            <span>حفظ كـ PDF / طباعة</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <section className="no-print rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {id: 'today', label: 'اليوم'},
                {id: 'week', label: 'آخر 7 أيام'},
                {id: 'month', label: 'هذا الشهر'},
                {id: 'all', label: 'كل الفترات'},
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-[#0B1F3A] hover:bg-slate-100 cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {(
              [
                {id: 'daily', label: 'يومي'},
                {id: 'weekly', label: 'أسبوعي'},
                {id: 'monthly', label: 'شهري'},
              ] as const
            ).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupBy(g.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                  groupBy === g.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم فاتورة أو عميل أو صنف..."
              className="w-full min-h-[42px] rounded-xl border border-slate-300 pr-9 pl-3 text-sm"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="من تاريخ"
            className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="إلى تاريخ"
            className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
          />
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-sm"
          >
            <option value="">كل الأصناف</option>
            {items.map((i) => (
              <option key={i.item.id} value={i.item.id}>
                {i.item.name}
              </option>
            ))}
          </select>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-sm"
          >
            <option value="">كل العملاء</option>
            {customers.map((c) => (
              <option key={c.customer.id} value={c.customer.id}>
                {c.customer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-2.5 text-xs"
          >
            <option value="">كل الموردين (للمشتريات)</option>
            {suppliers.map((s) => (
              <option key={s.supplier.id} value={s.supplier.id}>
                {s.supplier.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Report Content + Print Container */}
      <div className="print-only-container space-y-5">
        {/* Print Header (visible mainly on print/PDF) */}
        <div className="hidden print:flex items-center justify-between border-b-2 border-[#0B1F3A] pb-3 mb-4">
          <div className="flex items-center gap-3">
            {companySettings?.logoDataUrl && (
              <img
                src={companySettings.logoDataUrl}
                alt="شعار الشركة"
                className="w-12 h-12 object-contain"
              />
            )}
            <div>
              <h1 className="text-xl font-bold text-[#0B1F3A]">
                {companySettings?.companyName ?? 'نُخبة البن للتوزيع'}
              </h1>
              <p className="text-xs text-slate-600">التقرير المالي والتشغيلي الشامل</p>
            </div>
          </div>
          <div className="text-xs text-slate-600 text-left tabular-nums">
            <div>تاريخ الطباعة: {todayISODate()}</div>
            <div>
              الفترة: {dateFrom || 'البداية'} — {dateTo || 'حتى اليوم'}
            </div>
          </div>
        </div>

        {/* Distinct Trio: Total Sales vs Collected Cash vs Real Net Profit */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-[#0B1F3A] text-white p-4 border border-[#C9A227]/30">
            <p className="text-xs text-slate-300">1. صافي المبيعات (فواتير الفترة − المرتجع)</p>
            <p className="mt-1.5 text-2xl font-bold text-white tabular-nums">
              {loading || !bundle
                ? '...'
                : formatEGP(bundle.kpis.netSalesPiastres, currency)}
            </p>
            <p className="mt-1 text-[11px] text-slate-300 tabular-nums">
              آجل متبقي من الفواتير:{' '}
              {bundle ? formatEGP(bundle.kpis.customerRemainingOnInvoicesPiastres, currency) : '...'}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 border border-slate-200">
            <p className="text-xs font-semibold text-slate-600">
              2. المبالغ المحصلة فعلياً (كاش دخل الخزنة)
            </p>
            <p className="mt-1.5 text-2xl font-bold text-emerald-700 tabular-nums">
              {loading || !bundle
                ? '...'
                : formatEGP(bundle.kpis.totalCollectedPiastres, currency)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              يشمل الدفعات الفورية + سندات تحصيل العملاء
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF3DC] p-4 border border-[#C9A227]">
            <p className="text-xs font-bold text-[#0B1F3A]">
              3. صافي الربح الفعلي (بعد التكلفة والمصروفات)
            </p>
            <p
              className={`mt-1.5 text-2xl font-bold tabular-nums ${
                (bundle?.kpis.netProfitPiastres ?? 0) >= 0
                  ? 'text-[#0B1F3A]'
                  : 'text-red-700'
              }`}
            >
              {loading || !bundle
                ? '...'
                : formatEGP(bundle.kpis.netProfitPiastres, currency)}
            </p>
            <p className="mt-1 text-[11px] text-slate-700 tabular-nums">
              مجمل الربح:{' '}
              {bundle ? formatEGP(bundle.kpis.grossProfitPiastres, currency) : '...'} − مصروفات:{' '}
              {bundle ? formatEGP(bundle.kpis.totalExpensesPiastres, currency) : '...'}
            </p>
          </div>
        </section>

        {/* Sub-Navigation Tabs */}
        <div className="no-print flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit">
          {(
            [
              {id: 'overview', label: 'ملخص الأرباح والمصروفات'},
              {id: 'sales_profit', label: 'المبيعات وربح كل فاتورة'},
              {id: 'purchases_top', label: 'المشتريات والأكثر مبيعاً'},
              {id: 'inventory', label: 'المخزون ومنخفض المخزون'},
              {id: 'parties_treasury', label: 'العملاء والموردون والخزنة'},
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                tab === t.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading || !bundle ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            <BarChart3 className="w-8 h-8 text-[#C9A227] mx-auto mb-2" />
            جارٍ احتساب التقارير والأرباح...
          </div>
        ) : (
          <>
            {/* Tab 1: Overview & Profit Equation */}
            {(tab === 'overview' || typeof window !== 'undefined') && (
              <div className={tab === 'overview' ? 'space-y-4' : 'hidden print:block space-y-4'}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* P&L Breakdown */}
                  <section className="rounded-2xl bg-white border border-slate-200 p-5">
                    <h3 className="text-base font-bold text-[#0B1F3A] mb-3">
                      قائمة الدخل والأرباح (متوسط التكلفة المرجح)
                    </h3>
                    <dl className="divide-y divide-slate-100 text-sm tabular-nums">
                      <div className="py-2.5 flex justify-between">
                        <dt className="text-slate-600">إجمالي المبيعات (قبل المرتجع)</dt>
                        <dd className="font-semibold">
                          {formatEGP(bundle.kpis.grossSalesPiastres, currency)}
                        </dd>
                      </div>
                      <div className="py-2.5 flex justify-between text-red-700">
                        <dt>− مرتجعات المبيعات</dt>
                        <dd className="font-semibold">
                          {formatEGP(bundle.kpis.salesReturnsPiastres, currency)}
                        </dd>
                      </div>
                      <div className="py-2.5 flex justify-between font-bold text-[#0B1F3A]">
                        <dt>= صافي المبيعات</dt>
                        <dd>{formatEGP(bundle.kpis.netSalesPiastres, currency)}</dd>
                      </div>
                      <div className="py-2.5 flex justify-between text-slate-700">
                        <dt>− تكلفة البضاعة المباعة (COGS)</dt>
                        <dd className="font-semibold">
                          {formatEGP(bundle.kpis.totalCogsPiastres, currency)}
                        </dd>
                      </div>
                      <div className="py-2.5 flex justify-between font-bold text-emerald-700">
                        <dt>= مجمل الربح</dt>
                        <dd>{formatEGP(bundle.kpis.grossProfitPiastres, currency)}</dd>
                      </div>
                      <div className="py-2.5 flex justify-between text-red-700">
                        <dt>− المصروفات التشغيلية</dt>
                        <dd className="font-semibold">
                          {formatEGP(bundle.kpis.totalExpensesPiastres, currency)}
                        </dd>
                      </div>
                      <div className="py-3 flex justify-between text-base font-bold text-[#0B1F3A] bg-[#FAF3DC] px-3 rounded-xl mt-2">
                        <dt>= صافي الربح بعد المصروفات</dt>
                        <dd>{formatEGP(bundle.kpis.netProfitPiastres, currency)}</dd>
                      </div>
                    </dl>
                  </section>

                  {/* Expenses by Category & Balances */}
                  <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                    <div>
                      <h3 className="text-base font-bold text-[#0B1F3A] mb-2">
                        توزيع المصروفات حسب التصنيف
                      </h3>
                      {bundle.expensesByCategory.length === 0 ? (
                        <p className="text-xs text-slate-500">لا توجد مصروفات في الفترة المحددة.</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 text-sm tabular-nums">
                          {bundle.expensesByCategory.map((ec) => (
                            <li key={ec.categoryName} className="py-2 flex justify-between">
                              <span>
                                {ec.categoryName}{' '}
                                <span className="text-xs text-slate-400">({ec.count})</span>
                              </span>
                              <span className="font-bold text-red-700">
                                {formatEGP(ec.totalPiastres, currency)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs tabular-nums">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-slate-500">مديونيات العملاء الحالية</p>
                        <p className="mt-1 text-base font-bold text-[#0B1F3A]">
                          {formatEGP(bundle.kpis.totalCustomersDebtPiastres, currency)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-slate-500">مستحقات الموردين الحالية</p>
                        <p className="mt-1 text-base font-bold text-[#0B1F3A]">
                          {formatEGP(bundle.kpis.totalSuppliersPayablePiastres, currency)}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* Tab 2: Sales by Period & Profit per Invoice */}
            {tab === 'sales_profit' && (
              <div className="space-y-4">
                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      تجميع المبيعات ({groupBy === 'daily' ? 'يومي' : groupBy === 'weekly' ? 'أسبوعي' : 'شهري'})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">الفترة</th>
                          <th className="py-2.5 px-4">عدد الفواتير</th>
                          <th className="py-2.5 px-4">صافي المبيعات</th>
                          <th className="py-2.5 px-4">التكلفة</th>
                          <th className="py-2.5 px-4">مجمل الربح</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.salesByPeriod.map((b) => (
                          <tr key={b.periodKey}>
                            <td className="py-2.5 px-4 font-bold">{b.periodKey}</td>
                            <td className="py-2.5 px-4">{b.invoicesCount}</td>
                            <td className="py-2.5 px-4 font-semibold">
                              {formatEGP(b.netSalesPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {formatEGP(b.cogsPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 font-bold text-emerald-700">
                              {formatEGP(b.grossProfitPiastres, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      تقرير ربح كل فاتورة ({bundle.invoiceProfits.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">الفاتورة</th>
                          <th className="py-2.5 px-4">التاريخ</th>
                          <th className="py-2.5 px-4">العميل</th>
                          <th className="py-2.5 px-4">صافي البيع</th>
                          <th className="py-2.5 px-4">مدفوع</th>
                          <th className="py-2.5 px-4">التكلفة</th>
                          <th className="py-2.5 px-4">الربح</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.invoiceProfits.map((row) => (
                          <tr key={row.invoiceId}>
                            <td className="py-2.5 px-4 font-mono text-xs font-bold" dir="ltr">
                              {row.invoiceNumber}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600">
                              {row.invoiceDate}
                            </td>
                            <td className="py-2.5 px-4 text-xs font-semibold">
                              {row.customerName}
                            </td>
                            <td className="py-2.5 px-4 font-bold text-[#0B1F3A]">
                              {formatEGP(row.netSalesPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-emerald-700">
                              {formatEGP(row.paidAtSalePiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {formatEGP(row.cogsPiastres, currency)}
                            </td>
                            <td
                              className={`py-2.5 px-4 font-bold ${
                                row.grossProfitPiastres >= 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {formatEGP(row.grossProfitPiastres, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* Tab 3: Purchases & Top Selling Items */}
            {tab === 'purchases_top' && (
              <div className="space-y-4">
                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      الأصناف الأكثر مبيعاً وربحية ({bundle.topSellingItems.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">الكود</th>
                          <th className="py-2.5 px-4">الصنف</th>
                          <th className="py-2.5 px-4">الكمية (قطعة)</th>
                          <th className="py-2.5 px-4">الإيرادات</th>
                          <th className="py-2.5 px-4">التكلفة</th>
                          <th className="py-2.5 px-4">الربح</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.topSellingItems.map((row) => (
                          <tr key={row.itemId}>
                            <td className="py-2.5 px-4 font-mono text-xs">{row.itemSku}</td>
                            <td className="py-2.5 px-4 font-bold">{row.itemName}</td>
                            <td className="py-2.5 px-4 font-semibold">{row.netBaseQtySold}</td>
                            <td className="py-2.5 px-4 font-bold text-[#0B1F3A]">
                              {formatEGP(row.netRevenuePiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-slate-600">
                              {formatEGP(row.netCogsPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 font-bold text-emerald-700">
                              {formatEGP(row.grossProfitPiastres, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      فواتير المشتريات ({bundle.purchases.length})
                    </h3>
                    <span className="text-xs font-bold text-[#0B1F3A] tabular-nums">
                      الإجمالي: {formatEGP(bundle.kpis.totalPurchasesPiastres, currency)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">الفاتورة</th>
                          <th className="py-2.5 px-4">التاريخ</th>
                          <th className="py-2.5 px-4">المورد</th>
                          <th className="py-2.5 px-4">صافي الشراء</th>
                          <th className="py-2.5 px-4">المدفوع</th>
                          <th className="py-2.5 px-4">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.purchases.map((p) => (
                          <tr key={p.invoiceId}>
                            <td className="py-2.5 px-4 font-mono text-xs font-bold" dir="ltr">
                              {p.invoiceNumber}
                            </td>
                            <td className="py-2.5 px-4 text-xs">{p.invoiceDate}</td>
                            <td className="py-2.5 px-4 font-semibold">{p.supplierName}</td>
                            <td className="py-2.5 px-4 font-bold text-[#0B1F3A]">
                              {formatEGP(p.netPurchasesPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-emerald-700">
                              {formatEGP(p.paidPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-red-700">
                              {formatEGP(p.remainingPiastres, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* Tab 4: Low Stock & Stock Movements */}
            {tab === 'inventory' && (
              <div className="space-y-4">
                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-amber-50">
                    <h3 className="text-sm font-bold text-amber-900">
                      الأصناف منخفضة المخزون ({bundle.lowStockItems.length})
                    </h3>
                  </div>
                  {bundle.lowStockItems.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">
                      جميع الأصناف النشطة فوق الحد الأدنى للمخزون.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-right">
                        <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                          <tr>
                            <th className="py-2.5 px-4">الكود</th>
                            <th className="py-2.5 px-4">الصنف</th>
                            <th className="py-2.5 px-4">الرصيد الحالي (قطعة)</th>
                            <th className="py-2.5 px-4">الحد الأدنى</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                          {bundle.lowStockItems.map((l) => (
                            <tr key={l.item.id}>
                              <td className="py-2.5 px-4 font-mono text-xs">{l.item.sku}</td>
                              <td className="py-2.5 px-4 font-bold">{l.item.name}</td>
                              <td className="py-2.5 px-4 font-bold text-red-700">
                                {l.currentStockQty}
                              </td>
                              <td className="py-2.5 px-4 text-slate-600">
                                {l.item.minStockQty}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      تقرير حركات المخزون ({bundle.stockMovements.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">التاريخ</th>
                          <th className="py-2.5 px-4">الصنف</th>
                          <th className="py-2.5 px-4">المخزن</th>
                          <th className="py-2.5 px-4">النوع</th>
                          <th className="py-2.5 px-4">الكمية (قطعة)</th>
                          <th className="py-2.5 px-4">البيان</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.stockMovements.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2.5 px-4 text-xs text-slate-600">{m.date}</td>
                            <td className="py-2.5 px-4 font-semibold">{m.itemName}</td>
                            <td className="py-2.5 px-4 text-xs">{m.warehouseName}</td>
                            <td className="py-2.5 px-4 text-xs font-bold">
                              {MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}
                            </td>
                            <td
                              className={`py-2.5 px-4 font-bold ${
                                m.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600">{m.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* Tab 5: Customer Debts, Supplier Payables & Treasury Movements */}
            {tab === 'parties_treasury' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between">
                      <h3 className="text-sm font-bold text-[#0B1F3A]">مديونيات وأرصدة العملاء</h3>
                      <span className="text-xs font-bold text-[#0B1F3A] tabular-nums">
                        {formatEGP(bundle.kpis.totalCustomersDebtPiastres, currency)}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100 text-sm tabular-nums">
                      {bundle.customersWithDebt.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">لا توجد أرصدة عملاء مفتوحة.</p>
                      ) : (
                        bundle.customersWithDebt.map((c) => (
                          <div key={c.id} className="px-4 py-2.5 flex justify-between">
                            <span className="font-semibold">{c.name}</span>
                            <span
                              className={`font-bold ${
                                c.currentBalancePiastres > 0 ? 'text-red-700' : 'text-emerald-700'
                              }`}
                            >
                              {formatEGP(c.currentBalancePiastres, currency)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between">
                      <h3 className="text-sm font-bold text-[#0B1F3A]">مستحقات الموردين</h3>
                      <span className="text-xs font-bold text-[#0B1F3A] tabular-nums">
                        {formatEGP(bundle.kpis.totalSuppliersPayablePiastres, currency)}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100 text-sm tabular-nums">
                      {bundle.suppliersWithPayable.length === 0 ? (
                        <p className="p-4 text-xs text-slate-500">لا توجد مستحقات موردين مفتوحة.</p>
                      ) : (
                        bundle.suppliersWithPayable.map((s) => (
                          <div key={s.id} className="px-4 py-2.5 flex justify-between">
                            <span className="font-semibold">{s.name}</span>
                            <span className="font-bold text-[#0B1F3A]">
                              {formatEGP(s.currentBalancePiastres, currency)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">
                      تقرير حركة الخزنة ({bundle.treasuryTransactions.length})
                    </h3>
                    <span className="text-xs font-bold text-[#0B1F3A] tabular-nums">
                      الرصيد الحالي: {formatEGP(bundle.treasurySummary.currentBalancePiastres, currency)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                        <tr>
                          <th className="py-2.5 px-4">الحركة</th>
                          <th className="py-2.5 px-4">التاريخ</th>
                          <th className="py-2.5 px-4">النوع</th>
                          <th className="py-2.5 px-4">المبلغ</th>
                          <th className="py-2.5 px-4">البيان</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {bundle.treasuryTransactions.map((tx) => (
                          <tr key={tx.id}>
                            <td className="py-2.5 px-4 font-mono text-xs font-bold" dir="ltr">
                              {tx.transactionNumber}
                            </td>
                            <td className="py-2.5 px-4 text-xs">{tx.transactionDate}</td>
                            <td className="py-2.5 px-4 text-xs font-semibold">
                              {TREASURY_SOURCE_LABELS[tx.sourceType as TreasurySourceType] ??
                                tx.sourceType}
                            </td>
                            <td
                              className={`py-2.5 px-4 font-bold ${
                                tx.direction === 'in' ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {tx.direction === 'in' ? '+' : '−'}{' '}
                              {formatEGP(tx.amountPiastres, currency)}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600">{tx.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
