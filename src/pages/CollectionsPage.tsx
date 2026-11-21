import {
  AlertTriangle,
  Banknote,
  Check,
  Lock,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {
  collectionRepository,
  type EnrichedCollection,
} from '../repositories/collectionRepository';
import {customerRepository, type CustomerWithTotals} from '../repositories/customerRepository';
import {salesRepository, type SalesInvoiceWithDetails} from '../repositories/salesRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import type {PaymentMethodRecord} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

export const CollectionsPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const [searchParams, setSearchParams] = useSearchParams();

  const [collections, setCollections] = useState<EnrichedCollection[]>([]);
  const [customers, setCustomers] = useState<CustomerWithTotals[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [customerInvoices, setCustomerInvoices] = useState<SalesInvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Form state
  const [customerId, setCustomerId] = useState('');
  const [collectionDate, setCollectionDate] = useState(todayISODate());
  const [amountEgp, setAmountEgp] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [notes, setNotes] = useState('');
  const [clientRequestId, setClientRequestId] = useState<string>(() => generateUUID());

  // Excess confirmation modal
  const [excessConfirmOpen, setExcessConfirmOpen] = useState(false);

  // Double-submit guard
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const canManage = can('collections.manage');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cols, custs, pms] = await Promise.all([
        collectionRepository.listCollections({search}),
        customerRepository.listCustomers(),
        settingsRepository.listPaymentMethods(),
      ]);
      setCollections(cols);
      setCustomers(custs);
      setPaymentMethods(pms);

      const defPm = pms.find((p) => p.isDefault) ?? pms[0];
      if (defPm && !paymentMethodId) {
        setPaymentMethodId(defPm.id);
      }
    } finally {
      setLoading(false);
    }
  }, [search, paymentMethodId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Support ?customer=<id>
  useEffect(() => {
    const cParam = searchParams.get('customer');
    if (cParam && customers.some((c) => c.customer.id === cParam)) {
      setCustomerId(cParam);
      const found = customers.find((c) => c.customer.id === cParam);
      if (found && found.customer.currentBalancePiastres > 0) {
        setAmountEgp(String(fromPiastres(found.customer.currentBalancePiastres)));
      }
      setSearchParams({}, {replace: true});
    }
  }, [searchParams, customers, setSearchParams]);

  // Load selected customer's posted invoices for optional invoice linking
  useEffect(() => {
    if (!customerId) {
      setCustomerInvoices([]);
      setInvoiceId('');
      return;
    }
    let active = true;
    void salesRepository
      .listSalesInvoices({customerId, status: 'posted'})
      .then((list) => {
        if (active) setCustomerInvoices(list);
      });
    return () => {
      active = false;
    };
  }, [customerId]);

  const selectedCustomer = customers.find((c) => c.customer.id === customerId)?.customer ?? null;

  const submitCollection = async (allowCreditExcess: boolean) => {
    if (!session || submittingRef.current) return;
    setFeedback(null);

    if (!customerId) {
      setFeedback({type: 'error', text: 'يرجى اختيار العميل أولاً.'});
      return;
    }
    const amountPiastres = toPiastres(amountEgp);
    if (amountPiastres <= 0) {
      setFeedback({type: 'error', text: 'يرجى إدخال مبلغ تحصيل أكبر من صفر.'});
      return;
    }

    const currentDebt = Math.max(0, selectedCustomer?.currentBalancePiastres ?? 0);
    if (amountPiastres > currentDebt && !allowCreditExcess) {
      setExcessConfirmOpen(true);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const rec = await collectionRepository.recordCollection(session.user, {
        customerId,
        amountPiastres,
        paymentMethodId: paymentMethodId || null,
        invoiceId: invoiceId || null,
        collectionDate,
        notes,
        allowCreditExcess,
        clientRequestId,
      });
      setExcessConfirmOpen(false);
      setAmountEgp('');
      setInvoiceId('');
      setNotes('');
      setClientRequestId(generateUUID());
      setFeedback({
        type: 'success',
        text: `تم تسجيل سند التحصيل ${rec.receiptNumber} بمبلغ ${formatEGP(rec.amountPiastres, currency)}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل التحصيل.',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleReverse = async (colId: string, receiptNo: string) => {
    if (!session) return;
    setFeedback(null);
    try {
      await collectionRepository.reverseCollection(session.user, colId);
      setFeedback({type: 'success', text: `تم عكس سند التحصيل ${receiptNo}.`});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر عكس سند التحصيل.',
      });
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <Lock className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[#0B1F3A]">صلاحية التحصيلات مقيدة</h2>
        <p className="mt-1 text-sm text-slate-600">
          لا يملك دورك الحالي صلاحية تسجيل أو مراجعة التحصيلات.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-[#0B1F3A]">تحصيلات العملاء</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          تسجيل التحصيل الجزئي أو الكلي من العملاء، ربطه بفاتورة اختيارياً، وتحديث حساب العميل لحظياً.
        </p>
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

      {/* Collection Entry Form */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Banknote className="w-5 h-5 text-[#C9A227]" />
          <h3 className="text-base font-bold text-[#0B1F3A]">تسجيل سند تحصيل جديد</h3>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCollection(false);
          }}
          className="space-y-3.5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">العميل</label>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
              >
                <option value="">اختر العميل...</option>
                {customers.map((c) => (
                  <option key={c.customer.id} value={c.customer.id}>
                    {c.customer.name} (
                    {c.customer.currentBalancePiastres >= 0
                      ? `مدين: ${formatEGP(c.customer.currentBalancePiastres, currency)}`
                      : `دائن: ${formatEGP(Math.abs(c.customer.currentBalancePiastres), currency)}`}
                    )
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                المبلغ المحصل (ج.م)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                inputMode="decimal"
                dir="ltr"
                value={amountEgp}
                onChange={(e) => setAmountEgp(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[44px] rounded-xl border border-[#0B1F3A] px-3 text-left text-base font-extrabold tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">التاريخ</label>
              <input
                type="date"
                required
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">طريقة الدفع</label>
              <select
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
              >
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ربط بفاتورة (اختياري)
              </label>
              <select
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                disabled={!customerId}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
              >
                <option value="">تحصيل عام على حساب العميل</option>
                {customerInvoices.map((inv) => (
                  <option key={inv.invoice.id} value={inv.invoice.id}>
                    {inv.invoice.invoiceNumber} ({inv.invoice.invoiceDate}) - إجمالي{' '}
                    {formatEGP(inv.invoice.totalPiastres, currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="تحصيل نقدي / شيك / تحويل..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
          </div>

          {selectedCustomer && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 tabular-nums">
              <span>
                المديونية الحالية للعميل ({selectedCustomer.name}):{' '}
                <strong
                  className={
                    selectedCustomer.currentBalancePiastres > 0
                      ? 'text-red-700'
                      : 'text-emerald-700'
                  }
                >
                  {formatEGP(selectedCustomer.currentBalancePiastres, currency)}
                </strong>
              </span>
              {selectedCustomer.currentBalancePiastres > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setAmountEgp(String(fromPiastres(selectedCustomer.currentBalancePiastres)))
                  }
                  className="text-xs font-bold text-[#0B1F3A] hover:underline cursor-pointer"
                >
                  تحصيل المديونية بالكامل
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[46px] px-6 rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'جارٍ الحفظ...' : 'اعتماد سند التحصيل'}
          </button>
        </form>
      </section>

      {/* Search & History */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث برقم السند أو اسم العميل أو الفاتورة..."
          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pr-10 pl-3.5 text-sm"
        />
      </div>

      <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500">جارٍ تحميل التحصيلات...</p>
        ) : collections.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">لا توجد سندات تحصيل مسجلة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs sm:text-sm border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-right text-xs text-slate-600">
                <tr>
                  <th className="p-3">رقم السند</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">العميل</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">الفاتورة</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {collections.map((c) => (
                  <tr key={c.collection.id}>
                    <td className="p-3 font-mono font-bold text-[#0B1F3A]" dir="ltr">
                      {c.collection.receiptNumber}
                    </td>
                    <td className="p-3 tabular-nums">{c.collection.collectionDate}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{c.customerName}</div>
                      <div className="text-[11px] text-slate-500">{c.collection.notes}</div>
                    </td>
                    <td className="p-3 text-slate-700">{c.paymentMethodName}</td>
                    <td className="p-3 font-mono text-xs" dir="ltr">
                      {c.invoiceNumber ?? '-'}
                    </td>
                    <td className="p-3 font-bold text-emerald-700 tabular-nums">
                      {formatEGP(c.collection.amountPiastres, currency)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-xs font-bold ${
                          c.collection.status === 'posted' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {c.collection.status === 'posted' ? 'معتمد' : 'معكوس'}
                      </span>
                    </td>
                    <td className="p-3">
                      {c.collection.status === 'posted' &&
                        !c.collection.isInvoiceInitialCollection && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleReverse(c.collection.id, c.collection.receiptNumber)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>عكس</span>
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Over-Debt Confirmation Modal */}
      {excessConfirmOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-bold">تأكيد تحصيل أكبر من المديونية</h3>
              </div>
              <button
                type="button"
                onClick={() => setExcessConfirmOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              المبلغ المدخل ({formatEGP(toPiastres(amountEgp), currency)}) أكبر من المديونية الحالية
              للعميل <strong>{selectedCustomer.name}</strong> (
              {formatEGP(Math.max(0, selectedCustomer.currentBalancePiastres), currency)}).
            </p>
            <p className="mt-2 text-xs text-slate-500">
              هل تريد المتابعة وتسجيل الفائض كرصيد دائن لصالح العميل؟
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setExcessConfirmOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-bold text-slate-700 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void submitCollection(true)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                تأكيد وتسجيل الفائض
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
