import {
  Check,
  Coffee,
  Edit3,
  FileSpreadsheet,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import * as XLSX from 'xlsx';
import {useAuth} from '../context/AuthContext';
import {
  itemRepository,
  type ExcelItemImportRow,
  type ItemWithDetails,
} from '../repositories/itemRepository';
import {warehouseRepository, type WarehouseWithStats} from '../repositories/warehouseRepository';
import {fileToResizedDataUrl} from '../utils/image';
import {formatEGP, fromPiastres, toPiastres} from '../utils/money';

export const ItemsPage: React.FC = () => {
  const {session, companySettings} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';

  const [items, setItems] = useState<ItemWithDetails[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'low_stock'>(
    'all'
  );
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Add / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ItemWithDetails | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [category, setCategory] = useState('بن');
  const [costEgp, setCostEgp] = useState('');
  const [piecePriceEgp, setPiecePriceEgp] = useState('');
  const [cartonPriceEgp, setCartonPriceEgp] = useState('');
  const [conversionFactor, setConversionFactor] = useState('20');
  const [minStockQty, setMinStockQty] = useState('10');
  const [openingQty, setOpeningQty] = useState('0');
  const [openingWarehouseId, setOpeningWarehouseId] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Excel import modal
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelRows, setExcelRows] = useState<ExcelItemImportRow[]>([]);
  const [excelImporting, setExcelImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemList, whList] = await Promise.all([
        itemRepository.listItems({search, status: statusFilter}),
        warehouseRepository.listWarehouses(),
      ]);
      setItems(itemList);
      setWarehouses(whList);
      const defWh = whList.find((w) => w.warehouse.isDefault) ?? whList[0];
      if (defWh) {
        setOpeningWarehouseId((prev) => prev || defWh.warehouse.id);
      }
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditing(null);
    setName('');
    setSku(`BN-${String(items.length + 1).padStart(3, '0')}`);
    setBarcode('');
    setCategory('بن');
    setCostEgp('');
    setPiecePriceEgp('');
    setCartonPriceEgp('');
    setConversionFactor('20');
    setMinStockQty('10');
    setOpeningQty('0');
    setImageDataUrl(null);
    setModalOpen(true);
  };

  const openEditModal = (entry: ItemWithDetails) => {
    setEditing(entry);
    setName(entry.item.name);
    setSku(entry.item.sku);
    setBarcode(entry.item.barcode);
    setCategory(entry.item.category);
    setCostEgp(String(fromPiastres(entry.item.costPricePiastres)));
    setPiecePriceEgp(String(fromPiastres(entry.baseUnit.salePricePiastres)));
    setCartonPriceEgp(
      String(
        fromPiastres(entry.cartonUnit?.salePricePiastres ?? entry.item.wholesalePricePiastres)
      )
    );
    setConversionFactor(String(entry.cartonUnit?.conversionFactor ?? 20));
    setMinStockQty(String(entry.item.minStockQty));
    setOpeningQty('0');
    setImageDataUrl(entry.item.imageDataUrl);
    setModalOpen(true);
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await fileToResizedDataUrl(file, 300);
      setImageDataUrl(url);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر قراءة الصورة.',
      });
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    setFeedback(null);

    try {
      const payload = {
        name,
        sku,
        barcode,
        category,
        costPricePiastres: toPiastres(costEgp || 0),
        pieceSalePricePiastres: toPiastres(piecePriceEgp || 0),
        cartonSalePricePiastres: toPiastres(cartonPriceEgp || 0),
        cartonConversionFactor: Number(conversionFactor) || 1,
        minStockQty: Number(minStockQty) || 0,
        imageDataUrl,
        openingStockQty: editing ? 0 : Number(openingQty) || 0,
        openingWarehouseId,
      };

      if (editing) {
        await itemRepository.updateItem(session.user, editing.item.id, payload);
        setFeedback({type: 'success', text: `تم تحديث الصنف (${name}) بنجاح.`});
      } else {
        await itemRepository.createItem(session.user, payload);
        setFeedback({type: 'success', text: `تمت إضافة الصنف (${name}) بنجاح.`});
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ الصنف.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (entry: ItemWithDetails) => {
    if (!session) return;
    setFeedback(null);
    try {
      await itemRepository.toggleItemActive(session.user, entry.item.id, !entry.item.isActive);
      setFeedback({
        type: 'success',
        text: entry.item.isActive
          ? `تم إيقاف الصنف (${entry.item.name}).`
          : `تم تفعيل الصنف (${entry.item.name}).`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تغيير الحالة.',
      });
    }
  };

  const handleDelete = async (entry: ItemWithDetails) => {
    if (!session) return;
    setFeedback(null);
    try {
      await itemRepository.deleteItem(session.user, entry.item.id);
      setFeedback({type: 'success', text: `تم حذف الصنف (${entry.item.name}).`});
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف الصنف.',
      });
    }
  };

  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        sku: 'BN-250-DARK',
        name: 'بن تركي محوج غامق 250 جم',
        barcode: '6221000000011',
        category: 'بن تركي',
        cost_egp: 95,
        piece_price_egp: 115,
        carton_qty: 20,
        carton_price_egp: 2200,
        min_stock: 20,
        opening_qty: 40,
      },
      {
        sku: 'BN-100-PLAIN',
        name: 'بن سادة وسط 100 جم',
        barcode: '6221000000028',
        category: 'بن سادة',
        cost_egp: 40,
        piece_price_egp: 50,
        carton_qty: 24,
        carton_price_egp: 1140,
        min_stock: 24,
        opening_qty: 48,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأصناف');
    XLSX.writeFile(wb, 'nukhbat-albonn-items-template.xlsx');
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, {type: 'array'});
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {defval: ''});

      const parsed: ExcelItemImportRow[] = rawJson.map((row) => {
        const getVal = (keys: string[]): string => {
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== '') return String(row[k]);
          }
          return '';
        };
        const getNum = (keys: string[], fallback = 0): number => {
          const val = Number(getVal(keys));
          return Number.isFinite(val) ? val : fallback;
        };

        const conv = Math.max(1, Math.round(getNum(['carton_qty', 'معامل التحويل', 'قطع الكرتونة'], 20)));
        const piecePrice = toPiastres(getNum(['piece_price_egp', 'سعر القطعة'], 0));
        const cartonPriceRaw = getNum(['carton_price_egp', 'سعر الكرتونة'], 0);

        return {
          sku: getVal(['sku', 'الكود', 'كود الصنف']),
          name: getVal(['name', 'الاسم', 'اسم الصنف']),
          barcode: getVal(['barcode', 'الباركود']),
          category: getVal(['category', 'التصنيف']) || 'بن',
          costPricePiastres: toPiastres(getNum(['cost_egp', 'سعر الشراء'], 0)),
          pieceSalePricePiastres: piecePrice,
          cartonSalePricePiastres:
            cartonPriceRaw > 0 ? toPiastres(cartonPriceRaw) : piecePrice * conv,
          cartonConversionFactor: conv,
          minStockQty: Math.max(0, Math.round(getNum(['min_stock', 'الحد الأدنى'], 0))),
          openingStockQty: Math.max(0, Math.round(getNum(['opening_qty', 'الرصيد الافتتاحي'], 0))),
        };
      });

      setExcelRows(parsed);
      setExcelModalOpen(true);
    } catch {
      setFeedback({type: 'error', text: 'تعذر قراءة ملف Excel. تأكد من صحة الصيغة.'});
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmExcelImport = async () => {
    if (!session || excelRows.length === 0) return;
    setExcelImporting(true);
    setFeedback(null);
    try {
      const res = await itemRepository.importItemsFromRows(
        session.user,
        excelRows,
        openingWarehouseId
      );
      setExcelModalOpen(false);
      setExcelRows([]);
      setFeedback({
        type: 'success',
        text: `تم استيراد ${res.importedCount} صنفاً${res.skippedCount > 0 ? ` وتخطي ${res.skippedCount} صفوف` : ''}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'فشل استيراد الأصناف.',
      });
    } finally {
      setExcelImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1F3A]">دليل الأصناف ووحدات التعبئة</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            المخزون يُخزن بالوحدة الأساسية (قطعة)، وتُحسب الكرتونة تلقائياً بمعامل التحويل لكل صنف.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>نموذج Excel</span>
          </button>

          <label className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#0B1F3A] bg-white px-3.5 text-xs font-bold text-[#0B1F3A] hover:bg-slate-50 cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>استيراد Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void handleExcelFileChange(e)}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#C9A227]" />
            <span>صنف جديد</span>
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

      {/* Search and Filter Bar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف أو الكود أو الباركود..."
            className="w-full min-h-[44px] rounded-xl border border-slate-300 pr-10 pl-3.5 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {(
            [
              {id: 'all', label: 'الكل'},
              {id: 'active', label: 'نشط'},
              {id: 'inactive', label: 'موقوف'},
              {id: 'low_stock', label: 'نقص مخزون'},
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                statusFilter === f.id
                  ? 'bg-[#0B1F3A] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Items List */}
      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
          جارٍ تحميل الأصناف...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <Coffee className="w-10 h-10 text-[#C9A227] mx-auto mb-3" />
          <p className="text-base font-bold text-[#0B1F3A]">لا توجد أصناف مطابقة</p>
          <p className="mt-1 text-xs text-slate-500">
            أضف أول صنف (مثل: بن 250 جم) أو استورد قائمة الأصناف من ملف Excel.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {items.map((entry) => {
            const conv = entry.cartonUnit?.conversionFactor ?? 1;
            const cartonCount = Math.floor(entry.totalStockQty / conv);
            const loosePieces = entry.totalStockQty % conv;
            const isLow = entry.totalStockQty <= entry.item.minStockQty;

            return (
              <article
                key={entry.item.id}
                className={`rounded-2xl bg-white border p-4 flex flex-col justify-between gap-3 ${
                  entry.item.isActive ? 'border-slate-200' : 'border-slate-200 opacity-75'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 rounded-xl border border-slate-200 bg-slate-50 shrink-0 overflow-hidden flex items-center justify-center">
                    {entry.item.imageDataUrl ? (
                      <img
                        src={entry.item.imageDataUrl}
                        alt={entry.item.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Coffee className="w-6 h-6 text-[#C9A227]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[#0B1F3A] truncate">
                        {entry.item.name}
                      </h3>
                      <span
                        className={`text-xs font-bold shrink-0 ${
                          entry.item.isActive ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {entry.item.isActive ? 'نشط' : 'موقوف'}
                      </span>
                    </div>

                    <p className="mt-0.5 text-xs text-slate-500 truncate">
                      <span className="font-mono" dir="ltr">
                        {entry.item.sku}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{entry.item.category}</span>
                      <span aria-hidden="true"> · </span>
                      <span>الكرتونة = {conv} قطعة</span>
                    </p>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 block">متوسط التكلفة</span>
                        <span className="font-bold text-slate-900 tabular-nums">
                          {formatEGP(entry.item.costPricePiastres, currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">بيع القطعة</span>
                        <span className="font-bold text-[#0B1F3A] tabular-nums">
                          {formatEGP(entry.baseUnit.salePricePiastres, currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">بيع الكرتونة</span>
                        <span className="font-bold text-[#9E7B14] tabular-nums">
                          {formatEGP(
                            entry.cartonUnit?.salePricePiastres ??
                              entry.item.wholesalePricePiastres,
                            currency
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className="text-slate-500">الرصيد: </span>
                    <span
                      className={`font-bold tabular-nums ${
                        isLow ? 'text-red-700' : 'text-[#0B1F3A]'
                      }`}
                    >
                      {entry.totalStockQty} قطعة
                    </span>
                    {conv > 1 && (
                      <span className="text-slate-500 tabular-nums">
                        {' '}
                        ({cartonCount} كرتونة و {loosePieces} قطعة)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(entry)}
                      className="min-h-[38px] inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleStatus(entry)}
                      className="min-h-[38px] rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      {entry.item.isActive ? 'إيقاف' : 'تفعيل'}
                    </button>

                    {!entry.hasMovements && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        title="حذف (بدون حركات)"
                        className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-xl border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add / Edit Item Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                {editing ? `تعديل صنف: ${editing.item.name}` : 'إضافة صنف جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveItem(e)} className="space-y-3.5">
              {/* Optional Image */}
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
                  {imageDataUrl ? (
                    <img
                      src={imageDataUrl}
                      alt="معاينة"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Coffee className="w-6 h-6 text-[#C9A227]" />
                  )}
                </div>
                <label className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="w-4 h-4 text-[#0B1F3A]" />
                  <span>صورة اختيارية للصنف</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => void handleImagePick(e)}
                    className="sr-only"
                  />
                </label>
                {imageDataUrl && (
                  <button
                    type="button"
                    onClick={() => setImageDataUrl(null)}
                    className="text-xs font-semibold text-red-700 cursor-pointer"
                  >
                    إزالة
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم الصنف
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: بن 250 جرام محوج"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm focus:border-[#0B1F3A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الكود (SKU)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الباركود (اختياري)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    التصنيف
                  </label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="بن / نسكافيه / غذائيات"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    عدد القطع في الكرتونة
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    dir="ltr"
                    value={conversionFactor}
                    onChange={(e) => setConversionFactor(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    شراء القطعة (ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    dir="ltr"
                    value={costEgp}
                    onChange={(e) => setCostEgp(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-2.5 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    بيع القطعة (ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    dir="ltr"
                    value={piecePriceEgp}
                    onChange={(e) => setPiecePriceEgp(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-2.5 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    بيع الكرتونة (ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    dir="ltr"
                    value={cartonPriceEgp}
                    onChange={(e) => setCartonPriceEgp(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-2.5 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الحد الأدنى للمخزون (قطعة)
                  </label>
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={minStockQty}
                    onChange={(e) => setMinStockQty(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                  />
                </div>

                {!editing && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      رصيد افتتاحي (بالقطعة)
                    </label>
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      value={openingQty}
                      onChange={(e) => setOpeningQty(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums focus:border-[#0B1F3A] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {!editing && Number(openingQty) > 0 && warehouses.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    مخزن الرصيد الافتتاحي
                  </label>
                  <select
                    value={openingWarehouseId}
                    onChange={(e) => setOpeningWarehouseId(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    {warehouses.map((w) => (
                      <option key={w.warehouse.id} value={w.warehouse.id}>
                        {w.warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'إضافة الصنف'}
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[46px] px-5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Import Preview Modal */}
      {excelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-[#0B1F3A]">
                معاينة استيراد Excel ({excelRows.length} صنف)
              </h3>
              <button
                type="button"
                onClick={() => setExcelModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-right border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5">الكود</th>
                    <th className="p-2.5">الاسم</th>
                    <th className="p-2.5">قطع/كرتونة</th>
                    <th className="p-2.5">الشراء</th>
                    <th className="p-2.5">بيع القطعة</th>
                    <th className="p-2.5">افتتاحي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {excelRows.map((r, i) => (
                    <tr key={`${r.sku}-${i}`}>
                      <td className="p-2.5 font-mono" dir="ltr">
                        {r.sku || '-'}
                      </td>
                      <td className="p-2.5 font-semibold">{r.name || '-'}</td>
                      <td className="p-2.5 tabular-nums">{r.cartonConversionFactor}</td>
                      <td className="p-2.5 tabular-nums">
                        {formatEGP(r.costPricePiastres, currency)}
                      </td>
                      <td className="p-2.5 tabular-nums">
                        {formatEGP(r.pieceSalePricePiastres, currency)}
                      </td>
                      <td className="p-2.5 tabular-nums">{r.openingStockQty ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={excelImporting}
                onClick={() => void handleConfirmExcelImport()}
                className="flex-1 min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-60"
              >
                {excelImporting ? 'جارٍ الاستيراد...' : 'اعتماد استيراد الأصناف'}
              </button>
              <button
                type="button"
                onClick={() => setExcelModalOpen(false)}
                className="min-h-[46px] px-5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
