import {Check, Search, Undo2} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {
  salesRepository,
  type SalesInvoiceWithDetails,
} from '../repositories/salesRepository';
import {
  salesReturnRepository,
  type SalesReturnLineInput,
  type SalesReturnWithDetails,
} from '../repositories/salesReturnRepository';
import {todayISODate} from '../utils/date';
import {formatEGP} from '../utils/money';

interface ReturnRowInput {
  qtyText: string;
  condition: 'good' | 'damaged';
}

export const SalesReturnsPage: React.FC = () => {
  const {session, companySettings} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const [searchParams, setSearchParams] = useSearchParams();

  const [postedInvoices, setPostedInvoices] = useState<SalesInvoiceWithDetails[]>([]);
  const [returnsList, setReturnsList] = useState<SalesReturnWithDetails[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoiceWithDetails | null>(null);
  const [rowInputs, setRowInputs] = useState<Record<string, ReturnRowInput>>({});

  const [returnDate, setReturnDate] = useState(todayISODate());
  const [refundMode, setRefundMode] = useState<'cash' | 'customer_credit'>('customer_credit');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invs, rets] = await Promise.all([
        salesRepository.listSalesInvoices({status: 'posted'}),
        salesReturnRepository.listSalesReturns(search),
      ]);
      setPostedInvoices(invs);
      setReturnsList(rets);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const invParam = searchParams.get('invoice');
    if (invParam) {
      setSelectedInvoiceId(invParam);
      setSearchParams({}, {replace: true});
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setSelectedInvoice(null);
      setRowInputs({});
      return;
    }
    let active = true;
    void salesRepository.getSalesInvoiceDetails(selectedInvoiceId).then((details) => {
      if (!active) return;
      setSelectedInvoice(details);
      setRefundMode(details.invoice.customerId ? 'customer_credit' : 'cash');
      const initial: Record<string, ReturnRowInput> = {};
      for (const l of details.lines) {
        initial[l.line.id] = {qtyText: '', condition: 'good'};
      }
      setRowInputs(initial);
    });
    return () => {
      active = false;
    };
  }, [selectedInvoiceId]);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !selectedInvoice || submitting) return;
    setFeedback(null);

    const linesToReturn: SalesReturnLineInput[] = [];
    for (const l of selectedInvoice.lines) {
      const inp = rowInputs[l.line.id];
      if (!inp) continue;
      const qty = Number(inp.qtyText);
      if (Number.isFinite(qty) && qty > 0) {
        linesToReturn.push({
          salesInvoiceLineId: l.line.id,
          quantity: qty,
          condition: inp.condition,
        });
      }
    }

    if (linesToReturn.length === 0) {
      setFeedback({type: 'error', text: 'يرجى إدخال كمية مرتجعة لصنف واحد على الأقل.'});
      return;
    }

    setSubmitting(true);
    try {
      const created = await salesReturnRepository.createSalesReturn(session.user, {
        salesInvoiceId: selectedInvoice.invoice.id,
        returnDate,
        refundMode: selectedInvoice.invoice.customerId ? refundMode : 'cash',
        reason,
        notes,
        lines: linesToReturn,
      });
      setFeedback({
        type: 'success',
        text: `تم اعتماد مرتجع المبيعات ${created.record.returnNumber} بقيمة ${formatEGP(created.record.totalPiastres, currency)}.`,
      });
      setSelectedInvoiceId('');
      setReason('');
      setNotes('');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل مرتجع المبيعات.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-[#0B1F3A]">مرتجعات المبيعات</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          إرجاع جزئي أو كلي من فاتورة مبيعات، تحديد حالة البضاعة (صالحة للمخزن أو تالفة)، وتحديث الربح وحساب العميل.
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

      {/* New Return Form */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Undo2 className="w-5 h-5 text-[#C9A227]" />
          <h3 className="text-base font-bold text-[#0B1F3A]">تسجيل مرتجع مبيعات جديد</h3>
        </div>

        <form onSubmit={(e) => void handleSubmitReturn(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                اختر فاتورة المبيعات الأصلية
              </label>
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
              >
                <option value="">اختر فاتورة معتمدة...</option>
                {postedInvoices.map((inv) => (
                  <option key={inv.invoice.id} value={inv.invoice.id}>
                    {inv.invoice.invoiceNumber} · {inv.customerName} · {inv.invoice.invoiceDate} ·{' '}
                    {formatEGP(inv.invoice.totalPiastres, currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ المرتجع</label>
              <input
                type="date"
                required
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm tabular-nums"
              />
            </div>
          </div>

          {selectedInvoice && (
            <>
              <div className="space-y-2.5">
                {selectedInvoice.lines.map((l) => {
                  const maxReturnableBase = l.line.baseQuantity - l.line.returnedBaseQuantity;
                  const maxInLineUnits = Math.floor(maxReturnableBase / l.conversionFactor);
                  const row = rowInputs[l.line.id] ?? {qtyText: '', condition: 'good'};

                  return (
                    <div
                      key={l.line.id}
                      className="rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-sm text-[#0B1F3A]">{l.itemName}</div>
                        <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                          المباع: {l.line.quantity} {l.unitName} · المتاح للإرجاع:{' '}
                          <strong className="text-slate-800">{maxReturnableBase} قطعة</strong> (
                          {maxInLineUnits} {l.unitName})
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-28">
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            الكمية ({l.unitName})
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={maxInLineUnits}
                            step="any"
                            dir="ltr"
                            placeholder="0"
                            disabled={maxReturnableBase <= 0}
                            value={row.qtyText}
                            onChange={(e) =>
                              setRowInputs((prev) => ({
                                ...prev,
                                [l.line.id]: {...row, qtyText: e.target.value},
                              }))
                            }
                            className="w-full min-h-[40px] rounded-xl border border-slate-300 px-2.5 text-center text-sm font-bold tabular-nums disabled:bg-slate-100"
                          />
                        </div>

                        <div className="w-44">
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            حالة البضاعة
                          </label>
                          <select
                            value={row.condition}
                            onChange={(e) =>
                              setRowInputs((prev) => ({
                                ...prev,
                                [l.line.id]: {
                                  ...row,
                                  condition: e.target.value as 'good' | 'damaged',
                                },
                              }))
                            }
                            className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold"
                          >
                            <option value="good">صالحة (تعود للمخزن)</option>
                            <option value="damaged">تالفة (لا تعود للمخزن)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">طريقة التسوية</label>
                  <select
                    value={selectedInvoice.invoice.customerId ? refundMode : 'cash'}
                    disabled={!selectedInvoice.invoice.customerId}
                    onChange={(e) =>
                      setRefundMode(e.target.value as 'cash' | 'customer_credit')
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                  >
                    {selectedInvoice.invoice.customerId && (
                      <option value="customer_credit">إضافة لرصيد العميل (خصم من المديونية)</option>
                    )}
                    <option value="cash">رد المبلغ نقداً</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب المرتجع</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="انتهاء صلاحية / تلف تغليف / طلب زائد..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[46px] px-6 rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'جارٍ الاعتماد...' : 'اعتماد مرتجع المبيعات'}
              </button>
            </>
          )}
        </form>
      </section>

      {/* Search & Past Returns */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث برقم المرتجع أو الفاتورة أو العميل..."
          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pr-10 pl-3.5 text-sm"
        />
      </div>

      <section className="space-y-3">
        {loading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            جارٍ تحميل المرتجعات...
          </div>
        ) : returnsList.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            لا توجد مرتجعات مبيعات مسجلة بعد.
          </div>
        ) : (
          returnsList.map((ret) => (
            <article
              key={ret.record.id}
              className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-sm font-bold text-[#0B1F3A]" dir="ltr">
                    {ret.record.returnNumber}
                  </span>
                  <span className="mx-2 text-slate-300">|</span>
                  <span className="text-xs font-semibold text-slate-600">
                    فاتورة:{' '}
                    <span className="font-mono" dir="ltr">
                      {ret.invoiceNumber}
                    </span>
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{ret.customerName}</p>
                  <p className="text-xs text-slate-500">
                    {ret.record.returnDate} ·{' '}
                    {ret.record.refundMode === 'customer_credit' ? 'خصم من رصيد العميل' : 'رد نقدي'}
                    {ret.record.reason ? ` · السبب: ${ret.record.reason}` : ''}
                  </p>
                </div>
                <div className="text-left font-extrabold text-amber-800 tabular-nums">
                  {formatEGP(ret.record.totalPiastres, currency)}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 text-xs">
                {ret.lines.map((l) => (
                  <span
                    key={l.line.id}
                    className={`rounded-lg px-2.5 py-1 font-semibold ${
                      l.line.condition === 'good'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-red-50 text-red-800'
                    }`}
                  >
                    {l.itemName}: {l.line.quantity} {l.unitName} (
                    {l.line.condition === 'good' ? 'صالحة للمخزن' : 'تالفة'})
                  </span>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
};
