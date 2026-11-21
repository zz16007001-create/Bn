import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  CollectionRecord,
  PermissionKey,
  ReturnLineRecord,
  ReturnRecord,
  SalesInvoiceLineRecord,
  SalesInvoiceRecord,
  SalesInvoiceStatus,
  StockMovementRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {convertToBaseQuantity} from '../utils/inventoryMath';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {
  postTreasuryMovementTx,
  reverseTreasuryMovementBySourceTx,
} from './treasuryRepository';

export interface SalesLineInput {
  itemId: UUID;
  unitId: UUID;
  quantity: number;
  unitPricePiastres?: number;
  discountPiastres?: number;
}

export interface CreateSalesInvoiceInput {
  customerId?: UUID | null;
  warehouseId: UUID;
  invoiceDate?: string;
  discountType?: 'fixed' | 'percent';
  discountValue?: number; // piastres if fixed, 0..100 if percent
  paymentType: 'cash' | 'credit' | 'partial';
  paidPiastres?: number;
  paymentMethodId?: UUID | null;
  notes?: string;
  clientRequestId?: string | null;
  lines: SalesLineInput[];
}

export interface EnrichedSalesLine {
  line: SalesInvoiceLineRecord;
  itemName: string;
  itemSku: string;
  unitName: string;
  conversionFactor: number;
}

export interface SalesInvoiceWithDetails {
  invoice: SalesInvoiceRecord;
  customerName: string;
  customerPhone: string;
  warehouseName: string;
  paymentMethodName: string;
  lines: EnrichedSalesLine[];
  returns?: Array<{
    record: ReturnRecord;
    lines: ReturnLineRecord[];
  }>;
  subsequentCollections?: CollectionRecord[];
}

async function getActorPermissions(actor: UserRecord): Promise<Set<PermissionKey>> {
  const role = await db.roles.get(actor.roleId);
  return new Set(role?.permissions ?? []);
}

async function computeNextSequentialSalesNumber(prefix: 'INV' | 'DRF'): Promise<string> {
  const all = await db.sales_invoices.toArray();
  let maxSeq = 0;
  for (const inv of all) {
    if (inv.invoiceNumber.startsWith(`${prefix}-`)) {
      const n = Number.parseInt(inv.invoiceNumber.slice(prefix.length + 1), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
}

function computeInvoiceDiscountPiastres(
  subtotalPiastres: number,
  discountType: 'fixed' | 'percent',
  discountValue: number
): number {
  if (discountValue <= 0) return 0;
  if (discountType === 'percent') {
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100) {
      throw new Error('نسبة الخصم يجب أن تكون بين 0% و 100%.');
    }
    return Math.round((subtotalPiastres * discountValue) / 100);
  }
  const fixed = assertPiastres(discountValue, 'قيمة الخصم');
  if (fixed < 0) throw new Error('قيمة الخصم لا يمكن أن تكون سالبة.');
  return fixed;
}

async function prepareValidatedLinesAndTotals(params: {
  actor: UserRecord;
  permissions: Set<PermissionKey>;
  input: CreateSalesInvoiceInput;
  invoiceId: UUID;
  invoiceNumber: string;
  checkStockAndCreateMovements: boolean;
  now: number;
}) {
  const {actor, permissions, input, invoiceId, invoiceNumber, checkStockAndCreateMovements, now} =
    params;

  if (!input.lines || input.lines.length === 0) {
    throw new Error('يجب إدخال صنف واحد على الأقل بكمية أكبر من صفر.');
  }

  const warehouse = await db.warehouses.get(input.warehouseId);
  if (!warehouse) throw new Error('المخزن المحدد غير موجود.');

  let customerName = 'عميل نقدي مباشر';
  if (input.customerId) {
    const customer = await db.customers.get(input.customerId);
    if (!customer) throw new Error('العميل المحدد غير موجود.');
    customerName = customer.name;
  }

  // Build available stock map for selected warehouse
  const warehouseMovements = await db.stock_movements
    .where('warehouseId')
    .equals(warehouse.id)
    .toArray();
  const runningStockByItem = new Map<UUID, number>();
  for (const m of warehouseMovements) {
    runningStockByItem.set(m.itemId, (runningStockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
  }

  let subtotalPiastres = 0;
  let totalCostPiastres = 0;
  const lineRecords: SalesInvoiceLineRecord[] = [];
  const movementRecords: StockMovementRecord[] = [];
  const enrichedLines: EnrichedSalesLine[] = [];

  for (const rawLine of input.lines) {
    const item = await db.items.get(rawLine.itemId);
    if (!item) throw new Error('أحد الأصناف المحددة غير موجود.');

    const unit = await db.units.get(rawLine.unitId);
    if (!unit || unit.itemId !== item.id) {
      throw new Error(`وحدة البيع غير صالحة للصنف (${item.name}).`);
    }

    const quantity = Number(rawLine.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`الكمية غير صالحة للصنف (${item.name}).`);
    }

    const baseQuantity = convertToBaseQuantity(quantity, unit.conversionFactor);

    const catalogUnitPrice =
      unit.salePricePiastres > 0
        ? unit.salePricePiastres
        : unit.isBase
        ? item.retailPricePiastres
        : item.wholesalePricePiastres;

    const unitPricePiastres =
      rawLine.unitPricePiastres !== undefined
        ? assertPiastres(rawLine.unitPricePiastres, 'سعر الوحدة')
        : catalogUnitPrice;

    if (unitPricePiastres < 0) {
      throw new Error(`سعر الوحدة لا يمكن أن يكون سالباً (${item.name}).`);
    }

    if (
      unitPricePiastres !== catalogUnitPrice &&
      !permissions.has('price.override')
    ) {
      throw new Error(`ليس لديك صلاحية تعديل سعر الصنف (${item.name}).`);
    }

    const lineDiscountPiastres = assertPiastres(
      rawLine.discountPiastres ?? 0,
      'خصم البند'
    );
    if (lineDiscountPiastres > 0 && !permissions.has('discount.apply')) {
      throw new Error('ليس لديك صلاحية تطبيق الخصومات.');
    }

    if (checkStockAndCreateMovements) {
      const available = runningStockByItem.get(item.id) ?? 0;
      if (baseQuantity > available && !permissions.has('stock.override')) {
        throw new Error(
          `الكمية المطلوبة من (${item.name}) تتجاوز الرصيد المتاح (${available} قطعة) ولا تملك صلاحية تجاوز المخزون.`
        );
      }
      runningStockByItem.set(item.id, available - baseQuantity);
    }

    const grossLineTotal = Math.round(quantity * unitPricePiastres);
    if (lineDiscountPiastres > grossLineTotal) {
      throw new Error(`خصم السطر يتجاوز قيمة البند (${item.name}).`);
    }
    const lineTotalPiastres = grossLineTotal - lineDiscountPiastres;
    const costPerBasePiastres = item.costPricePiastres;
    const lineCostPiastres = baseQuantity * costPerBasePiastres;

    const lineRecord: SalesInvoiceLineRecord = {
      id: generateUUID(),
      invoiceId,
      itemId: item.id,
      unitId: unit.id,
      quantity,
      baseQuantity,
      unitConversionFactor: unit.conversionFactor,
      unitPricePiastres,
      costPricePiastres: costPerBasePiastres,
      discountPiastres: lineDiscountPiastres,
      returnedBaseQuantity: 0,
      lineTotalPiastres,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };

    if (checkStockAndCreateMovements) {
      movementRecords.push({
        id: generateUUID(),
        itemId: item.id,
        warehouseId: warehouse.id,
        movementType: 'sale_out',
        quantityDelta: -baseQuantity,
        unitCostPiastres: costPerBasePiastres,
        referenceType: 'sales_invoice',
        referenceId: invoiceId,
        notes: `بيع فاتورة ${invoiceNumber} (${quantity} ${unit.name})`,
        reversesId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      });
    }

    subtotalPiastres += lineTotalPiastres;
    totalCostPiastres += lineCostPiastres;
    lineRecords.push(lineRecord);
    enrichedLines.push({
      line: lineRecord,
      itemName: item.name,
      itemSku: item.sku,
      unitName: unit.name,
      conversionFactor: unit.conversionFactor,
    });
  }

  const discountType = input.discountType ?? 'fixed';
  const discountValue = input.discountValue ?? 0;
  const discountPiastres = computeInvoiceDiscountPiastres(
    subtotalPiastres,
    discountType,
    discountValue
  );

  if (discountPiastres > 0 && !permissions.has('discount.apply')) {
    throw new Error('ليس لديك صلاحية تطبيق خصم على الفاتورة.');
  }
  if (discountPiastres > subtotalPiastres) {
    throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة.');
  }

  const totalPiastres = subtotalPiastres - discountPiastres;

  let paidPiastres = 0;
  if (input.paymentType === 'cash') {
    paidPiastres = totalPiastres;
  } else if (input.paymentType === 'credit') {
    paidPiastres = 0;
  } else {
    paidPiastres = assertPiastres(input.paidPiastres ?? 0, 'المبلغ المدفوع');
  }

  if (paidPiastres < 0 || paidPiastres > totalPiastres) {
    throw new Error('المبلغ المدفوع يجب أن يكون بين 0 وإجمالي الفاتورة.');
  }

  const remainingPiastres = totalPiastres - paidPiastres;
  if (remainingPiastres > 0 && !input.customerId) {
    throw new Error('البيع الآجل أو الجزئي يتطلب اختيار عميل.');
  }

  let paymentMethodId = input.paymentMethodId ?? null;
  let paymentMethodName = 'نقدي';
  if (!paymentMethodId) {
    const defPm = await db.payment_methods.filter((pm) => pm.isDefault).first();
    const fallbackPm = defPm ?? (await db.payment_methods.toCollection().first());
    paymentMethodId = fallbackPm?.id ?? null;
    paymentMethodName = fallbackPm?.name ?? 'نقدي';
  } else {
    const pm = await db.payment_methods.get(paymentMethodId);
    paymentMethodName = pm?.name ?? 'نقدي';
  }

  const profitPiastres = totalPiastres - totalCostPiastres;

  return {
    warehouse,
    customerName,
    subtotalPiastres,
    discountType,
    discountValue,
    discountPiastres,
    totalPiastres,
    paidPiastres,
    remainingPiastres,
    totalCostPiastres,
    profitPiastres,
    paymentMethodId,
    paymentMethodName,
    lineRecords,
    movementRecords,
    enrichedLines,
  };
}

async function createPostedSalesInternal(
  actor: UserRecord,
  input: CreateSalesInvoiceInput,
  options?: {
    amendedFromId?: UUID | null;
    reversesId?: UUID | null;
    replaceDraftId?: UUID | null;
  }
): Promise<SalesInvoiceWithDetails> {
  const permissions = await getActorPermissions(actor);
  if (!permissions.has('invoice.create')) {
    throw new Error('ليس لديك صلاحية إنشاء فواتير مبيعات.');
  }

  const cleanClientReqId = input.clientRequestId?.trim() || null;
  if (cleanClientReqId) {
    const existing = await db.sales_invoices
      .where('clientRequestId')
      .equals(cleanClientReqId)
      .first();
    if (existing) {
      throw new Error('تم حفظ هذه الفاتورة مسبقاً (منع التكرار).');
    }
  }

  const now = Date.now();
  const invoiceId = options?.replaceDraftId ?? generateUUID();
  const invoiceNumber = await computeNextSequentialSalesNumber('INV');
  const invoiceDate = input.invoiceDate ?? todayISODate();

  const prepared = await prepareValidatedLinesAndTotals({
    actor,
    permissions,
    input,
    invoiceId,
    invoiceNumber,
    checkStockAndCreateMovements: true,
    now,
  });

  // If promoting a draft, remove old draft lines first
  if (options?.replaceDraftId) {
    await db.sales_invoice_lines.where('invoiceId').equals(options.replaceDraftId).delete();
    await db.sales_invoices.delete(options.replaceDraftId);
  }

  const invoice: SalesInvoiceRecord = {
    id: invoiceId,
    invoiceNumber,
    customerId: input.customerId ?? null,
    warehouseId: prepared.warehouse.id,
    invoiceDate,
    subtotalPiastres: prepared.subtotalPiastres,
    discountType: prepared.discountType,
    discountValue: prepared.discountValue,
    discountPiastres: prepared.discountPiastres,
    totalPiastres: prepared.totalPiastres,
    paidPiastres: prepared.paidPiastres,
    remainingPiastres: prepared.remainingPiastres,
    totalCostPiastres: prepared.totalCostPiastres,
    returnedPiastres: 0,
    returnedCostPiastres: 0,
    profitPiastres: prepared.profitPiastres,
    paymentType: input.paymentType,
    paymentMethodId: prepared.paymentMethodId,
    status: 'posted',
    reversedById: null,
    reversesId: options?.reversesId ?? null,
    amendedFromId: options?.amendedFromId ?? null,
    clientRequestId: cleanClientReqId,
    notes: (input.notes ?? '').trim(),
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };

  await db.sales_invoices.add(invoice);
  await db.sales_invoice_lines.bulkAdd(prepared.lineRecords);
  await db.stock_movements.bulkAdd(prepared.movementRecords);

  // Record ONLY actual cash paid at sale time into treasury (credit/unpaid portion never enters treasury)
  if (invoice.paidPiastres > 0 && prepared.paymentMethodId) {
    await postTreasuryMovementTx({
      actor,
      paymentMethodId: prepared.paymentMethodId,
      direction: 'in',
      amountPiastres: invoice.paidPiastres,
      sourceType: 'sales_cash',
      sourceId: invoice.id,
      transactionDate: invoiceDate,
      idempotencyKey: `sales_cash:${invoice.id}`,
      notes: `مبيعات (مدفوع) فاتورة ${invoiceNumber} (${prepared.customerName})`,
    });
  }

  // If customer is linked, record initial collection (if paid > 0) and increment balance
  let customerPhone = '';
  if (invoice.customerId) {
    const customer = await db.customers.get(invoice.customerId);
    if (customer) {
      customerPhone = customer.phone;
      if (invoice.paidPiastres > 0 && prepared.paymentMethodId) {
        const colCount = await db.collections.count();
        const receiptNumber = `COL-${String(colCount + 1).padStart(4, '0')}`;
        const initialCol: CollectionRecord = {
          id: generateUUID(),
          receiptNumber,
          customerId: customer.id,
          invoiceId: invoice.id,
          paymentMethodId: prepared.paymentMethodId,
          amountPiastres: invoice.paidPiastres,
          collectionDate: invoiceDate,
          status: 'posted',
          reversedById: null,
          reversesId: null,
          isInvoiceInitialCollection: true,
          creditExcessConfirmed: false,
          clientRequestId: null,
          notes: `تحصيل فوري مع فاتورة مبيعات ${invoiceNumber}`,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };
        await db.collections.add(initialCol);
      }

      await db.customers.update(customer.id, {
        currentBalancePiastres: customer.currentBalancePiastres + invoice.remainingPiastres,
        updatedAt: now,
      });
    }
  }

  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'create',
    entityType: 'sales_invoices',
    entityId: invoice.id,
    summary: `اعتماد فاتورة مبيعات ${invoiceNumber} (${prepared.customerName})`,
    details: {
      totalPiastres: invoice.totalPiastres,
      paidPiastres: invoice.paidPiastres,
      remainingPiastres: invoice.remainingPiastres,
      totalCostPiastres: invoice.totalCostPiastres,
      profitPiastres: invoice.profitPiastres,
    },
  });

  return {
    invoice,
    customerName: prepared.customerName,
    customerPhone,
    warehouseName: prepared.warehouse.name,
    paymentMethodName: prepared.paymentMethodName,
    lines: prepared.enrichedLines,
  };
}

async function reverseSalesInternal(
  actor: UserRecord,
  invoiceId: UUID,
  reason: string,
  requiredPermission: 'invoice.cancel' | 'invoice.edit'
): Promise<SalesInvoiceRecord> {
  const permissions = await getActorPermissions(actor);
  if (!permissions.has(requiredPermission)) {
    throw new Error(
      requiredPermission === 'invoice.cancel'
        ? 'ليس لديك صلاحية إلغاء فواتير المبيعات.'
        : 'ليس لديك صلاحية تعديل فواتير المبيعات.'
    );
  }

  const invoice = await db.sales_invoices.get(invoiceId);
  if (!invoice) throw new Error('فاتورة المبيعات غير موجودة.');
  if (invoice.status === 'reversed') {
    throw new Error('هذه الفاتورة ملغاة/معكوسة بالفعل.');
  }
  if (invoice.status === 'draft') {
    throw new Error('المسودة لم تُعتمد بعد؛ يمكنك تعديلها أو حذفها مباشرة.');
  }
  if (invoice.returnedPiastres > 0) {
    throw new Error('لا يمكن إلغاء أو تعديل فاتورة تم تسجيل مرتجع مبيعات عليها.');
  }

  const now = Date.now();
  const reversalMarkerId = generateUUID();

  const [lines, origMovements, customer, linkedCollections] = await Promise.all([
    db.sales_invoice_lines.where('invoiceId').equals(invoiceId).toArray(),
    db.stock_movements.where('referenceId').equals(invoiceId).toArray(),
    invoice.customerId ? db.customers.get(invoice.customerId) : Promise.resolve(undefined),
    db.collections.where('invoiceId').equals(invoiceId).toArray(),
  ]);

  const reversalMovements: StockMovementRecord[] = lines.map((line) => {
    const matchingOrigMov = origMovements.find(
      (m) => m.itemId === line.itemId && m.movementType === 'sale_out'
    );
    return {
      id: generateUUID(),
      itemId: line.itemId,
      warehouseId: invoice.warehouseId,
      movementType: 'reversal',
      quantityDelta: line.baseQuantity,
      unitCostPiastres: line.costPricePiastres,
      referenceType: 'sales_invoice_reversal',
      referenceId: invoice.id,
      notes: `${reason} (${invoice.invoiceNumber})`,
      reversesId: matchingOrigMov?.id ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };
  });

  if (reversalMovements.length > 0) {
    await db.stock_movements.bulkAdd(reversalMovements);
  }

  let reversedInitialPaid = 0;
  for (const col of linkedCollections) {
    if (col.isInvoiceInitialCollection && col.status === 'posted') {
      reversedInitialPaid += col.amountPiastres;
      await db.collections.update(col.id, {
        status: 'reversed',
        reversedById: reversalMarkerId,
        updatedAt: now,
      });
    }
  }

  if (customer) {
    const netBalanceAdjustment = -invoice.totalPiastres + reversedInitialPaid;
    await db.customers.update(customer.id, {
      currentBalancePiastres: customer.currentBalancePiastres + netBalanceAdjustment,
      updatedAt: now,
    });
  }

  if (invoice.paidPiastres > 0) {
    await reverseTreasuryMovementBySourceTx({
      actor,
      sourceType: 'sales_cash',
      sourceId: invoice.id,
      transactionDate: invoice.invoiceDate,
      notes: `${reason} (${invoice.invoiceNumber})`,
    });
  }

  await db.sales_invoices.update(invoiceId, {
    status: 'reversed',
    reversedById: reversalMarkerId,
    updatedAt: now,
  });

  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'reverse',
    entityType: 'sales_invoices',
    entityId: invoice.id,
    summary: `عكس وإلغاء فاتورة مبيعات ${invoice.invoiceNumber} (${reason})`,
    details: {totalPiastres: invoice.totalPiastres, reversedInitialPaid},
    before: {status: invoice.status, reversedById: invoice.reversedById},
    after: {status: 'reversed', reversedById: reversalMarkerId},
  });

  return {...invoice, status: 'reversed', reversedById: reversalMarkerId, updatedAt: now};
}

export const salesRepository = {
  async listSalesInvoices(filter?: {
    search?: string;
    status?: 'all' | SalesInvoiceStatus;
    dateFrom?: string;
    dateTo?: string;
    customerId?: UUID;
  }): Promise<SalesInvoiceWithDetails[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.payment_methods,
        db.items,
        db.units,
      ],
      async () => {
        const [invoices, lines, customers, warehouses, paymentMethods, items, units] =
          await Promise.all([
            db.sales_invoices.orderBy('createdAt').reverse().toArray(),
            db.sales_invoice_lines.toArray(),
            db.customers.toArray(),
            db.warehouses.toArray(),
            db.payment_methods.toArray(),
            db.items.toArray(),
            db.units.toArray(),
          ]);

        const customerMap = new Map(customers.map((c) => [c.id, c]));
        const whMap = new Map(warehouses.map((w) => [w.id, w]));
        const pmMap = new Map(paymentMethods.map((p) => [p.id, p]));
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const unitMap = new Map(units.map((u) => [u.id, u]));

        const linesByInv = new Map<UUID, EnrichedSalesLine[]>();
        for (const l of lines) {
          const item = itemMap.get(l.itemId);
          const unit = unitMap.get(l.unitId);
          const arr = linesByInv.get(l.invoiceId) ?? [];
          arr.push({
            line: l,
            itemName: item?.name ?? 'صنف محذوف',
            itemSku: item?.sku ?? '-',
            unitName: unit?.name ?? 'قطعة',
            conversionFactor: l.unitConversionFactor || unit?.conversionFactor || 1,
          });
          linesByInv.set(l.invoiceId, arr);
        }

        const searchLower = filter?.search?.trim().toLowerCase() ?? '';
        const statusFilter = filter?.status ?? 'all';

        return invoices
          .filter((inv) => {
            if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
            if (filter?.customerId && inv.customerId !== filter.customerId) return false;
            if (filter?.dateFrom && inv.invoiceDate < filter.dateFrom) return false;
            if (filter?.dateTo && inv.invoiceDate > filter.dateTo) return false;
            if (searchLower) {
              const cust = inv.customerId ? customerMap.get(inv.customerId) : undefined;
              const custName = (cust?.name ?? 'عميل نقدي').toLowerCase();
              const matchNo = inv.invoiceNumber.toLowerCase().includes(searchLower);
              const matchDate = inv.invoiceDate.toLowerCase().includes(searchLower);
              const matchNotes = inv.notes.toLowerCase().includes(searchLower);
              if (
                !custName.includes(searchLower) &&
                !matchNo &&
                !matchDate &&
                !matchNotes
              ) {
                return false;
              }
            }
            return true;
          })
          .map((invoice) => {
            const cust = invoice.customerId ? customerMap.get(invoice.customerId) : undefined;
            const pm = invoice.paymentMethodId
              ? pmMap.get(invoice.paymentMethodId)
              : undefined;
            return {
              invoice,
              customerName: cust?.name ?? 'عميل نقدي مباشر',
              customerPhone: cust?.phone ?? '',
              warehouseName: whMap.get(invoice.warehouseId)?.name ?? 'مخزن غير معروف',
              paymentMethodName: pm?.name ?? 'نقدي',
              lines: linesByInv.get(invoice.id) ?? [],
            };
          });
      }
    );
  },

  async getSalesInvoiceDetails(invoiceId: UUID): Promise<SalesInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.payment_methods,
        db.items,
        db.units,
        db.returns,
        db.return_lines,
        db.collections,
      ],
      async () => {
        const invoice = await db.sales_invoices.get(invoiceId);
        if (!invoice) throw new Error('الفاتورة غير موجودة.');

        const [lines, customer, warehouse, pm, items, units, returns, collections] =
          await Promise.all([
            db.sales_invoice_lines.where('invoiceId').equals(invoiceId).toArray(),
            invoice.customerId ? db.customers.get(invoice.customerId) : Promise.resolve(undefined),
            db.warehouses.get(invoice.warehouseId),
            invoice.paymentMethodId
              ? db.payment_methods.get(invoice.paymentMethodId)
              : Promise.resolve(undefined),
            db.items.toArray(),
            db.units.toArray(),
            db.returns.where('referenceInvoiceId').equals(invoiceId).toArray(),
            db.collections.where('invoiceId').equals(invoiceId).toArray(),
          ]);

        const itemMap = new Map(items.map((i) => [i.id, i]));
        const unitMap = new Map(units.map((u) => [u.id, u]));

        const enrichedLines: EnrichedSalesLine[] = lines.map((line) => {
          const item = itemMap.get(line.itemId);
          const unit = unitMap.get(line.unitId);
          return {
            line,
            itemName: item?.name ?? 'صنف محذوف',
            itemSku: item?.sku ?? '-',
            unitName: unit?.name ?? 'قطعة',
            conversionFactor: line.unitConversionFactor || unit?.conversionFactor || 1,
          };
        });

        const salesReturns = returns.filter((r) => r.returnType === 'sales_return');
        const returnDetails = await Promise.all(
          salesReturns.map(async (record) => ({
            record,
            lines: await db.return_lines.where('returnId').equals(record.id).toArray(),
          }))
        );

        return {
          invoice,
          customerName: customer?.name ?? 'عميل نقدي مباشر',
          customerPhone: customer?.phone ?? '',
          warehouseName: warehouse?.name ?? 'مخزن غير معروف',
          paymentMethodName: pm?.name ?? 'نقدي',
          lines: enrichedLines,
          returns: returnDetails,
          subsequentCollections: collections.filter((c) => !c.isInvoiceInitialCollection),
        };
      }
    );
  },

  async createOrPostSalesInvoice(
    actor: UserRecord,
    input: CreateSalesInvoiceInput,
    options?: {draftId?: UUID | null}
  ): Promise<SalesInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.collections,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () =>
        createPostedSalesInternal(actor, input, {
          replaceDraftId: options?.draftId ?? null,
        })
    );
  },

  async saveDraftSalesInvoice(
    actor: UserRecord,
    input: CreateSalesInvoiceInput,
    existingDraftId?: UUID | null
  ): Promise<SalesInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.payment_methods,
        db.audit_log,
      ],
      async () => {
        const permissions = await getActorPermissions(actor);
        if (!permissions.has('invoice.create')) {
          throw new Error('ليس لديك صلاحية حفظ مسودة فاتورة.');
        }

        const now = Date.now();
        let draftId = existingDraftId ?? generateUUID();
        let invoiceNumber = '';
        let createdAt = now;

        if (existingDraftId) {
          const existing = await db.sales_invoices.get(existingDraftId);
          if (!existing || existing.status !== 'draft') {
            throw new Error('المسودة المحددة غير موجودة أو تم اعتمادها مسبقاً.');
          }
          invoiceNumber = existing.invoiceNumber;
          createdAt = existing.createdAt;
          await db.sales_invoice_lines.where('invoiceId').equals(existingDraftId).delete();
        } else {
          draftId = generateUUID();
          invoiceNumber = await computeNextSequentialSalesNumber('DRF');
        }

        const prepared = await prepareValidatedLinesAndTotals({
          actor,
          permissions,
          input,
          invoiceId: draftId,
          invoiceNumber,
          checkStockAndCreateMovements: false,
          now,
        });

        const draft: SalesInvoiceRecord = {
          id: draftId,
          invoiceNumber,
          customerId: input.customerId ?? null,
          warehouseId: prepared.warehouse.id,
          invoiceDate: input.invoiceDate ?? todayISODate(),
          subtotalPiastres: prepared.subtotalPiastres,
          discountType: prepared.discountType,
          discountValue: prepared.discountValue,
          discountPiastres: prepared.discountPiastres,
          totalPiastres: prepared.totalPiastres,
          paidPiastres: prepared.paidPiastres,
          remainingPiastres: prepared.remainingPiastres,
          totalCostPiastres: prepared.totalCostPiastres,
          returnedPiastres: 0,
          returnedCostPiastres: 0,
          profitPiastres: prepared.profitPiastres,
          paymentType: input.paymentType,
          paymentMethodId: prepared.paymentMethodId,
          status: 'draft',
          reversedById: null,
          reversesId: null,
          amendedFromId: null,
          clientRequestId: null,
          notes: (input.notes ?? '').trim(),
          createdAt,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.sales_invoices.put(draft);
        await db.sales_invoice_lines.bulkAdd(prepared.lineRecords);

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: existingDraftId ? 'update' : 'create',
          entityType: 'sales_invoices',
          entityId: draft.id,
          summary: `حفظ مسودة فاتورة مبيعات ${invoiceNumber}`,
        });

        const customer = draft.customerId
          ? await db.customers.get(draft.customerId)
          : undefined;

        return {
          invoice: draft,
          customerName: prepared.customerName,
          customerPhone: customer?.phone ?? '',
          warehouseName: prepared.warehouse.name,
          paymentMethodName: prepared.paymentMethodName,
          lines: prepared.enrichedLines,
        };
      }
    );
  },

  async deleteDraftSalesInvoice(actor: UserRecord, draftId: UUID): Promise<void> {
    await runDatabaseMigrations();
    await withWriteTx([db.sales_invoices, db.sales_invoice_lines, db.audit_log], async () => {
      const existing = await db.sales_invoices.get(draftId);
      if (!existing) throw new Error('المسودة غير موجودة.');
      if (existing.status !== 'draft') {
        throw new Error('لا يمكن حذف فاتورة معتمدة؛ استخدم الإلغاء بقيد عكسي.');
      }
      await db.sales_invoice_lines.where('invoiceId').equals(draftId).delete();
      await db.sales_invoices.delete(draftId);
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'sales_invoices',
        entityId: draftId,
        summary: `حذف مسودة فاتورة مبيعات ${existing.invoiceNumber}`,
      });
    });
  },

  async cancelSalesInvoice(
    actor: UserRecord,
    invoiceId: UUID,
    reason = 'إلغاء فاتورة مبيعات بقيد عكسي'
  ): Promise<SalesInvoiceRecord> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.stock_movements,
        db.collections,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => reverseSalesInternal(actor, invoiceId, reason, 'invoice.cancel')
    );
  },

  async amendSalesInvoice(
    actor: UserRecord,
    originalInvoiceId: UUID,
    newInput: CreateSalesInvoiceInput
  ): Promise<SalesInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.collections,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        await reverseSalesInternal(
          actor,
          originalInvoiceId,
          'تعديل فاتورة مبيعات بقيد عكسي',
          'invoice.edit'
        );
        return createPostedSalesInternal(actor, newInput, {
          amendedFromId: originalInvoiceId,
          reversesId: originalInvoiceId,
        });
      }
    );
  },
};
