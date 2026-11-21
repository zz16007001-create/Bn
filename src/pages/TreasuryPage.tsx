import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Lock,
  Plus,
  Search,
  Vault,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {
  TREASURY_SOURCE_LABELS,
  treasuryRepository,
  type EnrichedTreasuryTransaction,
  type TreasurySummary,
} from '../repositories/treasuryRepository';
import type {TreasuryClosingRecord, TreasurySourceType} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {formatArabicDateTime, todayISODate} from '../utils/date';
import {formatEGP, toPiastres} from '../utils/money';

type ActionModalMode = 'opening' | 'deposit' | 'withdrawal' | null;

export const TreasuryPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const canWithdraw = can('treasury.withdraw');

  const [summary, setSummary] = useState<TreasurySummary | null>(null);
  const [transactions, setTransactions] = useState<EnrichedTreasuryTransaction[]>([]);
  const [closings, setClosings] = useState<TreasuryClosingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'ledger' | 'closings'>('ledger');
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<TreasurySourceType | 'all'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'in' | 'out'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // Modal state for opening / deposit / withdrawal
  const [modalMode, setModalMode] = useState<ActionModalMode>(null);
  const [modalMethodId, setModalMethodId] = useState('');
  const [modalAmountEgp, setModalAmountEgp] = useState('');
  const [modalDate, setModalDate] = useState(todayISODate());
  const [modalNotes, setModalNotes] = useState('');
  const [clientRequestId, setClientRequestId] = useState(() => generateUUID());

  // Daily closing modal state
  const [closingModalOpen, setClosingModalOpen] = useState(false);
  const [closingMethodId, setClosingMethodId] = useState('');
  const [closingDate, setClosingDate] = useState(todayISODate());
  const [closingActualEgp, setClosingActualEgp] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(
    null
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumData, txList, closingList] = await Promise.all([
        treasuryRepository.getSummary(selectedMethodId || undefined),
        treasuryRepository.listTransactions({
          paymentMethodId: selectedMethodId || undefined,
          sourceType: sourceTypeFilter,
          direction: directionFilter,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search,
        }),
        treasuryRepository.listDailyClosings(),
      ]);
      setSummary(sumData);
      setTransactions(txList);
      setClosings(closingList);

      const defPm =
        sumData.paymentMethods.find((m) => m.isDefault) ?? sumData.paymentMethods[0];
      if (defPm) {
        setModalMethodId((prev) => prev || defPm.id);
        setClosingMethodId((prev) => prev || defPm.id);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMethodId, sourceTypeFilter, directionFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openActionModal = (mode: ActionModalMode) => {
    setFeedback(null);
    setModalMode(mode);
    setModalAmountEgp('');
    setModalDate(todayISODate());
    setModalNotes('');
    setClientRequestId(generateUUID());
    const defPm =
      summary?.paymentMethods.find((m) => m.isDefault) ?? summary?.paymentMethods[0];
    if (defPm) setModalMethodId(selectedMethodId || defPm.id);
  };

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !modalMode || submittingRef.current) return;
    setFeedback(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const amountPiastres = toPiastres(modalAmountEgp);
      if (modalMode === 'opening') {
        const tx = await treasuryRepository.recordOpeningBalance(session.user, {
          paymentMethodId: modalMethodId || undefined,
          amountPiastres,
          transactionDate: modalDate,
          notes: modalNotes || 'رصيد افتتاحي للخزنة',
          clientRequestId,
        });
        setFeedback({
          type: 'success',
          text: `تم تسجيل الرصيد الافتتاحي (${tx.transactionNumber}) بقيمة ${formatEGP(tx.amountPiastres, currency)}.`,
        });
      } else if (modalMode === 'deposit') {
        const tx = await treasuryRepository.recordManualDeposit(session.user, {
          paymentMethodId: modalMethodId || undefined,
          amountPiastres,
          transactionDate: modalDate,
          notes: modalNotes,
          clientRequestId,
        });
        setFeedback({
          type: 'success',
          text: `تم تسجيل الإيداع (${tx.transactionNumber}) بقيمة ${formatEGP(tx.amountPiastres, currency)}.`,
        });
      } else {
        const tx = await treasuryRepository.recordManualWithdrawal(session.user, {
          paymentMethodId: modalMethodId || undefined,
          amountPiastres,
          transactionDate: modalDate,
          notes: modalNotes,
          clientRequestId,
        });
        setFeedback({
          type: 'success',
          text: `تم تسجيل السحب (${tx.transactionNumber}) بقيمة ${formatEGP(tx.amountPiastres, currency)}.`,
        });
      }
      setModalMode(null);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل حركة الخزنة.',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClosingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || submittingRef.current) return;
    setFeedback(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const rec = await treasuryRepository.recordDailyClosing(session.user, {
        paymentMethodId: closingMethodId,
        closingDate,
        actualCountedPiastres: toPiastres(closingActualEgp),
        notes: closingNotes,
      });
      setFeedback({
        type: 'success',
        text: `تم اعتماد الإقفال اليومي (${rec.closingNumber}) — المتوقع: ${formatEGP(rec.expectedBalancePiastres, currency)}، الفعلي: ${formatEGP(rec.actualCountedPiastres, currency)}.`,
      });
      setClosingModalOpen(false);
      setActiveTab('closings');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إتمام الإقفال اليومي.',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const methodNameMap = new Map(
    (summary?.paymentMethods ?? []).map((m) => [m.id, m.name])
  );

  return (
    <div className="space-y-5">
      {/* Header & Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">الخزنة والحسابات النقدية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تسجل الخزنة المبالغ المدفوعة والمحصّلة فعلاً فقط، وترتبط كل حركة بمستندها الأصلي لمنع التكرار.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openActionModal('opening')}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs sm:text-sm font-bold text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#C9A227]" />
            <span>رصيد افتتاحي</span>
          </button>

          <button
            type="button"
            onClick={() => openActionModal('deposit')}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 text-xs sm:text-sm font-bold text-white hover:bg-emerald-800 cursor-pointer"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>إيداع</span>
          </button>

          {canWithdraw ? (
            <button
              type="button"
              onClick={() => openActionModal('withdrawal')}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-3.5 text-xs sm:text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
            >
              <ArrowUpRight className="w-4 h-4 text-[#C9A227]" />
              <span>سحب</span>
            </button>
          ) : (
            <span className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-semibold text-slate-500">
              <Lock className="w-3.5 h-3.5" />
              <span>السحب مقيد</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setClosingActualEgp('');
              setClosingNotes('');
              setClosingDate(todayISODate());
              setClosingModalOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#C9A227] bg-[#FAF3DC] px-3.5 text-xs sm:text-sm font-bold text-[#0B1F3A] hover:bg-[#f4e7be] cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4 text-[#9E7B14]" />
            <span>إقفال يومي</span>
          </button>
        </div>
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

      {/* Treasury Equation Banner */}
      <section className="rounded-2xl bg-[#0B1F3A] text-white p-5 border border-[#C9A227]/30">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Vault className="w-5 h-5 text-[#C9A227]" />
            <span className="text-sm font-bold text-[#DBBA4B]">
              معادلة الخزنة: الرصيد الافتتاحي + المقبوضات − المدفوعات = الرصيد الحالي
            </span>
          </div>
          <select
            value={selectedMethodId}
            onChange={(e) => setSelectedMethodId(e.target.value)}
            className="min-h-[40px] rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-bold text-white"
          >
            <option value="" className="text-slate-900">
              كل الخزن وطرق الدفع
            </option>
            {(summary?.paymentMethods ?? []).map((pm) => (
              <option key={pm.id} value={pm.id} className="text-slate-900">
                {pm.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
            <p className="text-xs text-slate-300">الرصيد الافتتاحي</p>
            <p className="mt-1.5 text-lg font-bold text-white">
              {summary ? formatEGP(summary.openingPiastres, currency) : '...'}
            </p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
            <p className="text-xs text-emerald-300">+ إجمالي المقبوضات</p>
            <p className="mt-1.5 text-lg font-bold text-emerald-300">
              {summary ? formatEGP(summary.totalInPiastres, currency) : '...'}
            </p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
            <p className="text-xs text-rose-300">− إجمالي المدفوعات</p>
            <p className="mt-1.5 text-lg font-bold text-rose-300">
              {summary ? formatEGP(summary.totalOutPiastres, currency) : '...'}
            </p>
          </div>
          <div className="rounded-xl bg-[#C9A227]/15 border border-[#C9A227]/50 p-3.5">
            <p className="text-xs text-[#DBBA4B] font-semibold">= الرصيد الحالي</p>
            <p className="mt-1.5 text-xl font-bold text-[#DBBA4B]">
              {summary ? formatEGP(summary.computedBalancePiastres, currency) : '...'}
            </p>
          </div>
        </div>

        {/* Payment method breakdown */}
        {summary && summary.paymentMethods.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap gap-3 text-xs tabular-nums">
            {summary.paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="rounded-xl bg-white/5 px-3 py-2 flex items-center gap-2"
              >
                <span className="text-slate-300">{pm.name}:</span>
                <span className="font-bold text-white">
                  {formatEGP(pm.currentBalancePiastres, currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabs: Ledger vs Closings */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('ledger')}
          className={`min-h-[40px] px-4 rounded-lg text-sm font-bold cursor-pointer ${
            activeTab === 'ledger' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700'
          }`}
        >
          سجل الحركات اليومية ({transactions.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('closings')}
          className={`min-h-[40px] px-4 rounded-lg text-sm font-bold cursor-pointer ${
            activeTab === 'closings' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700'
          }`}
        >
          سجل الإقفالات اليومية ({closings.length})
        </button>
      </div>

      {activeTab === 'ledger' ? (
        <div className="space-y-4">
          {/* Filters */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الحركة أو البيان أو المستند..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 pr-10 pl-3 text-sm"
              />
            </div>

            <select
              value={sourceTypeFilter}
              onChange={(e) =>
                setSourceTypeFilter(e.target.value as TreasurySourceType | 'all')
              }
              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">كل أنواع الحركات</option>
              {(Object.keys(TREASURY_SOURCE_LABELS) as TreasurySourceType[]).map((key) => (
                <option key={key} value={key}>
                  {TREASURY_SOURCE_LABELS[key]}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="من تاريخ"
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="إلى تاريخ"
              className="min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
            />

            <div className="lg:col-span-5 flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    {id: 'all', label: 'الكل'},
                    {id: 'in', label: 'وارد / مقبوضات'},
                    {id: 'out', label: 'صادر / مدفوعات'},
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDirectionFilter(d.id)}
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                      directionFilter === d.id
                        ? 'bg-[#0B1F3A] text-white'
                        : 'text-slate-600'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {(dateFrom || dateTo || sourceTypeFilter !== 'all' || directionFilter !== 'all' || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setSourceTypeFilter('all');
                    setDirectionFilter('all');
                    setSearch('');
                  }}
                  className="text-xs font-bold text-[#0B1F3A] underline cursor-pointer"
                >
                  إعادة ضبط الفلاتر
                </button>
              )}
            </div>
          </div>

          {/* Movements Table / Cards */}
          {loading ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
              جارٍ تحميل حركات الخزنة...
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
              <Vault className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
              <p className="text-base font-bold text-[#0B1F3A]">لا توجد حركات خزنة مطابقة</p>
              <p className="mt-1 text-xs text-slate-500">
                يمكنك تسجيل رصيد افتتاحي أو إيداع، كما تُسجل المبيعات والتحصيلات والمشتريات والمصروفات تلقائياً.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    <tr>
                      <th className="py-3 px-4">رقم الحركة</th>
                      <th className="py-3 px-4">التاريخ</th>
                      <th className="py-3 px-4">النوع</th>
                      <th className="py-3 px-4">الخزنة</th>
                      <th className="py-3 px-4">البيان</th>
                      <th className="py-3 px-4">المبلغ</th>
                      <th className="py-3 px-4">الرصيد بعد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {transactions.map(({transaction, paymentMethodName, sourceTypeLabelAr, actorName}) => {
                      const isIn = transaction.direction === 'in';
                      return (
                        <tr key={transaction.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4 font-mono text-xs font-bold text-[#0B1F3A]" dir="ltr">
                            {transaction.transactionNumber}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                            <div>{transaction.transactionDate}</div>
                            <div className="text-[11px] text-slate-400">{actorName}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-bold ${
                                isIn ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {sourceTypeLabelAr}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700">
                            {paymentMethodName}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 max-w-xs">
                            {transaction.notes}
                          </td>
                          <td
                            className={`py-3 px-4 font-bold whitespace-nowrap ${
                              isIn ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {isIn ? '+' : '−'} {formatEGP(transaction.amountPiastres, currency)}
                          </td>
                          <td className="py-3 px-4 font-bold text-[#0B1F3A] whitespace-nowrap">
                            {formatEGP(transaction.balanceAfterPiastres, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Closings History */
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          {closings.length === 0 ? (
            <div className="p-10 text-center">
              <ClipboardCheck className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
              <p className="text-base font-bold text-[#0B1F3A]">لا توجد إقفالات يومية مسجلة</p>
              <p className="mt-1 text-xs text-slate-500">
                يمكنك تنفيذ إقفال يومي اختياري لمطابقة الرصيد الدفتري مع الجرد الفعلي للنقدية.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="py-3 px-4">رقم الإقفال</th>
                    <th className="py-3 px-4">التاريخ</th>
                    <th className="py-3 px-4">الخزنة</th>
                    <th className="py-3 px-4">المتوقع</th>
                    <th className="py-3 px-4">الجرد الفعلي</th>
                    <th className="py-3 px-4">الفرق</th>
                    <th className="py-3 px-4">المسؤول</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {closings.map((c) => (
                    <tr key={c.id}>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-[#0B1F3A]" dir="ltr">
                        {c.closingNumber}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div>{c.closingDate}</div>
                        <div className="text-[11px] text-slate-400">
                          {formatArabicDateTime(c.createdAt)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        {methodNameMap.get(c.paymentMethodId) ?? 'الخزنة'}
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        {formatEGP(c.expectedBalancePiastres, currency)}
                      </td>
                      <td className="py-3 px-4 font-bold text-[#0B1F3A]">
                        {formatEGP(c.actualCountedPiastres, currency)}
                      </td>
                      <td
                        className={`py-3 px-4 font-bold ${
                          c.variancePiastres === 0
                            ? 'text-emerald-700'
                            : c.variancePiastres > 0
                            ? 'text-sky-700'
                            : 'text-red-700'
                        }`}
                      >
                        {c.variancePiastres === 0
                          ? 'مطابق'
                          : formatEGP(c.variancePiastres, currency)}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {c.closedByName}
                        {c.notes ? <div className="text-slate-400">{c.notes}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Opening / Deposit / Withdrawal Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                {modalMode === 'opening'
                  ? 'تسجيل رصيد افتتاحي للخزنة'
                  : modalMode === 'deposit'
                  ? 'إيداع نقدي في الخزنة'
                  : 'سحب نقدي من الخزنة'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={(e) => void handleActionSubmit(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الخزنة / الحساب
                </label>
                <select
                  value={modalMethodId}
                  onChange={(e) => setModalMethodId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {(summary?.paymentMethods ?? []).map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} (الحالي: {formatEGP(pm.currentBalancePiastres, currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    المبلغ ({currency})
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    dir="ltr"
                    value={modalAmountEgp}
                    onChange={(e) => setModalAmountEgp(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    التاريخ
                  </label>
                  <input
                    type="date"
                    required
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {modalMode === 'opening' ? 'ملاحظات (اختياري)' : 'السبب / المستند المرتبط (إلزامي)'}
                </label>
                <input
                  type="text"
                  required={modalMode !== 'opening'}
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder={
                    modalMode === 'opening'
                      ? 'رصيد افتتاحي للخزنة'
                      : modalMode === 'deposit'
                      ? 'تمويل رأس مال / إيداع بنكي...'
                      : 'مسحوبات مالك / تحويل بنكي...'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'جارٍ الحفظ...' : 'اعتماد الحركة'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Daily Closing Modal */}
      {closingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0B1F3A]">إقفال يومي للخزنة</h3>
              <button
                type="button"
                onClick={() => setClosingModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={(e) => void handleClosingSubmit(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الخزنة
                </label>
                <select
                  required
                  value={closingMethodId}
                  onChange={(e) => setClosingMethodId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {(summary?.paymentMethods ?? []).map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} (الدفتري الحالي: {formatEGP(pm.currentBalancePiastres, currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تاريخ الإقفال
                  </label>
                  <input
                    type="date"
                    required
                    value={closingDate}
                    onChange={(e) => setClosingDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الجرد الفعلي ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    dir="ltr"
                    value={closingActualEgp}
                    onChange={(e) => setClosingActualEgp(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left font-bold tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات الإقفال
                </label>
                <input
                  type="text"
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="ملاحظات الجرد أو سبب أي عجز/زيادة..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'جارٍ الاعتماد...' : 'اعتماد الإقفال اليومي'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
