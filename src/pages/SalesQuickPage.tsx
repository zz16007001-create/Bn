import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileText,
  Lock,
  Plus,
  Printer,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {InvoicePrintModal} from '../components/InvoicePrintModal';
import {useAuth} from '../context/AuthContext';
import {customerRepository, type CustomerWithTotals} from '../repositories/customerRepository';
import {itemRepository, type ItemWithDetails} from '../repositories/itemRepository';
import {
  salesRepository,
  type SalesInvoiceWithDetails,
  type SalesLineInput,
} from '../repositories/salesRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import {warehouseRepository} from '../repositories/warehouseRepository';
import type {PaymentMethodRecord, WarehouseRecord} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

interface RowEntryState {
  qtyText: string;
  unitId: string;
  unitPricePiastres: number;
  priceOverridden: boolean;
}

export const SalesQuickPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<'hub' | 'editor'>('hub');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [amendingInvoiceId, setAmendingInvoiceId] = useState<string | null>(null);
  const [amendingInvoiceNumber, setAmendingInvoiceNumber] = useState<string | null>(null);

  // Catalog & Reference data
  const [items, setItems] = useState<ItemWithDetails[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerWithTotals[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [warehouseStockMap, setWarehouseStockMap] = useState<Map<string, number>>(new Map());
  const [drafts, setDrafts] = useState<SalesInvoiceWithDetails[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<SalesInvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor form state
  const [warehouseId, setWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState<string>(''); // '' = walk-in (null)
  const [invoiceDate, setInvoiceDate] = useState(todayISODate());
  const [search, setSearch] = useState('');
  const [showZeroStock, setShowZeroStock] = useState(false);

  const [rowStates, setRowStates] = useState<Record<string, RowEntryState>>({});

  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountInputText, setDiscountInputText] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [paidEgpText, setPaidEgpText] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');

  // Quick-add Customer modal
  const [quickCustOpen, setQuickCustOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustArea, setNewCustArea] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  // Print preview after save
  const [savedPrintDetails, setSavedPrintDetails] = useState<SalesInvoiceWithDetails | null>(null);
  const [shouldAutoPrintModal, setShouldAutoPrintModal] = useState(false);

  // Double-submit guards
  const [clientRequestId, setClientRequestId] = useState<string>(() => generateUUID());
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Input refs for mobile Next-key navigation
  const qtyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const canCreate = can('invoice.create');
  const canEdit = can('invoice.edit');
  const canPriceOverride = can('price.override');
  const canDiscount = can('discount.apply');
  const canStockOverride = can('stock.override');

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemList, whList, custList, pmList, draftList, allSales] = await Promise.all([
        itemRepository.listItems({status: 'active'}),
        warehouseRepository.listWarehouses(),
        customerRepository.listCustomers(),
        settingsRepository.listPaymentMethods(),
        salesRepository.listSalesInvoices({status: 'draft'}),
        salesRepository.listSalesInvoices({status: 'posted'}),
      ]);
      const activeWh = whList.map((w) => w.warehouse).filter((w) => w.isActive);
      setItems(itemList);
      setWarehouses(activeWh);
      setCustomers(custList);
      setPaymentMethods(pmList);
      setDrafts(draftList);
      setRecentInvoices(allSales.slice(0, 5));

      const defWh = activeWh.find((w) => w.isDefault) ?? activeWh[0];
      if (defWh && !warehouseId) {
        setWarehouseId(defWh.id);
      }
      const defPm = pmList.find((p) => p.isDefault) ?? pmList[0];
      if (defPm && !paymentMethodId) {
        setPaymentMethodId(defPm.id);
      }
    } finally {
      setLoading(false);
    }
  }, [warehouseId, paymentMethodId]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  // Refresh stock map whenever warehouseId changes
  useEffect(() => {
    if (!warehouseId) return;
    let active = true;
    void warehouseRepository.getBalancesForWarehouse(warehouseId).then((balances) => {
      if (!active) return;
      const map = new Map<string, number>();
      for (const b of balances) {
        map.set(b.item.id, b.quantity);
      }
      setWarehouseStockMap(map);
    });
    return () => {
      active = false;
    };
  }, [warehouseId, items]);

  const buildInitialRowStates = useCallback(
    (itemList: ItemWithDetails[], presetDetails?: SalesInvoiceWithDetails): Record<string, RowEntryState> => {
      const next: Record<string, RowEntryState> = {};
      const lineByItem = new Map<string, SalesInvoiceWithDetails['lines'][number]>();
      if (presetDetails) {
        for (const l of presetDetails.lines) {
          lineByItem.set(l.line.itemId, l);
        }
      }

      for (const entry of itemList) {
        const preset = lineByItem.get(entry.item.id);
        if (preset) {
          const matchedUnit =
            entry.allUnits.find((u) => u.id === preset.line.unitId) ?? entry.baseUnit;
          const catalogPrice =
            matchedUnit.salePricePiastres > 0
              ? matchedUnit.salePricePiastres
              : matchedUnit.isBase
              ? entry.item.retailPricePiastres
              : entry.item.wholesalePricePiastres;
          next[entry.item.id] = {
            qtyText: String(preset.line.quantity),
            unitId: matchedUnit.id,
            unitPricePiastres: preset.line.unitPricePiastres,
            priceOverridden: preset.line.unitPricePiastres !== catalogPrice,
          };
        } else {
          const defaultUnit = entry.baseUnit;
          const defaultPrice =
            defaultUnit.salePricePiastres > 0
              ? defaultUnit.salePricePiastres
              : entry.item.retailPricePiastres;
          next[entry.item.id] = {
            qtyText: '',
            unitId: defaultUnit.id,
            unitPricePiastres: defaultPrice,
            priceOverridden: false,
          };
        }
      }
      return next;
    },
    []
  );

  const startNewInvoice = useCallback(() => {
    setFeedback(null);
    setEditingDraftId(null);
    setAmendingInvoiceId(null);
    setAmendingInvoiceNumber(null);
    setCustomerId('');
    setInvoiceDate(todayISODate());
    setSearch('');
    setDiscountType('fixed');
    setDiscountInputText('');
    setPaymentType('cash');
    setPaidEgpText('');
    setNotes('');
    setClientRequestId(generateUUID());
    setRowStates(buildInitialRowStates(items));
    setMode('editor');
  }, [items, buildInitialRowStates]);

  const openDraftOrAmend = useCallback(
    async (targetId: string, kind: 'draft' | 'amend') => {
      try {
        const details = await salesRepository.getSalesInvoiceDetails(targetId);
        const itemList = await itemRepository.listItems({status: 'active'});
        setItems(itemList);

        setWarehouseId(details.invoice.warehouseId);
        setCustomerId(details.invoice.customerId ?? '');
        setInvoiceDate(
          kind === 'draft' ? details.invoice.invoiceDate : todayISODate()
        );
        setDiscountType(details.invoice.discountType);
        setDiscountInputText(
          details.invoice.discountValue > 0
            ? details.invoice.discountType === 'fixed'
              ? String(fromPiastres(details.invoice.discountValue))
              : String(details.invoice.discountValue)
            : ''
        );
        setPaymentType(details.invoice.paymentType);
        setPaidEgpText(
          details.invoice.paymentType === 'partial'
            ? String(fromPiastres(details.invoice.paidPiastres))
            : ''
        );
        if (details.invoice.paymentMethodId) {
          setPaymentMethodId(details.invoice.paymentMethodId);
        }
        setNotes(details.invoice.notes);
        setRowStates(buildInitialRowStates(itemList, details));
        setClientRequestId(generateUUID());

        if (kind === 'draft') {
          setEditingDraftId(details.invoice.id);
          setAmendingInvoiceId(null);
          setAmendingInvoiceNumber(null);
        } else {
          setEditingDraftId(null);
          setAmendingInvoiceId(details.invoice.id);
          setAmendingInvoiceNumber(details.invoice.invoiceNumber);
        }
        setFeedback(null);
        setMode('editor');
      } catch (err) {
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'تعذر فتح الفاتورة.',
        });
      }
    },
    [buildInitialRowStates]
  );

  // Handle ?draft=... or ?amend=... URL query parameters
  useEffect(() => {
    const draftParam = searchParams.get('draft');
    const amendParam = searchParams.get('amend');
    if (draftParam) {
      void openDraftOrAmend(draftParam, 'draft');
      setSearchParams({}, {replace: true});
    } else if (amendParam) {
      void openDraftOrAmend(amendParam, 'amend');
      setSearchParams({}, {replace: true});
    }
  }, [searchParams, openDraftOrAmend, setSearchParams]);

  const updateRowState = (
    itemEntry: ItemWithDetails,
    updater: (prev: RowEntryState) => RowEntryState
  ) => {
    setRowStates((prev) => {
      const fallbackUnit = itemEntry.baseUnit;
      const fallbackPrice =
        fallbackUnit.salePricePiastres > 0
          ? fallbackUnit.salePricePiastres
          : itemEntry.item.retailPricePiastres;
      const current = prev[itemEntry.item.id] ?? {
        qtyText: '',
        unitId: fallbackUnit.id,
        unitPricePiastres: fallbackPrice,
        priceOverridden: false,
      };
      return {
        ...prev,
        [itemEntry.item.id]: updater(current),
      };
    });
  };

  const handleUnitSwitch = (itemEntry: ItemWithDetails, targetUnitId: string) => {
    const selectedUnit =
      itemEntry.allUnits.find((u) => u.id === targetUnitId) ?? itemEntry.baseUnit;
    const defaultPrice =
      selectedUnit.salePricePiastres > 0
        ? selectedUnit.salePricePiastres
        : selectedUnit.isBase
        ? itemEntry.item.retailPricePiastres
        : itemEntry.item.wholesalePricePiastres;
    updateRowState(itemEntry, (prev) => ({
      ...prev,
      unitId: selectedUnit.id,
      unitPricePiastres: defaultPrice,
      priceOverridden: false,
    }));
  };

  // Filtered visible vertical list
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((entry) => {
      const qtyNum = Number(rowStates[entry.item.id]?.qtyText || 0);
      const stockInWh = warehouseStockMap.get(entry.item.id) ?? 0;

      if (!showZeroStock && stockInWh <= 0 && !(qtyNum > 0)) {
        return false;
      }

      if (q) {
        const matchName = entry.item.name.toLowerCase().includes(q);
        const matchSku = entry.item.sku.toLowerCase().includes(q);
        const matchBarcode = entry.item.barcode.toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchBarcode) return false;
      }
      return true;
    });
  }, [items, rowStates, warehouseStockMap, showZeroStock, search]);

  // Live invoice calculations
  const calculations = useMemo(() => {
    let selectedItemsCount = 0;
    let totalBasePieces = 0;
    let subtotalPiastres = 0;
    let hasStockError = false;
    const preparedLines: SalesLineInput[] = [];

    for (const entry of items) {
      const state = rowStates[entry.item.id];
      if (!state) continue;
      const qty = Number(state.qtyText);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const selectedUnit =
        entry.allUnits.find((u) => u.id === state.unitId) ?? entry.baseUnit;
      const baseQty = Math.round(qty * selectedUnit.conversionFactor);
      if (baseQty <= 0) continue;

      const available = warehouseStockMap.get(entry.item.id) ?? 0;
      if (baseQty > available && !canStockOverride) {
        hasStockError = true;
      }

      const lineTotal = Math.round(qty * state.unitPricePiastres);
      selectedItemsCount += 1;
      totalBasePieces += baseQty;
      subtotalPiastres += lineTotal;

      preparedLines.push({
        itemId: entry.item.id,
        unitId: selectedUnit.id,
        quantity: qty,
        unitPricePiastres: state.unitPricePiastres,
      });
    }

    let discountValue = 0;
    let discountPiastres = 0;
    if (canDiscount && discountInputText.trim()) {
      if (discountType === 'fixed') {
        discountValue = Math.max(0, toPiastres(discountInputText));
        discountPiastres = Math.min(subtotalPiastres, discountValue);
      } else {
        const pct = Math.max(0, Math.min(100, Number(discountInputText) || 0));
        discountValue = pct;
        discountPiastres = Math.round((subtotalPiastres * pct) / 100);
      }
    }

    const totalPiastres = Math.max(0, subtotalPiastres - discountPiastres);

    let paidPiastres = 0;
    if (paymentType === 'cash') {
      paidPiastres = totalPiastres;
    } else if (paymentType === 'credit') {
      paidPiastres = 0;
    } else {
      paidPiastres = Math.max(0, Math.min(totalPiastres, toPiastres(paidEgpText)));
    }
    const remainingPiastres = Math.max(0, totalPiastres - paidPiastres);

    return {
      selectedItemsCount,
      totalBasePieces,
      subtotalPiastres,
      discountValue,
      discountPiastres,
      totalPiastres,
      paidPiastres,
      remainingPiastres,
      hasStockError,
      preparedLines,
    };
  }, [
    items,
    rowStates,
    warehouseStockMap,
    canStockOverride,
    canDiscount,
    discountType,
    discountInputText,
    paymentType,
    paidEgpText,
  ]);

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    try {
      const created = await customerRepository.createCustomer(session.user, {
        name: newCustName,
        phone: newCustPhone,
        area: newCustArea,
        address: newCustAddress,
      });
      const updated = await customerRepository.listCustomers();
      setCustomers(updated);
      setCustomerId(created.id);
      setQuickCustOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustArea('');
      setNewCustAddress('');
      setFeedback({type: 'success', text: `تمت إضافة العميل (${created.name}) واختياره.`});
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة العميل.',
      });
    }
  };

  const handleSave = async (asDraft: boolean) => {
    if (!session || submittingRef.current) return;
    setFeedback(null);

    if (calculations.preparedLines.length === 0) {
      setFeedback({type: 'error', text: 'يرجى إدخال كمية أكبر من صفر لصنف واحد على الأقل.'});
      return;
    }
    if (!asDraft && calculations.hasStockError) {
      setFeedback({
        type: 'error',
        text: 'توجد أصناف بكمية أكبر من الرصيد المتاح دون توفر صلاحية تجاوز المخزون.',
      });
      return;
    }
    if (!asDraft && calculations.remainingPiastres > 0 && !customerId) {
      setFeedback({
        type: 'error',
        text: 'البيع الآجل أو الجزئي يتطلب اختيار عميل أولاً.',
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        customerId: customerId || null,
        warehouseId,
        invoiceDate,
        discountType,
        discountValue: calculations.discountValue,
        paymentType,
        paidPiastres: calculations.paidPiastres,
        paymentMethodId: paymentMethodId || null,
        notes,
        clientRequestId: asDraft ? null : clientRequestId,
        lines: calculations.preparedLines,
      };

      if (asDraft) {
        const savedDraft = await salesRepository.saveDraftSalesInvoice(
          session.user,
          payload,
          editingDraftId
        );
        setFeedback({
          type: 'success',
          text: `تم حفظ المسودة رقم ${savedDraft.invoice.invoiceNumber}.`,
        });
        setMode('hub');
        await loadBaseData();
      } else if (amendingInvoiceId) {
        const amended = await salesRepository.amendSalesInvoice(
          session.user,
          amendingInvoiceId,
          payload
        );
        setFeedback({
          type: 'success',
          text: `تم تعديل الفاتورة وإصدار الفاتورة الجديدة ${amended.invoice.invoiceNumber}.`,
        });
        setSavedPrintDetails(amended);
        setShouldAutoPrintModal(Boolean(companySettings?.autoPrintAfterSale));
        setMode('hub');
        await loadBaseData();
      } else {
        const posted = await salesRepository.createOrPostSalesInvoice(
          session.user,
          payload,
          {draftId: editingDraftId}
        );
        setFeedback({
          type: 'success',
          text: `تم حفظ واعتماد الفاتورة رقم ${posted.invoice.invoiceNumber} بنجاح.`,
        });
        setSavedPrintDetails(posted);
        setShouldAutoPrintModal(Boolean(companySettings?.autoPrintAfterSale));
        setMode('hub');
        await loadBaseData();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ الفاتورة.',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!session) return;
    try {
      await salesRepository.deleteDraftSalesInvoice(session.user, draftId);
      setFeedback({type: 'success', text: 'تم حذف المسودة.'});
      await loadBaseData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف المسودة.',
      });
    }
  };

  if (!canCreate) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <Lock className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[#0B1F3A]">صلاحية إنشاء المبيعات مقيدة</h2>
        <p className="mt-1 text-sm text-slate-600">
          لا يملك دورك الحالي صلاحية إنشاء فواتير مبيعات جديدة.
        </p>
      </div>
    );
  }

  return (
    <div className={mode === 'editor' ? 'space-y-4 pb-36 lg:pb-24' : 'space-y-5'}>
      {feedback && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'success' && <Check className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HUB MODE: Prominent New Invoice CTA + Saved Drafts */}
      {mode === 'hub' && (
        <>
          <section className="rounded-2xl bg-[#0B1F3A] text-white p-5 sm:p-7 border border-[#C9A227]/35 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-white">شاشة البيع السريعة للمندوبين</h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-300">
                  أدخل كميات عشرات الأصناف في ثوانٍ من قائمة واحدة مباشرة دون فتح كل صنف على حدة.
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={startNewInvoice}
                className="min-h-[54px] inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#C9A227] px-6 text-base font-extrabold text-[#0B1F3A] hover:bg-[#DBBA4B] transition-colors shadow-md cursor-pointer shrink-0 disabled:opacity-60"
              >
                <ShoppingCart className="w-5 h-5" />
                <span>فاتورة جديدة</span>
              </button>
            </div>
          </section>

          {/* Drafts Section */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#C9A227]" />
                <h3 className="text-base font-bold text-[#0B1F3A]">
                  المسودات المحفوظة ({drafts.length})
                </h3>
              </div>
              <Link
                to="/invoices"
                className="text-xs font-bold text-[#0B1F3A] hover:underline"
              >
                كل الفواتير
              </Link>
            </div>

            {drafts.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                لا توجد مسودات معلقة حالياً. يمكنك حفظ أي فاتورة كمسودة والعودة لاعتمادها لاحقاً.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <div
                    key={d.invoice.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#0B1F3A]" dir="ltr">
                          {d.invoice.invoiceNumber}
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {d.customerName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {d.invoice.invoiceDate} · {d.lines.length} أصناف · الإجمالي:{' '}
                        <span className="font-bold text-[#0B1F3A]">
                          {formatEGP(d.invoice.totalPiastres, currency)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openDraftOrAmend(d.invoice.id, 'draft')}
                        className="min-h-[40px] rounded-xl bg-[#0B1F3A] px-3.5 text-xs font-bold text-white hover:bg-[#133159] cursor-pointer"
                      >
                        استكمال / اعتماد
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteDraft(d.invoice.id)}
                        aria-label="حذف المسودة"
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent Posted Invoices */}
          {recentInvoices.length > 0 && (
            <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-base font-bold text-[#0B1F3A]">أحدث الفواتير المعتمدة</h3>
                <Link
                  to="/invoices"
                  className="text-xs font-bold text-[#9E7B14] hover:underline"
                >
                  عرض السجل الكامل
                </Link>
              </div>
              <div className="divide-y divide-slate-100">
                {recentInvoices.map((inv) => (
                  <div
                    key={inv.invoice.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-bold text-[#0B1F3A]" dir="ltr">
                        {inv.invoice.invoiceNumber}
                      </span>
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="font-semibold text-slate-900 truncate">
                        {inv.customerName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-[#0B1F3A] tabular-nums">
                        {formatEGP(inv.invoice.totalPiastres, currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShouldAutoPrintModal(false);
                          setSavedPrintDetails(inv);
                        }}
                        title="إعادة طباعة"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* QUICK POS EDITOR MODE */}
      {mode === 'editor' && (
        <>
          {/* Top Bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMode('hub')}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                <span>رجوع</span>
              </button>
              <div>
                <h2 className="text-base sm:text-lg font-extrabold text-[#0B1F3A]">
                  {amendingInvoiceNumber
                    ? `تعديل فاتورة (${amendingInvoiceNumber})`
                    : editingDraftId
                    ? 'استكمال مسودة فاتورة'
                    : 'فاتورة بيع سريعة جديدة'}
                </h2>
                {amendingInvoiceId && !canEdit && (
                  <p className="text-xs text-red-700 font-semibold">
                    لا تملك صلاحية تعديل الفواتير المعتمدة.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Customer + Warehouse + Date */}
          <section className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المخزن</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">العميل</label>
                <button
                  type="button"
                  onClick={() => setQuickCustOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#9E7B14] hover:text-[#0B1F3A] cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ عميل سريع</span>
                </button>
              </div>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
              >
                <option value="">بدون عميل (عميل نقدي مباشر)</option>
                {customers.map((c) => (
                  <option key={c.customer.id} value={c.customer.id}>
                    {c.customer.name}
                    {c.customer.currentBalancePiastres > 0
                      ? ` (مدين: ${formatEGP(c.customer.currentBalancePiastres, currency)})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الفاتورة</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm tabular-nums"
              />
            </div>
          </section>

          {/* Search & Filter Bar Above Vertical List */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو الكود أو الباركود..."
                className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pr-10 pl-3.5 text-sm focus:border-[#0B1F3A] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowZeroStock((v) => !v)}
              className={`min-h-[46px] px-4 rounded-xl border text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                showZeroStock
                  ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {showZeroStock ? 'إخفاء الأصناف (رصيد 0)' : 'إظهار الكل (مع رصيد 0)'}
            </button>
          </div>

          {/* Vertical Direct-Entry Items List */}
          <section aria-label="قائمة الأصناف للإدخال السريع" className="space-y-2.5">
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
                <p className="text-sm font-bold text-[#0B1F3A]">
                  لا توجد أصناف متاحة للعرض في هذا المخزن
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  تأكد من وجود رصيد في المخزن المحدد أو فعّل خيار إظهار الأصناف ذات رصيد 0.
                </p>
              </div>
            ) : (
              visibleItems.map((entry, idx) => {
                const state = rowStates[entry.item.id] ?? {
                  qtyText: '',
                  unitId: entry.baseUnit.id,
                  unitPricePiastres: entry.item.retailPricePiastres,
                  priceOverridden: false,
                };
                const selectedUnit =
                  entry.allUnits.find((u) => u.id === state.unitId) ?? entry.baseUnit;
                const qtyNum = Number(state.qtyText);
                const hasQty = Number.isFinite(qtyNum) && qtyNum > 0;
                const baseQty = hasQty
                  ? Math.round(qtyNum * selectedUnit.conversionFactor)
                  : 0;
                const available = warehouseStockMap.get(entry.item.id) ?? 0;
                const isOverStock = hasQty && baseQty > available;
                const lineTotalPiastres = hasQty
                  ? Math.round(qtyNum * state.unitPricePiastres)
                  : 0;

                return (
                  <div
                    key={entry.item.id}
                    className={`rounded-2xl border p-3 sm:p-4 transition-all ${
                      isOverStock && !canStockOverride
                        ? 'border-red-400 bg-red-50/40'
                        : hasQty
                        ? 'border-[#0B1F3A] bg-[#0B1F3A]/[0.03] ring-1 ring-[#C9A227]/70 shadow-xs'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      {/* Item Name, SKU & Available Stock */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm sm:text-base font-extrabold text-[#0B1F3A]">
                            {entry.item.name}
                          </h3>
                          <span className="text-[11px] font-mono text-slate-500" dir="ltr">
                            {entry.item.sku}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span
                            className={`font-bold tabular-nums ${
                              available <= 0
                                ? 'text-red-600'
                                : available <= entry.item.minStockQty
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            المتاح: {available} قطعة
                            {entry.cartonUnit && entry.cartonUnit.conversionFactor > 1
                              ? ` (${Math.floor(available / entry.cartonUnit.conversionFactor)} كرتونة)`
                              : ''}
                          </span>
                          {entry.cartonUnit && entry.cartonUnit.conversionFactor > 1 && (
                            <span className="text-slate-500 tabular-nums">
                              الكرتونة = {entry.cartonUnit.conversionFactor} قطعة
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Unit Switcher, Price, Direct Qty Input, Line Total */}
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
                        {/* Quick Unit Toggle */}
                        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleUnitSwitch(entry, entry.baseUnit.id)}
                            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                              selectedUnit.id === entry.baseUnit.id
                                ? 'bg-[#0B1F3A] text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            قطعة
                          </button>
                          {entry.cartonUnit && (
                            <button
                              type="button"
                              onClick={() => handleUnitSwitch(entry, entry.cartonUnit!.id)}
                              className={`min-h-[38px] px-2.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                                selectedUnit.id === entry.cartonUnit.id
                                  ? 'bg-[#0B1F3A] text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              كرتونة
                            </button>
                          )}
                        </div>

                        {/* Unit Price */}
                        <div className="w-24 sm:w-28 shrink-0">
                          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                            سعر الوحدة
                          </label>
                          {canPriceOverride ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              dir="ltr"
                              value={fromPiastres(state.unitPricePiastres)}
                              onChange={(e) => {
                                const nextP = Math.max(0, toPiastres(e.target.value));
                                updateRowState(entry, (prev) => ({
                                  ...prev,
                                  unitPricePiastres: nextP,
                                  priceOverridden: true,
                                }));
                              }}
                              className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-2 text-left text-xs sm:text-sm font-bold tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                            />
                          ) : (
                            <div className="min-h-[42px] flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-800 tabular-nums">
                              <span>{fromPiastres(state.unitPricePiastres).toFixed(2)}</span>
                              <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                            </div>
                          )}
                        </div>

                        {/* Direct Quantity Input */}
                        <div className="w-24 sm:w-28 shrink-0">
                          <label className="block text-[10px] font-bold text-[#0B1F3A] mb-0.5">
                            الكمية ({selectedUnit.name})
                          </label>
                          <input
                            ref={(el) => {
                              qtyInputRefs.current[idx] = el;
                            }}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            enterKeyHint={idx < visibleItems.length - 1 ? 'next' : 'done'}
                            dir="ltr"
                            placeholder="0"
                            value={state.qtyText}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateRowState(entry, (prev) => ({
                                ...prev,
                                qtyText: val,
                              }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const nextInput = qtyInputRefs.current[idx + 1];
                                if (nextInput) {
                                  nextInput.focus();
                                  nextInput.select();
                                }
                              }
                            }}
                            className={`w-full min-h-[44px] rounded-xl border px-2.5 text-center text-base font-extrabold tabular-nums focus:outline-none ${
                              hasQty
                                ? 'border-[#0B1F3A] bg-white text-[#0B1F3A] ring-1 ring-[#C9A227]'
                                : 'border-slate-300 bg-white text-slate-900 focus:border-[#0B1F3A]'
                            }`}
                          />
                        </div>

                        {/* Live Line Total */}
                        <div className="min-w-[88px] text-left shrink-0">
                          <span className="block text-[10px] font-semibold text-slate-500">
                            إجمالي السطر
                          </span>
                          <span
                            className={`text-sm sm:text-base font-extrabold tabular-nums ${
                              hasQty ? 'text-[#0B1F3A]' : 'text-slate-400'
                            }`}
                          >
                            {formatEGP(lineTotalPiastres, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stock override / warning row */}
                    {isOverStock && (
                      <div
                        className={`mt-2 flex items-center gap-1.5 text-xs font-bold ${
                          canStockOverride ? 'text-amber-700' : 'text-red-700'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {canStockOverride
                            ? `تنبيه: الكمية المطلوبة (${baseQty} قطعة) تتجاوز الرصيد المتاح (${available} قطعة) - مسموح بصلاحية تجاوز المخزون.`
                            : `ممنوع: الكمية المطلوبة (${baseQty} قطعة) أكبر من المتاح (${available} قطعة) ولا تملك صلاحية تجاوز المخزون.`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* Discount, Payment & Notes Card */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
            <h3 className="text-sm font-bold text-[#0B1F3A]">الخصم والسداد والملاحظات</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Discount */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">الخصم</label>
                  {canDiscount && (
                    <div className="inline-flex rounded-lg border border-slate-200 text-[11px] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType('fixed');
                          setDiscountInputText('');
                        }}
                        className={`px-2 py-0.5 font-bold cursor-pointer ${
                          discountType === 'fixed'
                            ? 'bg-[#0B1F3A] text-white'
                            : 'bg-slate-50 text-slate-600'
                        }`}
                      >
                        ج.م
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountType('percent');
                          setDiscountInputText('');
                        }}
                        className={`px-2 py-0.5 font-bold cursor-pointer ${
                          discountType === 'percent'
                            ? 'bg-[#0B1F3A] text-white'
                            : 'bg-slate-50 text-slate-600'
                        }`}
                      >
                        %
                      </button>
                    </div>
                  )}
                </div>
                {canDiscount ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    dir="ltr"
                    placeholder={discountType === 'percent' ? '0%' : '0.00'}
                    value={discountInputText}
                    onChange={(e) => setDiscountInputText(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-left text-sm font-bold tabular-nums"
                  />
                ) : (
                  <div className="min-h-[44px] flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                    <span>بدون صلاحية خصم</span>
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>

              {/* Payment Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نوع السداد</label>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                  {(['cash', 'credit', 'partial'] as const).map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPaymentType(pt)}
                      className={`min-h-[36px] rounded-lg text-xs font-bold cursor-pointer ${
                        paymentType === pt
                          ? 'bg-[#0B1F3A] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {pt === 'cash' ? 'نقدي' : pt === 'credit' ? 'آجل' : 'جزئي'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paid Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المدفوع (ج.م)
                </label>
                {paymentType === 'partial' ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    value={paidEgpText}
                    onChange={(e) => setPaidEgpText(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#0B1F3A] px-3 text-left text-sm font-bold tabular-nums"
                  />
                ) : (
                  <div className="min-h-[44px] flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-emerald-700 tabular-nums">
                    {formatEGP(calculations.paidPiastres, currency)}
                  </div>
                )}
              </div>

              {/* Remaining & Payment Method */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المتبقي / الخزنة
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-h-[44px] flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-red-700 tabular-nums">
                    {formatEGP(calculations.remainingPiastres, currency)}
                  </div>
                  <select
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold max-w-[125px]"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm.id} value={pm.id}>
                        {pm.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الفاتورة</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات التوصيل أو السداد..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
          </section>

          {/* Fixed Sticky Bottom Summary Bar */}
          <div className="no-print fixed bottom-16 lg:bottom-0 inset-x-0 lg:right-72 z-30 bg-[#0B1F3A] text-white border-t border-[#C9A227]/40 px-4 py-3 shadow-2xl">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-300 tabular-nums">
                  <span>{calculations.selectedItemsCount} أصناف مختارة</span>
                  <span>·</span>
                  <span>{calculations.totalBasePieces} قطعة</span>
                  {calculations.discountPiastres > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-[#DBBA4B]">
                        خصم {formatEGP(calculations.discountPiastres, currency)}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-lg sm:text-xl font-extrabold text-[#DBBA4B] tabular-nums">
                  الإجمالي: {formatEGP(calculations.totalPiastres, currency)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!amendingInvoiceId && (
                  <button
                    type="button"
                    disabled={submitting || calculations.preparedLines.length === 0}
                    onClick={() => void handleSave(true)}
                    className="min-h-[46px] inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3.5 text-xs sm:text-sm font-bold text-white hover:bg-white/20 disabled:opacity-45 cursor-pointer"
                  >
                    <Save className="w-4 h-4 text-[#DBBA4B]" />
                    <span>مسودة</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    submitting ||
                    calculations.preparedLines.length === 0 ||
                    calculations.hasStockError ||
                    (amendingInvoiceId !== null && !canEdit)
                  }
                  onClick={() => void handleSave(false)}
                  className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#C9A227] px-5 text-xs sm:text-sm font-extrabold text-[#0B1F3A] hover:bg-[#DBBA4B] disabled:opacity-45 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'جارٍ الحفظ...'
                      : amendingInvoiceId
                      ? 'اعتماد التعديل'
                      : 'حفظ واعتماد الفاتورة'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quick Add Customer Modal */}
      {quickCustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0B1F3A]">إضافة عميل سريع</h3>
              <button
                type="button"
                onClick={() => setQuickCustOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleQuickCreateCustomer(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اسم العميل</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="مقهى / سوبرماركت..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الهاتف</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المنطقة</label>
                <input
                  type="text"
                  value={newCustArea}
                  onChange={(e) => setNewCustArea(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#C9A227]" />
                <span>حفظ واختيار العميل</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {savedPrintDetails && (
        <InvoicePrintModal
          details={savedPrintDetails}
          companySettings={companySettings}
          autoPrintOnOpen={shouldAutoPrintModal}
          onClose={() => {
            setSavedPrintDetails(null);
            setShouldAutoPrintModal(false);
          }}
        />
      )}
    </div>
  );
};
