import {
  Check,
  Edit3,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Tag,
  WalletCards,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {expenseRepository, type EnrichedExpense} from '../repositories/expenseRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import type {ExpenseCategoryRecord, PaymentMethodRecord} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

export const ExpensesPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const canManage = can('expenses.manage');

  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [expenses, setExpenses] = useState<EnrichedExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'posted' | 'reversed'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Form modal (create or amend)
  const [formOpen, setFormOpen] = useState(false);
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISODate());
  const [amountEgp, setAmountEgp] = useState('');
  const [description, setDescription] = useState('');
  const [clientRequestId, setClientRequestId] = useState(() => generateUUID());

  // Add category inline modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Reverse modal
  const [reverseTarget, setReverseTarget] = useState<EnrichedExpense | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(
    null
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, methods, list] = await Promise.all([
        expenseRepository.listCategories(),
        settingsRepository.listPaymentMethods(),
        expenseRepository.listExpenses({
          search,
          categoryId: categoryFilter || undefined,
          status: statusFilter,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      ]);
      setCategories(cats);
      setPaymentMethods(methods.filter((m) => m.isActive));
      setExpenses(list);

      if (cats[0]) setCategoryId((prev) => prev || cats[0].id);
      const defPm = methods.find((m) => m.isDefault && m.isActive) ?? methods[0];
      if (defPm) setPaymentMethodId((prev) => prev || defPm.id);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!canManage) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center max-w-lg mx-auto">
        <Lock className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[#0B1F3A]">صلاحية المصروفات غير متاحة</h2>
        <p className="mt-1 text-sm text-slate-600">
          لا يملك دورك الحالي صلاحية إدارة وتسجيل المصروفات.
        </p>
      </div>
    );
  }

  const openCreateModal = () => {
    setFeedback(null);
    setAmendingId(null);
    setExpenseDate(todayISODate());
    setAmountEgp('');
    setDescription('');
    setClientRequestId(generateUUID());
    if (categories[0]) setCategoryId(categories[0].id);
    const defPm = paymentMethods.find((m) => m.isDefault) ?? paymentMethods[0];
    if (defPm) setPaymentMethodId(defPm.id);
    setFormOpen(true);
  };

  const openAmendModal = (entry: EnrichedExpense) => {
    setFeedback(null);
    setAmendingId(entry.expense.id);
    setCategoryId(entry.expense.categoryId);
    setPaymentMethodId(entry.expense.paymentMethodId);
    setExpenseDate(entry.expense.expenseDate);
    setAmountEgp(String(fromPiastres(entry.expense.amountPiastres)));
    setDescription(entry.expense.description);
    setClientRequestId(generateUUID());
    setFormOpen(true);
  };

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || submittingRef.current) return;
    setFeedback(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const payload = {
        categoryId,
        paymentMethodId,
        amountPiastres: toPiastres(amountEgp),
        expenseDate,
        description,
        clientRequestId,
      };
      if (amendingId) {
        const res = await expenseRepository.amendExpense(session.user, amendingId, payload);
        setFeedback({
          type: 'success',
          text: `تم تعديل المصروف بقيد عكسي واعتماد السند الجديد (${res.expense.voucherNumber}).`,
        });
      } else {
        const res = await expenseRepository.createExpense(session.user, payload);
        setFeedback({
          type: 'success',
          text: `تم تسجيل المصروف (${res.expense.voucherNumber}) وخصمه من الخزنة تلقائياً.`,
        });
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ المصروف.',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    try {
      const cat = await expenseRepository.createCategory(session.user, newCatName);
      setNewCatName('');
      setCatModalOpen(false);
      setCategoryId(cat.id);
      setFeedback({type: 'success', text: `تمت إضافة تصنيف المصروفات: ${cat.name}`});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة التصنيف.',
      });
    }
  };

  const handleConfirmReverse = async () => {
    if (!session || !reverseTarget) return;
    setFeedback(null);
    try {
      await expenseRepository.cancelExpense(
        session.user,
        reverseTarget.expense.id,
        'إلغاء مصروف من شاشة المصروفات'
      );
      setFeedback({
        type: 'success',
        text: `تم إلغاء المصروف (${reverseTarget.expense.voucherNumber}) وإرجاع المبلغ للخزنة بقيد عكسي.`,
      });
      setReverseTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إلغاء المصروف.',
      });
    }
  };

  const postedTotalPiastres = expenses
    .filter((e) => e.expense.status === 'posted')
    .reduce((sum, e) => sum + e.expense.amountPiastres, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">المصروفات التشغيلية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            كل مصروف يخصم مباشرة من الخزنة المحددة، وأي تعديل أو إلغاء يتم بقيد عكسي موثق.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCatModalOpen(true)}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
          >
            <Tag className="w-4 h-4 text-[#C9A227]" />
            <span>تصنيف جديد</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#C9A227]" />
            <span>تسجيل مصروف</span>
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

      {/* Summary Banner */}
      <div className="rounded-2xl bg-[#0B1F3A] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-300">إجمالي المصروفات المعتمدة (حسب الفلتر)</p>
          <p className="mt-1 text-2xl font-bold text-[#DBBA4B] tabular-nums">
            {formatEGP(postedTotalPiastres, currency)}
          </p>
        </div>
        <div className="text-xs text-slate-300 tabular-nums">
          عدد التصنيفات المتاحة: <span className="font-bold text-white">{categories.length}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم السند أو البيان أو التصنيف..."
            className="w-full min-h-[44px] rounded-xl border border-slate-300 pr-10 pl-3 text-sm"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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

        <div className="lg:col-span-5 flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {(
            [
              {id: 'all', label: 'الكل'},
              {id: 'posted', label: 'معتمدة'},
              {id: 'reversed', label: 'ملغاة (قيد عكسي)'},
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                statusFilter === s.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expenses List */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          جارٍ تحميل المصروفات...
        </div>
      ) : expenses.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <WalletCards className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
          <p className="text-base font-bold text-[#0B1F3A]">لا توجد مصروفات مسجلة</p>
          <p className="mt-1 text-xs text-slate-500">
            سجّل مصروفات النقل والوقود والعمالة والإيجار والكهرباء والصيانة لمتابعة صافي الربح بدقة.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((entry) => {
            const isPosted = entry.expense.status === 'posted';
            return (
              <article
                key={entry.expense.id}
                className={`rounded-2xl bg-white border p-4 sm:p-5 ${
                  isPosted ? 'border-slate-200' : 'border-red-200 bg-red-50/30'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[#0B1F3A]" dir="ltr">
                        {entry.expense.voucherNumber}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-sm font-bold text-[#9E7B14]">
                        {entry.categoryName}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span
                        className={`text-xs font-bold ${
                          isPosted ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {isPosted ? 'معتمد' : 'ملغى (قيد عكسي)'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {entry.expense.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                      {entry.expense.expenseDate} · {entry.paymentMethodName} · {entry.actorName}
                      {entry.expense.amendedFromId ? ' · معدّل عن سند سابق' : ''}
                    </p>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2">
                    <span className="text-lg font-bold text-[#0B1F3A] tabular-nums">
                      {formatEGP(entry.expense.amountPiastres, currency)}
                    </span>

                    {isPosted && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openAmendModal(entry)}
                          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setReverseTarget(entry)}
                          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إلغاء بقيد عكسي</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Amend Expense Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                {amendingId ? 'تعديل مصروف (بقيد عكسي)' : 'تسجيل مصروف جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitExpense(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التصنيف
                </label>
                <select
                  required
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
                    value={amountEgp}
                    onChange={(e) => setAmountEgp(e.target.value)}
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
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  طريقة الدفع / الخزنة
                </label>
                <select
                  required
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  البيان والملاحظات
                </label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="تفاصيل المصروف..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
              >
                {submitting
                  ? 'جارٍ الحفظ...'
                  : amendingId
                  ? 'اعتماد التعديل وعكس السند السابق'
                  : 'اعتماد المصروف وخصمه من الخزنة'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* New Category Modal */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0B1F3A]">إضافة تصنيف مصروفات جديد</h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateCategory(e)} className="space-y-3">
              <input
                type="text"
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="مثال: دعاية وتغليف"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
              />
              <button
                type="submit"
                className="w-full min-h-[44px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                حفظ التصنيف
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Confirmation Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-lg font-bold text-[#0B1F3A]">
              تأكيد إلغاء المصروف {reverseTarget.expense.voucherNumber}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              لن يتم حذف السند، بل سيتم عكسه بقيد عكسي وإرجاع مبلغ{' '}
              <span className="font-bold text-[#0B1F3A]">
                {formatEGP(reverseTarget.expense.amountPiastres, currency)}
              </span>{' '}
              إلى الخزنة.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmReverse()}
                className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold hover:bg-red-800 cursor-pointer"
              >
                تأكيد الإلغاء بالقيد العكسي
              </button>
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                تراجع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
