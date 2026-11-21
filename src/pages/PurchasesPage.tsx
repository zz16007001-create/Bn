import {
  Check,
  Edit3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Truck,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {itemRepository, type ItemWithDetails} from '../repositories/itemRepository';
import {
  purchaseRepository,
  type PurchaseInvoiceWithDetails,
} from '../repositories/purchaseRepository';
import {
  purchaseReturnRepository,
  type PurchaseReturnWithDetails,
} from '../repositories/purchaseReturnRepository';
import {supplierRepository, type SupplierWithTotals} from '../repositories/supplierRepository';
import {warehouseRepository, type WarehouseWithStats} from '../repositories/warehouseRepository';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

interface DraftPurchaseLine {
  key: string;
  itemId: string;
  unitId: string;
  quantity: string;
  unitCostEgp: string;
}

export const PurchasesPage: React.FC<{initialTab?: 'list' | 'returns'}> = ({
  initialTab = 'list',
}) => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';

  const canCreate = can('invoice.create');
  const canEdit = can('invoice.edit');
  const canCancel = can('invoice.cancel');

  const [tab, setTab] = useState<'list' | 'form' | 'returns'>(initialTab);
  const [invoices, setInvoices] = useState<PurchaseInvoiceWithDetails[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnWithDetails[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithTotals[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseWithStats[]>([]);
  const [items, setItems] = useState<ItemWithDetails[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'posted' | 'reversed'>('all');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Invoice form state (create or amend)
  const [amendingInvoiceId, setAmendingInvoiceId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISODate());
  const [discountEgp, setDiscountEgp] = useState('0');
  const [paidEgp, setPaidEgp] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftPurchaseLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Cancel confirmation modal
  const [cancelTarget, setCancelTarget] = useState<PurchaseInvoiceWithDetails | null>(null);

  // Purchase Return modal state
  const [returnTarget, setReturnTarget] = useState<PurchaseInvoiceWithDetails | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, string>>({});
  const [returnRefundMode, setReturnRefundMode] = useState<'supplier_credit' | 'cash_refund'>(
    'supplier_credit'
  );
  const [returnDate, setReturnDate] = useState(todayISODate());
  const [returnReason, setReturnReason] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invList, retList, supList, whList, itemList] = await Promise.all([
        purchaseRepository.listPurchaseInvoices({search, status: statusFilter}),
        purchaseReturnRepository.listPurchaseReturns(search),
        supplierRepository.listSuppliers(),
        warehouseRepository.listWarehouses(),
        itemRepository.listItems({status: 'active'}),
      ]);
      setInvoices(invList);
      setPurchaseReturns(retList);
      setSuppliers(supList);
      setWarehouses(whList);
      setItems(itemList);

      const defWh = whList.find((w) => w.warehouse.isDefault) ?? whList[0];
      if (defWh) setWarehouseId((prev) => prev || defWh.warehouse.id);
      if (supList[0]) setSupplierId((prev) => prev || supList[0].supplier.id);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const makeEmptyLine = useCallback((): DraftPurchaseLine => {
    const firstItem = items[0];
    return {
      key: String(Math.random()),
      itemId: firstItem?.item.id ?? '',
      unitId: firstItem?.baseUnit.id ?? '',
      quantity: '1',
      unitCostEgp: firstItem ? String(fromPiastres(firstItem.item.costPricePiastres)) : '0',
    };
  }, [items]);

  const startNewInvoice = () => {
    setAmendingInvoiceId(null);
    setInvoiceDate(todayISODate());
    setDiscountEgp('0');
    setPaidEgp('0');
    setNotes('');
    setLines(items.length > 0 ? [makeEmptyLine()] : []);
    setTab('form');
  };

  const startAmendInvoice = (entry: PurchaseInvoiceWithDetails) => {
    setAmendingInvoiceId(entry.invoice.id);
    setSupplierId(entry.invoice.supplierId);
    setWarehouseId(entry.invoice.warehouseId);
    setInvoiceDate(entry.invoice.invoiceDate);
    setDiscountEgp(String(fromPiastres(entry.invoice.discountPiastres)));
    setPaidEgp(String(fromPiastres(entry.invoice.paidPiastres)));
    setNotes(entry.invoice.notes);
    setLines(
      entry.lines.map((l) => ({
        key: l.line.id,
        itemId: l.line.itemId,
        unitId: l.line.unitId,
        quantity: String(l.line.quantity),
        unitCostEgp: String(fromPiastres(l.line.unitCostPiastres)),
      }))
    );
    setTab('form');
  };

  const handleLineItemChange = (idx: number, newItemId: string) => {
    const found = items.find((i) => i.item.id === newItemId);
    setLines((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              itemId: newItemId,
              unitId: found?.baseUnit.id ?? '',
              unitCostEgp: found ? String(fromPiastres(found.item.costPricePiastres)) : '0',
            }
          : row
      )
    );
  };

  const handleLineUnitChange = (idx: number, newUnitId: string) => {
    setLines((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const found = items.find((it) => it.item.id === row.itemId);
        const unit = found?.allUnits.find((u) => u.id === newUnitId);
        const suggestedCost =
          found && unit
            ? fromPiastres(found.item.costPricePiastres * unit.conversionFactor)
            : Number(row.unitCostEgp);
        return {
          ...row,
          unitId: newUnitId,
          unitCostEgp: String(suggestedCost),
        };
      })
    );
  };

  const subtotalPiastres = lines.reduce((sum, l) => {
    const qty = Number(l.quantity) || 0;
    const cost = toPiastres(l.unitCostEgp);
    return sum + Math.round(qty * cost);
  }, 0);
  const discountPiastres = toPiastres(discountEgp);
  const totalPiastres = Math.max(0, subtotalPiastres - discountPiastres);
  const paidPiastres = toPiastres(paidEgp);
  const remainingPiastres = Math.max(0, totalPiastres - paidPiastres);

  const handleSubmitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    setSubmitting(true);

    try {
      const payload = {
        supplierId,
        warehouseId,
        invoiceDate,
        discountPiastres,
        paidPiastres,
        notes,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          unitId: l.unitId,
          quantity: Number(l.quantity),
          unitCostPiastres: toPiastres(l.unitCostEgp),
        })),
      };

      if (amendingInvoiceId) {
        const res = await purchaseRepository.amendPurchaseInvoice(
          session.user,
          amendingInvoiceId,
          payload
        );
        setFeedback({
          type: 'success',
          text: `تم تعديل الفاتورة بقيد عكسي واعتماد الفاتورة الجديدة (${res.invoice.invoiceNumber}).`,
        });
      } else {
        const res = await purchaseRepository.createPurchaseInvoice(session.user, payload);
        setFeedback({
          type: 'success',
          text: `تم اعتماد فاتورة الشراء (${res.invoice.invoiceNumber}) وتحديث المخزون ومتوسط التكلفة.`,
        });
      }

      setTab('list');
      setAmendingInvoiceId(null);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد فاتورة الشراء.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!session || !cancelTarget) return;
    setFeedback(null);
    try {
      await purchaseRepository.cancelPurchaseInvoice(
        session.user,
        cancelTarget.invoice.id,
        'إلغاء فاتورة شراء من المستخدم'
      );
      setFeedback({
        type: 'success',
        text: `تم إلغاء الفاتورة (${cancelTarget.invoice.invoiceNumber}) وعكس المخزون وحساب المورد.`,
      });
      setCancelTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إلغاء الفاتورة.',
      });
    }
  };

  const openReturnModal = (entry: PurchaseInvoiceWithDetails) => {
    setFeedback(null);
    setReturnTarget(entry);
    const initialQtys: Record<string, string> = {};
    for (const l of entry.lines) {
      initialQtys[l.line.id] = '0';
    }
    setReturnQtys(initialQtys);
    setReturnRefundMode('supplier_credit');
    setReturnDate(todayISODate());
    setReturnReason('');
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !returnTarget) return;
    setFeedback(null);
    setReturnSubmitting(true);
    try {
      const selectedLines = returnTarget.lines
        .map((l) => ({
          purchaseInvoiceLineId: l.line.id,
          quantity: Number(returnQtys[l.line.id] ?? 0),
        }))
        .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);

      const res = await purchaseReturnRepository.createPurchaseReturn(session.user, {
        purchaseInvoiceId: returnTarget.invoice.id,
        returnDate,
        refundMode: returnRefundMode,
        reason: returnReason,
        lines: selectedLines,
      });

      setFeedback({
        type: 'success',
        text: `تم تسجيل مرتجع الشراء (${res.record.returnNumber}) بقيمة ${formatEGP(res.record.totalPiastres, currency)}.`,
      });
      setReturnTarget(null);
      setTab('returns');
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل مرتجع الشراء.',
      });
    } finally {
      setReturnSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">فواتير ومرتجعات المشتريات</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            اعتماد الشراء يضيف للمخزون ويعيد حساب متوسط التكلفة، ومرتجع الشراء يخصم من المخزون ويحدث المورد أو الخزنة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTab('list');
                setAmendingInvoiceId(null);
              }}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                tab === 'list' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700'
              }`}
            >
              الفواتير ({invoices.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('returns');
                setAmendingInvoiceId(null);
              }}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-bold cursor-pointer ${
                tab === 'returns' ? 'bg-[#0B1F3A] text-white' : 'text-slate-700'
              }`}
            >
              مرتجعات المشتريات ({purchaseReturns.length})
            </button>
          </div>

          {canCreate && tab !== 'form' && (
            <button
              type="button"
              onClick={startNewInvoice}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#C9A227]" />
              <span>فاتورة شراء جديدة</span>
            </button>
          )}
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

      {tab === 'returns' ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم المرتجع أو فاتورة الشراء أو المورد..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 pr-10 pl-3.5 text-sm"
              />
            </div>
            <p className="text-xs text-slate-500">
              لعمل مرتجع شراء جديد، اختر الفاتورة الأصلية من تبويب «الفواتير» واضغط «مرتجع شراء».
            </p>
          </div>

          {purchaseReturns.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
              <RotateCcw className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
              <p className="text-base font-bold text-[#0B1F3A]">لا توجد مرتجعات مشتريات</p>
            </div>
          ) : (
            <div className="space-y-3">
              {purchaseReturns.map((ret) => (
                <article
                  key={ret.record.id}
                  className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-[#0B1F3A]" dir="ltr">
                          {ret.record.returnNumber}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-xs font-semibold text-slate-600">
                          عن فاتورة {ret.invoiceNumber}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-sm font-bold text-slate-900">
                          {ret.supplierName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {ret.record.returnDate} · {ret.warehouseName} ·{' '}
                        {ret.record.refundMode === 'cash_refund'
                          ? 'مسترد نقداً في الخزنة'
                          : 'تخفيض مستحقات المورد'}
                        {ret.record.reason ? ` · السبب: ${ret.record.reason}` : ''}
                      </p>
                    </div>
                    <div className="text-base font-bold text-[#0B1F3A] tabular-nums">
                      {formatEGP(ret.record.totalPiastres, currency)}
                    </div>
                  </div>
                  <div className="mt-2.5 space-y-1 text-xs">
                    {ret.lines.map((l) => (
                      <div key={l.line.id} className="flex justify-between text-slate-700">
                        <span>
                          {l.itemName} — {l.line.quantity} {l.unitName} ({l.line.baseQuantity} قطعة)
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatEGP(l.line.lineTotalPiastres, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'list' ? (
        <div className="space-y-4">
          {/* Search and Filter */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الفاتورة أو اسم المورد..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 pr-10 pl-3.5 text-sm"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  {id: 'all', label: 'الكل'},
                  {id: 'posted', label: 'معتمدة'},
                  {id: 'reversed', label: 'ملغاة/معكوسة'},
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                    statusFilter === s.id ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
              جارٍ تحميل الفواتير...
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
              <Truck className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
              <p className="text-base font-bold text-[#0B1F3A]">لا توجد فواتير شراء</p>
              <p className="mt-1 text-xs text-slate-500">
                تأكد من إضافة مورد وأصناف أولاً ثم أنشئ أول فاتورة شراء.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {invoices.map((entry) => {
                const isPosted = entry.invoice.status === 'posted';
                return (
                  <article
                    key={entry.invoice.id}
                    className={`rounded-2xl bg-white border p-4 sm:p-5 ${
                      isPosted ? 'border-slate-200' : 'border-red-200 bg-red-50/30'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-[#0B1F3A]" dir="ltr">
                            {entry.invoice.invoiceNumber}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-sm font-bold text-slate-900">
                            {entry.supplierName}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span
                            className={`text-xs font-bold ${
                              isPosted ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {isPosted ? 'معتمدة' : 'ملغاة (قيد عكسي)'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 tabular-nums">
                          {entry.invoice.invoiceDate} · {entry.warehouseName}
                          {entry.invoice.amendedFromId ? ' · معدّلة عن فاتورة سابقة' : ''}
                        </p>
                      </div>

                      <div className="text-left sm:text-left tabular-nums">
                        <div className="text-base font-bold text-[#0B1F3A]">
                          {formatEGP(entry.invoice.totalPiastres, currency)}
                        </div>
                        <div className="text-xs text-slate-500">
                          مدفوع: {formatEGP(entry.invoice.paidPiastres, currency)} · متبقي:{' '}
                          {formatEGP(entry.invoice.remainingPiastres, currency)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs">
                      {entry.lines.map((l) => (
                        <div
                          key={l.line.id}
                          className="flex items-center justify-between gap-2 text-slate-700"
                        >
                          <span>
                            {l.itemName} — {l.line.quantity} {l.unitName} ({l.line.baseQuantity} قطعة)
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatEGP(l.line.lineTotalPiastres, currency)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {isPosted && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openReturnModal(entry)}
                          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#C9A227] bg-[#FAF3DC] px-3.5 text-xs font-bold text-[#0B1F3A] hover:bg-[#f4e7be] cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[#9E7B14]" />
                          <span>مرتجع شراء</span>
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startAmendInvoice(entry)}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل بقيد عكسي</span>
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(entry)}
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إلغاء الفاتورة</span>
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Create / Amend Purchase Invoice Form */
        <form onSubmit={(e) => void handleSubmitInvoice(e)} className="space-y-4">
          {suppliers.length === 0 || items.length === 0 ? (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-sm font-semibold text-amber-900">
              يرجى إضافة مورد واحد وصنف واحد نشط على الأقل قبل إنشاء فاتورة شراء.
            </div>
          ) : (
            <>
              <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                <h3 className="text-base font-bold text-[#0B1F3A]">
                  {amendingInvoiceId
                    ? 'تعديل فاتورة شراء (سيتم عكس الفاتورة السابقة تلقائياً)'
                    : 'بيانات فاتورة الشراء'}
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      المورد
                    </label>
                    <select
                      required
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                    >
                      {suppliers.map((s) => (
                        <option key={s.supplier.id} value={s.supplier.id}>
                          {s.supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      المخزن المستلم
                    </label>
                    <select
                      required
                      value={warehouseId}
                      onChange={(e) => setWarehouseId(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                    >
                      {warehouses.map((w) => (
                        <option key={w.warehouse.id} value={w.warehouse.id}>
                          {w.warehouse.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      تاريخ الفاتورة
                    </label>
                    <input
                      type="date"
                      required
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                    />
                  </div>
                </div>
              </section>

              {/* Lines */}
              <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[#0B1F3A]">أصناف الفاتورة</h3>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, makeEmptyLine()])}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 text-xs font-bold text-[#0B1F3A] cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة سطر</span>
                  </button>
                </div>

                {lines.map((line, idx) => {
                  const foundItem = items.find((i) => i.item.id === line.itemId);
                  const foundUnit = foundItem?.allUnits.find((u) => u.id === line.unitId);
                  const baseQty = Math.round(
                    (Number(line.quantity) || 0) * (foundUnit?.conversionFactor ?? 1)
                  );
                  const lineTotal = Math.round(
                    (Number(line.quantity) || 0) * toPiastres(line.unitCostEgp)
                  );

                  return (
                    <div
                      key={line.key}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            الصنف
                          </label>
                          <select
                            value={line.itemId}
                            onChange={(e) => handleLineItemChange(idx, e.target.value)}
                            className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-sm"
                          >
                            {items.map((i) => (
                              <option key={i.item.id} value={i.item.id}>
                                {i.item.name} ({i.item.sku})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            الوحدة
                          </label>
                          <select
                            value={line.unitId}
                            onChange={(e) => handleLineUnitChange(idx, e.target.value)}
                            className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-sm"
                          >
                            {(foundItem?.allUnits ?? []).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.conversionFactor} قطعة)
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            الكمية
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            dir="ltr"
                            value={line.quantity}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? {...r, quantity: e.target.value} : r
                                )
                              )
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-left tabular-nums text-sm font-bold"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            سعر الوحدة (ج.م)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            required
                            dir="ltr"
                            value={line.unitCostEgp}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? {...r, unitCostEgp: e.target.value} : r
                                )
                              )
                            }
                            className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-left tabular-nums text-sm font-bold"
                          />
                        </div>

                        <div className="sm:col-span-1 flex justify-end">
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLines((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-red-200 bg-white text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                        <span>المضاف للمخزون: {baseQty} قطعة</span>
                        <span className="font-bold text-[#0B1F3A]">
                          إجمالي البند: {formatEGP(lineTotal, currency)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </section>

              {/* Totals & Payment */}
              <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      الخصم (ج.م)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      value={discountEgp}
                      onChange={(e) => setDiscountEgp(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left tabular-nums font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      المدفوع للمورد الآن (ج.م)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      value={paidEgp}
                      onChange={(e) => setPaidEgp(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left tabular-nums font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      ملاحظات
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-sm tabular-nums">
                  <div>
                    <span className="text-slate-500">الإجمالي قبل الخصم: </span>
                    <span className="font-bold">{formatEGP(subtotalPiastres, currency)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">الصافي: </span>
                    <span className="text-lg font-bold text-[#0B1F3A]">
                      {formatEGP(totalPiastres, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">المتبقي على الحساب: </span>
                    <span className="font-bold text-red-700">
                      {formatEGP(remainingPiastres, currency)}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || lines.length === 0}
                  className="w-full min-h-[50px] rounded-xl bg-[#0B1F3A] text-white text-base font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
                >
                  {submitting
                    ? 'جارٍ الاعتماد...'
                    : amendingInvoiceId
                    ? 'اعتماد التعديل وعكس الفاتورة السابقة'
                    : 'اعتماد فاتورة الشراء'}
                </button>
              </section>
            </>
          )}
        </form>
      )}

      {/* Cancel confirmation modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-lg font-bold text-[#0B1F3A]">
              تأكيد إلغاء فاتورة شراء {cancelTarget.invoice.invoiceNumber}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              لن يتم حذف الفاتورة، بل سيتم إنشاء قيود عكسية لخصم الكميات من المخزون وإعادة متوسط التكلفة وعكس حساب المورد ({cancelTarget.supplierName}).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmCancel()}
                className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold hover:bg-red-800 cursor-pointer"
              >
                تأكيد الإلغاء بالقيد العكسي
              </button>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                تراجع
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Purchase Return Modal */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-lg font-bold text-[#0B1F3A]">
              مرتجع مشتريات عن فاتورة {returnTarget.invoice.invoiceNumber}
            </h3>
            <p className="text-xs text-slate-500">
              المورد: {returnTarget.supplierName} · المخزن: {returnTarget.warehouseName}
            </p>

            <form onSubmit={(e) => void handleSubmitReturn(e)} className="space-y-4">
              <div className="space-y-2.5">
                {returnTarget.lines.map((l) => {
                  const alreadyReturnedBase = l.line.returnedBaseQuantity ?? 0;
                  const remainingBase = Math.max(0, l.line.baseQuantity - alreadyReturnedBase);
                  const maxUnitQty = Math.floor(remainingBase / (l.conversionFactor || 1));
                  return (
                    <div
                      key={l.line.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0B1F3A] truncate">{l.itemName}</p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          المشترى: {l.line.quantity} {l.unitName} · المتاح للإرجاع: {maxUnitQty}{' '}
                          {l.unitName}
                        </p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={maxUnitQty}
                        step="1"
                        dir="ltr"
                        value={returnQtys[l.line.id] ?? '0'}
                        onChange={(e) =>
                          setReturnQtys((prev) => ({
                            ...prev,
                            [l.line.id]: e.target.value,
                          }))
                        }
                        className="w-24 min-h-[42px] rounded-xl border border-slate-300 bg-white px-2.5 text-center font-bold tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تاريخ المرتجع
                  </label>
                  <input
                    type="date"
                    required
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تسوية القيمة
                  </label>
                  <select
                    value={returnRefundMode}
                    onChange={(e) =>
                      setReturnRefundMode(
                        e.target.value as 'supplier_credit' | 'cash_refund'
                      )
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="supplier_credit">تخفيض مستحقات المورد</option>
                    <option value="cash_refund">استرداد نقدي إلى الخزنة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سبب المرتجع
                </label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="تلف / غير مطابق للمواصفات..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={returnSubmitting}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
                >
                  {returnSubmitting ? 'جارٍ الاعتماد...' : 'اعتماد مرتجع الشراء'}
                </button>
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
