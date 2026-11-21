import {
  Banknote,
  Check,
  Edit3,
  FileText,
  Plus,
  Printer,
  Search,
  Users,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {
  customerRepository,
  type CustomerStatementEntry,
  type CustomerWithTotals,
} from '../repositories/customerRepository';
import type {CustomerRecord, SalesInvoiceRecord} from '../types/domain';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

export const CustomersPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<CustomerWithTotals[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Add/Edit Customer modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCust, setEditingCust] = useState<CustomerRecord | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimitEgp, setCreditLimitEgp] = useState('');
  const [notes, setNotes] = useState('');

  // Statement modal
  const [statementData, setStatementData] = useState<{
    customer: CustomerRecord;
    entries: CustomerStatementEntry[];
    totalSalesPiastres: number;
    totalCollectionsPiastres: number;
    totalReturnsCreditPiastres: number;
    linkedInvoices: SalesInvoiceRecord[];
  } | null>(null);
  const [statementTab, setStatementTab] = useState<'ledger' | 'invoices'>('ledger');

  const canManageCollections = can('collections.manage');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await customerRepository.listCustomers(search);
      setCustomers(list);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openAddModal = () => {
    setEditingCust(null);
    setName('');
    setPhone('');
    setArea('');
    setAddress('');
    setCreditLimitEgp('');
    setNotes('');
    setModalOpen(true);
  };

  const openEditModal = (cust: CustomerRecord) => {
    setEditingCust(cust);
    setName(cust.name);
    setPhone(cust.phone);
    setArea(cust.area);
    setAddress(cust.address);
    setCreditLimitEgp(
      cust.creditLimitPiastres > 0 ? String(fromPiastres(cust.creditLimitPiastres)) : ''
    );
    setNotes(cust.notes);
    setModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    try {
      const limitPiastres = toPiastres(creditLimitEgp);
      if (editingCust) {
        await customerRepository.updateCustomer(session.user, editingCust.id, {
          name,
          phone,
          area,
          address,
          notes,
          creditLimitPiastres: limitPiastres,
        });
        setFeedback({type: 'success', text: `تم تحديث بيانات العميل (${name}).`});
      } else {
        await customerRepository.createCustomer(session.user, {
          name,
          phone,
          area,
          address,
          notes,
          creditLimitPiastres: limitPiastres,
        });
        setFeedback({type: 'success', text: `تمت إضافة العميل (${name}) بنجاح.`});
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ العميل.',
      });
    }
  };

  const openStatement = async (custId: string) => {
    const data = await customerRepository.getCustomerStatement(custId);
    setStatementTab('ledger');
    setStatementData(data);
  };

  const totalDebt = customers.reduce(
    (s, item) => s + Math.max(0, item.customer.currentBalancePiastres),
    0
  );
  const totalSales = customers.reduce((s, item) => s + item.totalSalesPiastres, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">العملاء وكشوف الحساب</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة عملاء المقاهي والسوبرماركت، متابعة المديونية، الفواتير المرتبطة، وكشف الحساب القابل للطباعة.
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#C9A227]" />
          <span>عميل جديد</span>
        </button>
      </div>

      {/* Totals Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">عدد العملاء</span>
          <p className="mt-1 text-xl font-bold text-[#0B1F3A] tabular-nums">{customers.length}</p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">إجمالي المبيعات</span>
          <p className="mt-1 text-lg sm:text-xl font-bold text-[#0B1F3A] tabular-nums">
            {formatEGP(totalSales, currency)}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-2xl bg-white border border-slate-200 p-4">
          <span className="text-xs text-slate-500 font-semibold">إجمالي مديونيات العملاء</span>
          <p className="mt-1 text-lg sm:text-xl font-bold text-red-700 tabular-nums">
            {formatEGP(totalDebt, currency)}
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
          placeholder="بحث باسم العميل أو الكود أو الهاتف أو المنطقة..."
          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pr-10 pl-3.5 text-sm focus:border-[#0B1F3A] focus:outline-none"
        />
      </div>

      {/* Customers Grid */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          جارٍ تحميل العملاء...
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <Users className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
          <p className="text-base font-bold text-[#0B1F3A]">لا يوجد عملاء مسجلون</p>
          <p className="mt-1 text-xs text-slate-500">
            أضف أول عميل لمتابعة فواتير المبيعات الآجلة والتحصيلات.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {customers.map(
            ({customer, totalSalesPiastres, totalPaidPiastres, invoicesCount}) => (
              <article
                key={customer.id}
                className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-[#0B1F3A]">{customer.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono" dir="ltr">
                          {customer.code}
                        </span>
                        {customer.phone && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="tabular-nums" dir="ltr">
                              {customer.phone}
                            </span>
                          </>
                        )}
                        {customer.area && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{customer.area}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {invoicesCount} فاتورة
                    </span>
                  </div>

                  {customer.address && (
                    <p className="mt-1.5 text-xs text-slate-600">{customer.address}</p>
                  )}
                  {customer.notes && (
                    <p className="mt-1 text-xs text-slate-500">{customer.notes}</p>
                  )}

                  <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500 block">المبيعات</span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatEGP(totalSalesPiastres, currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">المحصل</span>
                      <span className="font-bold text-emerald-700 tabular-nums">
                        {formatEGP(totalPaidPiastres, currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        {customer.currentBalancePiastres < 0 ? 'رصيد دائن للعميل' : 'المديونية الحالية'}
                      </span>
                      <span
                        className={`font-bold tabular-nums ${
                          customer.currentBalancePiastres > 0
                            ? 'text-red-700'
                            : customer.currentBalancePiastres < 0
                            ? 'text-emerald-700'
                            : 'text-[#0B1F3A]'
                        }`}
                      >
                        {formatEGP(Math.abs(customer.currentBalancePiastres), currency)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => void openStatement(customer.id)}
                    className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 text-xs font-bold text-[#0B1F3A] cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>كشف حساب</span>
                  </button>

                  {canManageCollections && (
                    <button
                      type="button"
                      onClick={() => navigate(`/collections?customer=${customer.id}`)}
                      className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0B1F3A] hover:bg-[#133159] px-3 text-xs font-bold text-white cursor-pointer"
                    >
                      <Banknote className="w-3.5 h-3.5 text-[#C9A227]" />
                      <span>تحصيل</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(customer)}
                    className="min-h-[40px] inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>
                </div>
              </article>
            )
          )}
        </div>
      )}

      {/* Add/Edit Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                {editingCust ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveCustomer(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم العميل / المحل
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">المنطقة</label>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  حد الائتمان الاسترشادي (ج.م)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  dir="ltr"
                  value={creditLimitEgp}
                  onChange={(e) => setCreditLimitEgp(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left text-sm tabular-nums"
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
                {editingCust ? 'حفظ التعديلات' : 'حفظ العميل'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Printable Customer Statement Modal */}
      {statementData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-xs print:bg-white print:p-0 print:block">
          <div className="print-only-container w-full max-w-4xl rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
            {/* Modal Toolbar (non-print) */}
            <div className="no-print flex items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatementTab('ledger')}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-bold cursor-pointer ${
                    statementTab === 'ledger'
                      ? 'bg-[#0B1F3A] text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  كشف الحساب التفصيلي
                </button>
                <button
                  type="button"
                  onClick={() => setStatementTab('invoices')}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-bold cursor-pointer ${
                    statementTab === 'invoices'
                      ? 'bg-[#0B1F3A] text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  الفواتير المرتبطة ({statementData.linkedInvoices.length})
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-3.5 text-xs font-bold text-white hover:bg-[#133159] cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>طباعة كشف الحساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatementData(null)}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Print Header */}
            <div className="flex items-start justify-between gap-4 pb-3 mb-3 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-extrabold text-[#0B1F3A]">
                  كشف حساب عميل: {statementData.customer.name}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                  {companySettings?.companyName ?? 'نُخبة البن للتوزيع'} · كود:{' '}
                  {statementData.customer.code}
                  {statementData.customer.phone ? ` · ${statementData.customer.phone}` : ''}
                </p>
              </div>
              <div className="text-left text-xs tabular-nums space-y-0.5">
                <div>
                  المبيعات: <strong>{formatEGP(statementData.totalSalesPiastres, currency)}</strong>
                </div>
                <div>
                  التحصيلات:{' '}
                  <strong className="text-emerald-700">
                    {formatEGP(statementData.totalCollectionsPiastres, currency)}
                  </strong>
                </div>
                <div>
                  الرصيد الحالي:{' '}
                  <strong className="text-red-700">
                    {formatEGP(statementData.customer.currentBalancePiastres, currency)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto border border-slate-200 rounded-xl">
              {statementTab === 'ledger' ? (
                statementData.entries.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">
                    لا توجد معاملات مسجلة لهذا العميل بعد.
                  </p>
                ) : (
                  <table className="w-full min-w-[640px] text-xs sm:text-sm border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-right text-xs text-slate-600">
                      <tr>
                        <th className="p-3">التاريخ</th>
                        <th className="p-3">البيان</th>
                        <th className="p-3">المرجع</th>
                        <th className="p-3">مدين (عليه)</th>
                        <th className="p-3">دائن (له)</th>
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
                          <td className="p-3 tabular-nums font-semibold text-[#0B1F3A]">
                            {entry.debitPiastres > 0
                              ? formatEGP(entry.debitPiastres, currency)
                              : '-'}
                          </td>
                          <td className="p-3 tabular-nums font-semibold text-emerald-700">
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
                )
              ) : statementData.linkedInvoices.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  لا توجد فواتير مبيعات لهذا العميل.
                </p>
              ) : (
                <table className="w-full min-w-[580px] text-xs sm:text-sm border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-right text-xs text-slate-600">
                    <tr>
                      <th className="p-3">رقم الفاتورة</th>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">الإجمالي</th>
                      <th className="p-3">المدفوع</th>
                      <th className="p-3">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementData.linkedInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="p-3 font-mono font-bold text-[#0B1F3A]" dir="ltr">
                          {inv.invoiceNumber}
                        </td>
                        <td className="p-3 tabular-nums">{inv.invoiceDate}</td>
                        <td className="p-3">
                          <span
                            className={`text-xs font-bold ${
                              inv.status === 'posted' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {inv.status === 'posted' ? 'معتمدة' : 'ملغاة'}
                          </span>
                        </td>
                        <td className="p-3 tabular-nums font-bold">
                          {formatEGP(inv.totalPiastres, currency)}
                        </td>
                        <td className="p-3 tabular-nums text-emerald-700">
                          {formatEGP(inv.paidPiastres, currency)}
                        </td>
                        <td className="p-3 tabular-nums text-red-700 font-bold">
                          {formatEGP(inv.remainingPiastres, currency)}
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
