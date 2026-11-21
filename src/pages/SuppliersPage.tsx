import {
  Banknote,
  Building2,
  Check,
  Edit3,
  FileText,
  Plus,
  Search,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {
  supplierRepository,
  type SupplierStatementEntry,
  type SupplierWithTotals,
} from '../repositories/supplierRepository';
import type {SupplierRecord} from '../types/domain';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

export const SuppliersPage: React.FC = () => {
  const {session, companySettings} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';

  const [suppliers, setSuppliers] = useState<SupplierWithTotals[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Add/Edit Supplier modal
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSup, setEditingSup] = useState<SupplierRecord | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Payment modal
  const [payTarget, setPayTarget] = useState<SupplierRecord | null>(null);
  const [payAmountEgp, setPayAmountEgp] = useState('');
  const [payDate, setPayDate] = useState(todayISODate());
  const [payNotes, setPayNotes] = useState('');

  // Statement modal
  const [statementData, setStatementData] = useState<{
    supplier: SupplierRecord;
    entries: SupplierStatementEntry[];
    totalPurchasesPiastres: number;
    totalPaymentsPiastres: number;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await supplierRepository.listSuppliers(search);
      setSuppliers(list);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openAddModal = () => {
    setEditingSup(null);
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
    setSupModalOpen(true);
  };

  const openEditModal = (sup: SupplierRecord) => {
    setEditingSup(sup);
    setName(sup.name);
    setPhone(sup.phone);
    setAddress(sup.address);
    setNotes(sup.notes);
    setSupModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    try {
      if (editingSup) {
        await supplierRepository.updateSupplier(session.user, editingSup.id, {
          name,
          phone,
          address,
          notes,
        });
        setFeedback({type: 'success', text: `تم تحديث بيانات المورد (${name}).`});
      } else {
        await supplierRepository.createSupplier(session.user, {
          name,
          phone,
          address,
          notes,
        });
        setFeedback({type: 'success', text: `تمت إضافة المورد (${name}) بنجاح.`});
      }
      setSupModalOpen(false);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ المورد.',
      });
    }
  };

  const openPaymentModal = (sup: SupplierRecord) => {
    setPayTarget(sup);
    setPayAmountEgp(
      sup.currentBalancePiastres > 0 ? String(fromPiastres(sup.currentBalancePiastres)) : ''
    );
    setPayDate(todayISODate());
    setPayNotes('');
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !payTarget) return;
    setFeedback(null);
    try {
      const payment = await supplierRepository.recordSupplierPayment(session.user, {
        supplierId: payTarget.id,
        amountPiastres: toPiastres(payAmountEgp),
        paymentDate: payDate,
        notes: payNotes,
      });
      setPayTarget(null);
      setFeedback({
        type: 'success',
        text: `تم تسجيل دفعة للمورد (${payTarget.name}) بسند ${payment.voucherNumber}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل الدفعة.',
      });
    }
  };

  const openStatement = async (supId: string) => {
    const data = await supplierRepository.getSupplierStatement(supId);
    setStatementData(data);
  };

  const totalOwed = suppliers.reduce((s, item) => s + item.supplier.currentBalancePiastres, 0);
  const totalPurchases = suppliers.reduce((s, item) => s + item.totalPurchasesPiastres, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">الموردون وكشوف الحساب</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة موردي البن والغذائيات، متابعة المستحقات، تسجيل الدفعات، وكشف الحساب التفصيلي.
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#C9A227]" />
          <span>مورد جديد</span>
        </button>
      </div>

      {/* Totals Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">عدد الموردين</span>
          <p className="mt-1 text-xl font-bold text-[#0B1F3A] tabular-nums">
            {suppliers.length}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">إجمالي المشتريات</span>
          <p className="mt-1 text-lg sm:text-xl font-bold text-[#0B1F3A] tabular-nums">
            {formatEGP(totalPurchases, currency)}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">إجمالي المستحق للموردين</span>
          <p className="mt-1 text-lg sm:text-xl font-bold text-[#9E7B14] tabular-nums">
            {formatEGP(totalOwed, currency)}
          </p>
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

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم المورد أو الكود أو الهاتف..."
          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pr-10 pl-3.5 text-sm focus:border-[#0B1F3A] focus:outline-none"
        />
      </div>

      {/* Suppliers Grid */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          جارٍ تحميل الموردين...
        </div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <Building2 className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
          <p className="text-base font-bold text-[#0B1F3A]">لا يوجد موردون مسجلون</p>
          <p className="mt-1 text-xs text-slate-500">أضف أول مورد لبدء تسجيل فواتير الشراء.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {suppliers.map(({supplier, totalPurchasesPiastres, totalPaidPiastres, invoicesCount}) => (
            <article
              key={supplier.id}
              className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[#0B1F3A]">{supplier.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="font-mono" dir="ltr">
                        {supplier.code}
                      </span>
                      {supplier.phone && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums" dir="ltr">
                            {supplier.phone}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {invoicesCount} فاتورة
                  </span>
                </div>

                {supplier.address && (
                  <p className="mt-1.5 text-xs text-slate-600">{supplier.address}</p>
                )}
                {supplier.notes && (
                  <p className="mt-1 text-xs text-slate-500">{supplier.notes}</p>
                )}

                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 block">المشتريات</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {formatEGP(totalPurchasesPiastres, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">المدفوع</span>
                    <span className="font-bold text-emerald-700 tabular-nums">
                      {formatEGP(totalPaidPiastres, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">المستحق للمورد</span>
                    <span
                      className={`font-bold tabular-nums ${
                        supplier.currentBalancePiastres > 0
                          ? 'text-red-700'
                          : 'text-[#0B1F3A]'
                      }`}
                    >
                      {formatEGP(supplier.currentBalancePiastres, currency)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => void openStatement(supplier.id)}
                  className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 text-xs font-bold text-[#0B1F3A] cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>كشف حساب</span>
                </button>

                <button
                  type="button"
                  onClick={() => openPaymentModal(supplier)}
                  className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0B1F3A] hover:bg-[#133159] px-3 text-xs font-bold text-white cursor-pointer"
                >
                  <Banknote className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>تسجيل دفعة</span>
                </button>

                <button
                  type="button"
                  onClick={() => openEditModal(supplier)}
                  className="min-h-[40px] inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>تعديل</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add/Edit Supplier Modal */}
      {supModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                {editingSup ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setSupModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveSupplier(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المورد / الشركة
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الهاتف</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                {editingSup ? 'حفظ التعديلات' : 'حفظ المورد'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                تسجيل دفعة للمورد: {payTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-4 tabular-nums">
              الرصيد المستحق الحالي: {formatEGP(payTarget.currentBalancePiastres, currency)}
            </p>
            <form onSubmit={(e) => void handleRecordPayment(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  المبلغ المدفوع (ج.م)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  dir="ltr"
                  value={payAmountEgp}
                  onChange={(e) => setPayAmountEgp(e.target.value)}
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-left text-base font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">التاريخ</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="سداد نقدي / تحويل بنكي..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                اعتماد الدفعة
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Statement Modal */}
      {statementData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-[#0B1F3A]">
                  كشف حساب المورد: {statementData.supplier.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  إجمالي المشتريات: {formatEGP(statementData.totalPurchasesPiastres, currency)} ·
                  إجمالي المدفوعات: {formatEGP(statementData.totalPaymentsPiastres, currency)} ·
                  الرصيد المستحق: {formatEGP(statementData.supplier.currentBalancePiastres, currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatementData(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto border border-slate-200 rounded-xl">
              {statementData.entries.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  لا توجد معاملات مسجلة لهذا المورد بعد.
                </p>
              ) : (
                <table className="w-full min-w-[620px] text-xs sm:text-sm border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-right text-xs text-slate-600">
                    <tr>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">البيان</th>
                      <th className="p-3">المرجع</th>
                      <th className="p-3">مدين (سداد)</th>
                      <th className="p-3">دائن (مشتريات)</th>
                      <th className="p-3">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementData.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="p-3 tabular-nums whitespace-nowrap">{entry.date}</td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-900">{entry.typeLabelAr}</div>
                          <div className="text-[11px] text-slate-500">{entry.notes}</div>
                        </td>
                        <td className="p-3 font-mono text-xs" dir="ltr">
                          {entry.referenceNumber}
                        </td>
                        <td className="p-3 tabular-nums font-semibold text-emerald-700">
                          {entry.debitPiastres > 0
                            ? formatEGP(entry.debitPiastres, currency)
                            : '-'}
                        </td>
                        <td className="p-3 tabular-nums font-semibold text-[#0B1F3A]">
                          {entry.creditPiastres > 0
                            ? formatEGP(entry.creditPiastres, currency)
                            : '-'}
                        </td>
                        <td className="p-3 tabular-nums font-bold text-[#0B1F3A]">
                          {formatEGP(entry.runningBalancePiastres, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
