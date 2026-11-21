import {
  ArrowLeftRight,
  Check,
  ClipboardCheck,
  History,
  Plus,
  Search,
  Warehouse,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {itemRepository, type ItemWithDetails} from '../repositories/itemRepository';
import {
  MOVEMENT_TYPE_LABELS,
  stockMovementRepository,
  type EnrichedStockMovement,
} from '../repositories/stockMovementRepository';
import {
  warehouseRepository,
  type ItemWarehouseBalance,
  type WarehouseWithStats,
} from '../repositories/warehouseRepository';
import type {StockMovementType} from '../types/domain';
import {formatArabicDateTime} from '../utils/date';
import {formatEGP} from '../utils/money';

type WarehouseTab = 'warehouses' | 'transfer' | 'stocktake' | 'movements';

export const WarehousesPage: React.FC = () => {
  const {session, companySettings, can} = useAuth();
  const currency = companySettings?.currencySymbol ?? 'ج.م';
  const canOverrideStock = can('stock.override');

  const [activeTab, setActiveTab] = useState<WarehouseTab>('warehouses');
  const [warehouses, setWarehouses] = useState<WarehouseWithStats[]>([]);
  const [selectedWhId, setSelectedWhId] = useState<string>('');
  const [balances, setBalances] = useState<ItemWarehouseBalance[]>([]);
  const [items, setItems] = useState<ItemWithDetails[]>([]);
  const [movements, setMovements] = useState<EnrichedStockMovement[]>([]);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  // Add Warehouse modal
  const [whModalOpen, setWhModalOpen] = useState(false);
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whLocation, setWhLocation] = useState('');
  const [whIsDefault, setWhIsDefault] = useState(false);

  // Transfer form
  const [trItemId, setTrItemId] = useState('');
  const [trFromWhId, setTrFromWhId] = useState('');
  const [trToWhId, setTrToWhId] = useState('');
  const [trQty, setTrQty] = useState('1');
  const [trUnitMode, setTrUnitMode] = useState<'piece' | 'carton'>('piece');
  const [trNotes, setTrNotes] = useState('');

  // Stocktake state
  const [countWhId, setCountWhId] = useState('');
  const [countBalances, setCountBalances] = useState<ItemWarehouseBalance[]>([]);
  const [actualInputs, setActualInputs] = useState<Record<string, string>>({});
  const [countNotes, setCountNotes] = useState('');

  // Movement filters
  const [movSearch, setMovSearch] = useState('');
  const [movItemFilter, setMovItemFilter] = useState('');
  const [movWhFilter, setMovWhFilter] = useState('');
  const [movTypeFilter, setMovTypeFilter] = useState<StockMovementType | 'all'>('all');
  const [movDateFrom, setMovDateFrom] = useState('');
  const [movDateTo, setMovDateTo] = useState('');

  const loadBase = useCallback(async () => {
    const [whList, itemList] = await Promise.all([
      warehouseRepository.listWarehouses(),
      itemRepository.listItems({status: 'all'}),
    ]);
    setWarehouses(whList);
    setItems(itemList);

    const defId =
      whList.find((w) => w.warehouse.isDefault)?.warehouse.id ??
      whList[0]?.warehouse.id ??
      '';

    setSelectedWhId((prev) => prev || defId);
    setCountWhId((prev) => prev || defId);
    setTrFromWhId((prev) => prev || defId);
    if (whList.length > 1) {
      setTrToWhId((prev) => prev || whList[1].warehouse.id);
    }
    if (itemList.length > 0) {
      setTrItemId((prev) => prev || itemList[0].item.id);
    }
  }, []);

  const loadBalances = useCallback(async () => {
    if (!selectedWhId) return;
    const list = await warehouseRepository.getBalancesForWarehouse(selectedWhId);
    setBalances(list);
  }, [selectedWhId]);

  const loadCountBalances = useCallback(async () => {
    if (!countWhId) return;
    const list = await warehouseRepository.getBalancesForWarehouse(countWhId);
    setCountBalances(list);
    const map: Record<string, string> = {};
    for (const row of list) {
      map[row.item.id] = String(row.quantity);
    }
    setActualInputs(map);
  }, [countWhId]);

  const loadMovements = useCallback(async () => {
    const list = await stockMovementRepository.listMovements({
      itemId: movItemFilter || undefined,
      warehouseId: movWhFilter || undefined,
      movementType: movTypeFilter,
      dateFrom: movDateFrom || undefined,
      dateTo: movDateTo || undefined,
      search: movSearch || undefined,
    });
    setMovements(list);
  }, [movItemFilter, movWhFilter, movTypeFilter, movDateFrom, movDateTo, movSearch]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    if (activeTab === 'stocktake') {
      void loadCountBalances();
    }
  }, [activeTab, loadCountBalances]);

  useEffect(() => {
    if (activeTab === 'movements') {
      void loadMovements();
    }
  }, [activeTab, loadMovements]);

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);
    try {
      await warehouseRepository.createWarehouse(session.user, {
        code: whCode,
        name: whName,
        location: whLocation,
        isDefault: whIsDefault,
      });
      setWhModalOpen(false);
      setWhCode('');
      setWhName('');
      setWhLocation('');
      setWhIsDefault(false);
      setFeedback({type: 'success', text: 'تمت إضافة المخزن بنجاح.'});
      await loadBase();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة المخزن.',
      });
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setFeedback(null);

    const selectedItem = items.find((i) => i.item.id === trItemId);
    const factor =
      trUnitMode === 'carton' ? selectedItem?.cartonUnit?.conversionFactor ?? 1 : 1;
    const basePieces = Math.round(Number(trQty || 0) * factor);

    try {
      await warehouseRepository.transferBetweenWarehouses(session.user, {
        itemId: trItemId,
        fromWarehouseId: trFromWhId,
        toWarehouseId: trToWhId,
        quantityBasePieces: basePieces,
        notes: trNotes,
        allowStockOverride: canOverrideStock,
      });
      setTrNotes('');
      setFeedback({
        type: 'success',
        text: `تم تحويل ${basePieces} قطعة بنجاح وتوثيق الحركتين في السجل.`,
      });
      await Promise.all([loadBase(), loadBalances()]);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تنفيذ التحويل.',
      });
    }
  };

  const handleStocktakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !countWhId) return;
    setFeedback(null);

    try {
      const entries = countBalances.map((row) => ({
        itemId: row.item.id,
        actualQty: Number(actualInputs[row.item.id] ?? row.quantity),
      }));
      const res = await stockMovementRepository.recordInventoryAdjustment(session.user, {
        warehouseId: countWhId,
        notes: countNotes,
        mode: 'count',
        entries,
      });
      setCountNotes('');
      setFeedback({
        type: 'success',
        text:
          res.adjustedCount > 0
            ? `تم اعتماد الجرد وتوليد ${res.adjustedCount} حركة تسوية (زيادة/عجز).`
            : 'الجرد مطابق تماماً للرصيد الدفتري؛ لم تُسجل أي فروقات.',
      });
      await Promise.all([loadBase(), loadBalances(), loadCountBalances()]);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد الجرد.',
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl overflow-x-auto">
        {(
          [
            {id: 'warehouses', label: 'المخازن والأرصدة', icon: Warehouse},
            {id: 'transfer', label: 'تحويل بين المخازن', icon: ArrowLeftRight},
            {id: 'stocktake', label: 'جرد وتسوية المخزون', icon: ClipboardCheck},
            {id: 'movements', label: 'سجل الحركات', icon: History},
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === t.id
                  ? 'bg-[#0B1F3A] text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4 text-[#C9A227]" />
              <span>{t.label}</span>
            </button>
          );
        })}
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

      {activeTab === 'warehouses' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#0B1F3A]">المخازن المعتمدة</h2>
            <button
              type="button"
              onClick={() => {
                setWhCode(`WH-${String(warehouses.length + 1).padStart(2, '0')}`);
                setWhModalOpen(true);
              }}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 text-sm font-bold text-white hover:bg-[#133159] cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#C9A227]" />
              <span>مخزن جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {warehouses.map((w) => {
              const selected = w.warehouse.id === selectedWhId;
              return (
                <button
                  key={w.warehouse.id}
                  type="button"
                  onClick={() => setSelectedWhId(w.warehouse.id)}
                  className={`text-right rounded-2xl p-4 border transition-all cursor-pointer ${
                    selected
                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                      : 'bg-white text-slate-900 border-slate-200 hover:border-[#C9A227]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-bold truncate">{w.warehouse.name}</span>
                    {w.warehouse.isDefault && (
                      <span
                        className={`text-xs font-bold ${
                          selected ? 'text-[#DBBA4B]' : 'text-[#9E7B14]'
                        }`}
                      >
                        افتراضي
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-1 text-xs ${
                      selected ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {w.warehouse.code} · {w.warehouse.location || 'بدون موقع محدد'}
                  </p>
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-xs tabular-nums">
                    <span>{w.totalPiecesCount} قطعة</span>
                    <span className="font-bold">
                      {formatEGP(w.totalStockValuePiastres, currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Per-item stock inside selected warehouse */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 overflow-x-auto">
            <h3 className="text-sm font-bold text-[#0B1F3A] mb-3">
              رصيد الأصناف في:{' '}
              {warehouses.find((w) => w.warehouse.id === selectedWhId)?.warehouse.name ?? '-'}
            </h3>
            {balances.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد أصناف مسجلة بعد.</p>
            ) : (
              <table className="w-full min-w-[540px] text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                    <th className="py-2.5 px-2">الصنف</th>
                    <th className="py-2.5 px-2">الكود</th>
                    <th className="py-2.5 px-2">الرصيد (بالقطعة)</th>
                    <th className="py-2.5 px-2">تكلفة الوحدة</th>
                    <th className="py-2.5 px-2">قيمة المخزون</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balances.map((b) => (
                    <tr key={`${b.warehouseId}-${b.item.id}`}>
                      <td className="py-2.5 px-2 font-semibold text-slate-900">{b.item.name}</td>
                      <td className="py-2.5 px-2 font-mono text-xs text-slate-500" dir="ltr">
                        {b.item.sku}
                      </td>
                      <td
                        className={`py-2.5 px-2 font-bold tabular-nums ${
                          b.quantity <= b.item.minStockQty ? 'text-red-700' : 'text-[#0B1F3A]'
                        }`}
                      >
                        {b.quantity}
                      </td>
                      <td className="py-2.5 px-2 tabular-nums">
                        {formatEGP(b.item.costPricePiastres, currency)}
                      </td>
                      <td className="py-2.5 px-2 font-bold tabular-nums text-[#0B1F3A]">
                        {formatEGP(b.valuePiastres, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {activeTab === 'transfer' && (
        <section className="max-w-xl rounded-2xl bg-white border border-slate-200 p-5 sm:p-6">
          <h2 className="text-base font-bold text-[#0B1F3A] mb-1">تحويل مخزون بين المخازن</h2>
          <p className="text-xs text-slate-500 mb-4">
            يسجل حركتي تحويل صادر ووارد موثقتين داخل معاملة ذرية واحدة.
          </p>

          {warehouses.length < 2 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
              أضف مخزناً ثانياً من تبويب "المخازن والأرصدة" لإجراء عمليات التحويل بين المخازن.
            </p>
          ) : (
            <form onSubmit={(e) => void handleTransfer(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الصنف</label>
                <select
                  value={trItemId}
                  onChange={(e) => setTrItemId(e.target.value)}
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {items.map((i) => (
                    <option key={i.item.id} value={i.item.id}>
                      {i.item.name} ({i.item.sku}) - المتاح إجمالاً: {i.totalStockQty} قطعة
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    من مخزن
                  </label>
                  <select
                    value={trFromWhId}
                    onChange={(e) => setTrFromWhId(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
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
                    إلى مخزن
                  </label>
                  <select
                    value={trToWhId}
                    onChange={(e) => setTrToWhId(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    {warehouses.map((w) => (
                      <option key={w.warehouse.id} value={w.warehouse.id}>
                        {w.warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">الوحدة</label>
                  <select
                    value={trUnitMode}
                    onChange={(e) => setTrUnitMode(e.target.value as 'piece' | 'carton')}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="piece">قطعة (1)</option>
                    <option value="carton">
                      كرتونة (
                      {items.find((i) => i.item.id === trItemId)?.cartonUnit?.conversionFactor ?? 1}{' '}
                      قطعة)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">الكمية</label>
                  <input
                    type="number"
                    min={1}
                    required
                    dir="ltr"
                    value={trQty}
                    onChange={(e) => setTrQty(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 px-3 text-sm text-left tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={trNotes}
                  onChange={(e) => setTrNotes(e.target.value)}
                  placeholder="سبب التحويل أو رقم إذن التسليم"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                اعتماد التحويل
              </button>
            </form>
          )}
        </section>
      )}

      {activeTab === 'stocktake' && (
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <form onSubmit={(e) => void handleStocktakeSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  المخزن المراد جرده
                </label>
                <select
                  value={countWhId}
                  onChange={(e) => setCountWhId(e.target.value)}
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
                  ملاحظات الجرد
                </label>
                <input
                  type="text"
                  value={countNotes}
                  onChange={(e) => setCountNotes(e.target.value)}
                  placeholder="مثال: جرد نهاية الأسبوع"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full min-w-[540px] text-sm border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 text-right">
                  <tr>
                    <th className="p-3">الصنف</th>
                    <th className="p-3">الرصيد الدفتري</th>
                    <th className="p-3">الجرد الفعلي (قطعة)</th>
                    <th className="p-3">الفرق (زيادة / عجز)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countBalances.map((row) => {
                    const actualVal = Number(actualInputs[row.item.id] ?? row.quantity);
                    const diff = Number.isFinite(actualVal) ? actualVal - row.quantity : 0;
                    return (
                      <tr key={row.item.id}>
                        <td className="p-3 font-semibold text-slate-900">{row.item.name}</td>
                        <td className="p-3 tabular-nums font-bold text-[#0B1F3A]">
                          {row.quantity}
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            min={0}
                            dir="ltr"
                            value={actualInputs[row.item.id] ?? String(row.quantity)}
                            onChange={(e) =>
                              setActualInputs((prev) => ({
                                ...prev,
                                [row.item.id]: e.target.value,
                              }))
                            }
                            className="w-28 min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-left tabular-nums font-bold"
                          />
                        </td>
                        <td className="p-3 tabular-nums font-bold">
                          {diff === 0 ? (
                            <span className="text-slate-400">مطابق (0)</span>
                          ) : diff > 0 ? (
                            <span className="text-emerald-700">زيادة (+{diff})</span>
                          ) : (
                            <span className="text-red-700">عجز ({diff})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              type="submit"
              disabled={countBalances.length === 0}
              className="min-h-[48px] px-6 rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer disabled:opacity-50"
            >
              اعتماد تسوية الجرد وتوثيق الفروقات
            </button>
          </form>
        </section>
      )}

      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={movSearch}
                onChange={(e) => setMovSearch(e.target.value)}
                placeholder="بحث بالصنف أو الملاحظات أو المرجع..."
                className="w-full min-h-[42px] rounded-xl border border-slate-300 pr-9 pl-3 text-sm"
              />
            </div>

            <select
              value={movItemFilter}
              onChange={(e) => setMovItemFilter(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold"
            >
              <option value="">كل الأصناف</option>
              {items.map((i) => (
                <option key={i.item.id} value={i.item.id}>
                  {i.item.name}
                </option>
              ))}
            </select>

            <select
              value={movWhFilter}
              onChange={(e) => setMovWhFilter(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold"
            >
              <option value="">كل المخازن</option>
              {warehouses.map((w) => (
                <option key={w.warehouse.id} value={w.warehouse.id}>
                  {w.warehouse.name}
                </option>
              ))}
            </select>

            <select
              value={movTypeFilter}
              onChange={(e) => setMovTypeFilter(e.target.value as StockMovementType | 'all')}
              className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold"
            >
              <option value="all">كل أنواع الحركات</option>
              {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>

            <div className="sm:col-span-2 lg:col-span-5 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>من:</span>
                <input
                  type="date"
                  value={movDateFrom}
                  onChange={(e) => setMovDateFrom(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-slate-300 px-2.5 text-xs"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>إلى:</span>
                <input
                  type="date"
                  value={movDateTo}
                  onChange={(e) => setMovDateTo(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-slate-300 px-2.5 text-xs"
                />
              </label>
            </div>
          </div>

          <section className="rounded-2xl bg-white border border-slate-200 p-4 overflow-x-auto">
            {movements.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">
                لا توجد حركات مخزنية مطابقة للبحث.
              </p>
            ) : (
              <table className="w-full min-w-[760px] text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                    <th className="py-2.5 px-2">التاريخ</th>
                    <th className="py-2.5 px-2">النوع</th>
                    <th className="py-2.5 px-2">الصنف</th>
                    <th className="py-2.5 px-2">المخزن</th>
                    <th className="py-2.5 px-2">الكمية</th>
                    <th className="py-2.5 px-2">المستخدم</th>
                    <th className="py-2.5 px-2">البيان / المستند</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.movement.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-2 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatArabicDateTime(m.movement.createdAt)}
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-[#0B1F3A]">
                        {MOVEMENT_TYPE_LABELS[m.movement.movementType]}
                      </td>
                      <td className="py-2.5 px-2 font-semibold">{m.itemName}</td>
                      <td className="py-2.5 px-2 text-slate-600">{m.warehouseName}</td>
                      <td
                        className={`py-2.5 px-2 font-bold tabular-nums ${
                          m.movement.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                        dir="ltr"
                      >
                        {m.movement.quantityDelta > 0
                          ? `+${m.movement.quantityDelta}`
                          : m.movement.quantityDelta}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-slate-600">{m.actorName}</td>
                      <td className="py-2.5 px-2 text-xs text-slate-600">{m.movement.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* Add Warehouse Modal */}
      {whModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0B1F3A]">إضافة مخزن جديد</h3>
              <button
                type="button"
                onClick={() => setWhModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateWarehouse(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الكود</label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={whCode}
                  onChange={(e) => setWhCode(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  اسم المخزن
                </label>
                <input
                  type="text"
                  required
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  placeholder="مثال: مخزن فرع الجيزة / سيارة التوزيع 1"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الموقع</label>
                <input
                  type="text"
                  value={whLocation}
                  onChange={(e) => setWhLocation(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={whIsDefault}
                  onChange={(e) => setWhIsDefault(e.target.checked)}
                  className="h-4 w-4 accent-[#0B1F3A]"
                />
                <span>تعيين كمخزن افتراضي رئيسي</span>
              </label>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-xl bg-[#0B1F3A] text-white text-sm font-bold hover:bg-[#133159] cursor-pointer"
              >
                حفظ المخزن
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
