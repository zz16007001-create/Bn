import {
  Check,
  Edit3,
  Eye,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {InvoicePrintModal} from '../components/InvoicePrintModal';
import {useAuth} from '../context/AuthContext';
import {
  salesRepository,
  type SalesInvoiceWithDetails,
} from '../repositories/salesRepository';
import type {SalesInvoiceStatus} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';
import {formatEGP} from '../utils/money';

export const InvoicesPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<SalesInvoiceWithDetails[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SalesInvoiceStatus>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const [detailTarget, setDetailTarget] = useState<SalesInvoiceWithDetails | null>(null);
  const [printTarget, setPrintTarget] = useState<SalesInvoiceWithDetails | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceWithDetails | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const canCreate = can('invoice.create');
  const canEdit = can('invoice.edit');
  const canCancel = can('invoice.cancel');
  const canViewProfit = can('reports.profit');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await salesRepository.listSalesInvoices({
        search,
        status: statusFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setInvoices(list);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openDetails = async (invoiceId: string) => {
    try {
      const full = await salesRepository.getSalesInvoiceDetails(invoiceId);
      setDetailTarget(full);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الفاتورة.',
      });
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !cancelTarget) return;
    setFeedback(null);
    try {
      await salesRepository.cancelSalesInvoice(
        session.user,
        cancelTarget.invoice.id,
        cancelReason.trim() || 'إلغاء فاتورة مبيعات'
      );
      setFeedback({
        type: 'success',
        text: `تم إلغاء الفاتورة ${cancelTarget.invoice.invoiceNumber} بقيد عكسي كامل.`,
      });
      setCancelTarget(null);
      setCancelReason('');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.',
      });
    }
  };

  const postedInvoices = invoices.filter((i) => i.invoice.status === 'posted');
  const totalSalesNet = postedInvoices.reduce(
    (s, i) => s + (i.invoice.totalPiastres - i.invoice.returnedPiastres),
    0
  );
  const totalRemaining = postedInvoices.reduce((s, i) => s + i.invoice.remainingPiastres, 0);
  const totalProfit = postedInvoices.reduce((s, i) => s + i.invoice.profitPiastres, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">فواتير المبيعات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            بحث واستعراض تفاصيل الفواتير، التعديل والإلغاء بقيود عكسية، المرتجعات، وإعادة الطباعة.
          </p>
        </div>

        {canCreate && (
          <Link
            to="/sales"
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159]"
          >
            <Plus className="w-4 h-4 text-[#C9A227]" />
            <span>فاتورة مبيعات جديدة</span>
          </Link>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">الفواتير المعروضة</span>
          <p className="mt-1 text-xl font-bold text-[#0B1F3A] tabular-nums">{invoices.length}</p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">صافي المبيعات المعتمدة</span>
          <p className="mt-1 text-lg font-bold text-[#0B1F3A] tabular-nums">
            {formatEGP(totalSalesNet, currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">الآجل المتبقي</span>
          <p className="mt-1 text-lg font-bold text-red-700 tabular-nums">
            {formatEGP(totalRemaining, currency)}
          </p>
        </div>
        {canViewProfit && (
          <div className="rounded-2xl bg-white border border-slate-200 p-4">
            <span className="text-xs text-slate-500 font-semibold">إجمالي الربح</span>
            <p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
              {formatEGP(totalProfit, currency)}
            </p>
          </div>
        )}
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الفاتورة أو اسم العميل..."
            className="w-full min-h-[42px] rounded-xl border border-slate-300 pr-10 pl-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | SalesInvoiceStatus)}
          className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="all">كل الحالات</option>
          <option value="posted">معتمدة فقط</option>
          <option value="draft">مسودات</option>
          <option value="reversed">ملغاة / معكوسة</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="من تاريخ"
          className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm tabular-nums"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="إلى تاريخ"
          className="min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm tabular-nums"
        />
      </div>

      {/* Invoices List */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          جارٍ تحميل الفواتير...
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <p className="text-base font-bold text-[#0B1F3A]">لا توجد فواتير مطابقة للبحث</p>
          <p className="mt-1 text-xs text-slate-500">
            ابدأ بإنشاء فاتورة مبيعات جديدة من شاشة المبيعات السريعة.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((item) => {
            const {invoice} = item;
            const isPosted = invoice.status === 'posted';
            const isDraft = invoice.status === 'draft';
            const isReversed = invoice.status === 'reversed';

            return (
              <article
                key={invoice.id}
                className={`rounded-2xl bg-white border p-4 space-y-3 ${
                  isReversed ? 'border-red-200 bg-red-50/20' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-[#0B1F3A]" dir="ltr">
                        {invoice.invoiceNumber}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          isPosted
                            ? 'text-emerald-700'
                            : isDraft
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }`}
                      >
                        {isPosted ? 'معتمدة' : isDraft ? 'مسودة' : 'ملغاة (قيد عكسي)'}
                      </span>
                      {invoice.amendedFromId && (
                        <span className="text-[11px] font-semibold text-[#9E7B14]">
                          معدلة من فاتورة سابقة
                        </span>
                      )}
                      {invoice.returnedPiastres > 0 && (
                        <span className="text-[11px] font-bold text-amber-700">
                          مرتجع: {formatEGP(invoice.returnedPiastres, currency)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-slate-900 mt-1">{item.customerName}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {invoice.invoiceDate} · {item.warehouseName} · {item.lines.length} أصناف ·{' '}
                      {invoice.paymentType === 'cash'
                        ? 'نقدي'
                        : invoice.paymentType === 'credit'
                        ? 'آجل'
                        : 'جزئي'}
                    </p>
                  </div>

                  <div className="text-right sm:text-left tabular-nums">
                    <div className="text-base font-extrabold text-[#0B1F3A]">
                      {formatEGP(invoice.totalPiastres, currency)}
                    </div>
                    <div className="text-xs text-slate-500">
                      مدفوع: {formatEGP(invoice.paidPiastres, currency)}
                      {invoice.remainingPiastres > 0 && (
                        <span className="text-red-700 font-bold">
                          {' '}
                          · متبقي: {formatEGP(invoice.remainingPiastres, currency)}
                        </span>
                      )}
                    </div>
                    {canViewProfit && isPosted && (
                      <div className="text-xs font-bold text-emerald-700">
                        الربح: {formatEGP(invoice.profitPiastres, currency)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => void openDetails(invoice.id)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 text-xs font-bold text-[#0B1F3A] cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>التفاصيل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPrintTarget(item)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 text-xs font-bold text-[#0B1F3A] cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#C9A227]" />
                    <span>إعادة طباعة</span>
                  </button>

                  {isDraft && canCreate && (
                    <button
                      type="button"
                      onClick={() => navigate(`/sales?draft=${invoice.id}`)}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-3 text-xs font-bold text-white hover:bg-[#133159] cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#C9A227]" />
                      <span>استكمال / اعتماد</span>
                    </button>
                  )}

                  {isPosted && invoice.returnedPiastres === 0 && canEdit && (
                    <button
                      type="button"
                      onClick={() => navigate(`/sales?amend=${invoice.id}`)}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 px-3 text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                  )}

                  {isPosted && (
                    <button
                      type="button"
                      onClick={() => navigate(`/returns?invoice=${invoice.id}`)}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100 px-3 text-xs font-bold text-amber-800 cursor-pointer"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>مرتجع</span>
                    </button>
                  )}

                  {isPosted && invoice.returnedPiastres === 0 && canCancel && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelTarget(item);
                        setCancelReason('');
                      }}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-3 text-xs font-bold text-red-700 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>إلغاء بقيد عكسي</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Invoice Details Modal */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-[#0B1F3A]">
                  تفاصيل الفاتورة{' '}
                  <span className="font-mono" dir="ltr">
                    {detailTarget.invoice.invoiceNumber}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {detailTarget.customerName} · {detailTarget.warehouseName} ·{' '}
                  {formatArabicDateTime(detailTarget.invoice.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-4">
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs sm:text-sm border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-right text-xs text-slate-600">
                    <tr>
                      <th className="p-3">الصنف</th>
                      <th className="p-3">الوحدة</th>
                      <th className="p-3">الكمية</th>
                      <th className="p-3">السعر</th>
                      {canViewProfit && <th className="p-3">التكلفة</th>}
                      <th className="p-3">المرتجع</th>
                      <th className="p-3">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailTarget.lines.map((l) => (
                      <tr key={l.line.id}>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{l.itemName}</div>
                          <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                            {l.itemSku}
                          </div>
                        </td>
                        <td className="p-3 text-slate-700">{l.unitName}</td>
                        <td className="p-3 font-bold tabular-nums">{l.line.quantity}</td>
                        <td className="p-3 tabular-nums">
                          {formatEGP(l.line.unitPricePiastres, currency)}
                        </td>
                        {canViewProfit && (
                          <td className="p-3 tabular-nums text-slate-600">
                            {formatEGP(l.line.costPricePiastres * l.line.baseQuantity, currency)}
                          </td>
                        )}
                        <td className="p-3 tabular-nums text-amber-700">
                          {l.line.returnedBaseQuantity > 0
                            ? `${l.line.returnedBaseQuantity} قطعة`
                            : '-'}
                        </td>
                        <td className="p-3 font-bold text-[#0B1F3A] tabular-nums">
                          {formatEGP(l.line.lineTotalPiastres, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <span className="text-slate-500 block">الإجمالي</span>
                  <span className="font-bold text-[#0B1F3A] tabular-nums">
                    {formatEGP(detailTarget.invoice.totalPiastres, currency)}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <span className="text-slate-500 block">المدفوع عند البيع</span>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {formatEGP(detailTarget.invoice.paidPiastres, currency)}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <span className="text-slate-500 block">المرتجعات</span>
                  <span className="font-bold text-amber-700 tabular-nums">
                    {formatEGP(detailTarget.invoice.returnedPiastres, currency)}
                  </span>
                </div>
                {canViewProfit && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                    <span className="text-emerald-700 block">صافي الربح</span>
                    <span className="font-bold text-emerald-800 tabular-nums">
                      {formatEGP(detailTarget.invoice.profitPiastres, currency)}
                    </span>
                  </div>
                )}
              </div>

              {detailTarget.returns && detailTarget.returns.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                  <h4 className="text-xs font-bold text-amber-900 mb-1.5">
                    مرتجعات مسجلة على الفاتورة
                  </h4>
                  <ul className="space-y-1 text-xs">
                    {detailTarget.returns.map((r) => (
                      <li key={r.record.id} className="flex justify-between tabular-nums">
                        <span>
                          {r.record.returnNumber} ({r.record.returnDate}) ·{' '}
                          {r.record.reason || 'بدون سبب'}
                        </span>
                        <span className="font-bold text-amber-900">
                          {formatEGP(r.record.totalPiastres, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="w-5 h-5" />
                <h3 className="text-base font-bold">
                  إلغاء الفاتورة {cancelTarget.invoice.invoiceNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              سيتم إنشاء قيود عكسية على المخزون وحساب العميل والتحصيل المبدئي دون حذف السجل من التاريخ.
            </p>
            <form onSubmit={(e) => void handleConfirmCancel(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سبب الإلغاء
                </label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="مثال: خطأ في الطلب أو إلغاء العميل"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 cursor-pointer"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold hover:bg-red-800 cursor-pointer"
                >
                  تأكيد الإلغاء العكسي
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reprint Modal */}
      {printTarget && (
        <InvoicePrintModal
          details={printTarget}
          companySettings={companySettings}
          onClose={() => setPrintTarget(null)}
        />
      )}
    </div>
  );
};
