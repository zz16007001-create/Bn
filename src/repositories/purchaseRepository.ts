import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  PaymentRecord,
  PurchaseInvoiceLineRecord,
  PurchaseInvoiceRecord,
  StockMovementRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {
  computeReversedWeightedAverageCost,
  computeWeightedAverageCost,
  convertToBaseQuantity,
} from '../utils/inventoryMath';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, requirePermission, withReadTx, withWriteTx} from './baseRepository';
import {
  postTreasuryMovementTx,
  reverseTreasuryMovementBySourceTx,
} from './treasuryRepository';

export interface PurchaseLineInput {
  itemId: UUID;
  unitId: UUID;
  quantity: number;
  unitCostPiastres: number; // cost per selected unit (piece or carton)
}

export interface CreatePurchaseInvoiceInput {
  supplierId: UUID;
  warehouseId: UUID;
  invoiceDate?: string;
  discountPiastres?: number;
  paidPiastres?: number;
  paymentMethodId?: UUID | null;
  notes?: string;
  lines: PurchaseLineInput[];
}

export interface EnrichedPurchaseLine {
  line: PurchaseInvoiceLineRecord;
  itemName: string;
  itemSku: string;
  unitName: string;
  conversionFactor: number;
}

export interface PurchaseInvoiceWithDetails {
  invoice: PurchaseInvoiceRecord;
  supplierName: string;
  warehouseName: string;
  lines: EnrichedPurchaseLine[];
}

async function createPurchaseInternal(
  actor: UserRecord,
  input: CreatePurchaseInvoiceInput,
  options?: {amendedFromId?: UUID | null; reversesId?: UUID | null}
): Promise<PurchaseInvoiceWithDetails> {
  await requirePermission(
    actor,
    options?.amendedFromId ? 'invoice.edit' : 'invoice.create',
    options?.amendedFromId
      ? 'ليس لديك صلاحية تعديل فواتير المشتريات.'
      : 'ليس لديك صلاحية إنشاء فواتير مشتريات.'
  );

  if (!input.lines || input.lines.length === 0) {
    throw new Error('يجب إضافة صنف واحد على الأقل إلى فاتورة الشراء.');
  }

  const supplier = await db.suppliers.get(input.supplierId);
  if (!supplier) throw new Error('المورد المحدد غير موجود.');

  const warehouse = await db.warehouses.get(input.warehouseId);
  if (!warehouse) throw new Error('المخزن المحدد غير موجود.');

  const discountPiastres = assertPiastres(input.discountPiastres ?? 0, 'الخصم');
  if (discountPiastres < 0) {
    throw new Error('الخصم لا يمكن أن يكون سالباً.');
  }

  const now = Date.now();
  const invoiceId = generateUUID();
  const invoiceCount = await db.purchase_invoices.count();
  const invoiceNumber = `PUR-${String(invoiceCount + 1).padStart(4, '0')}`;
  const invoiceDate = input.invoiceDate ?? todayISODate();

  // Track running stock & cost within this invoice so multi-line same-item invoices stay exact
  const allMovements = await db.stock_movements.toArray();
  const runningStockByItem = new Map<UUID, number>();
  for (const m of allMovements) {
    runningStockByItem.set(m.itemId, (runningStockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
  }
  const runningAvgCostByItem = new Map<UUID, number>();

  let subtotalPiastres = 0;
  const lineRecords: PurchaseInvoiceLineRecord[] = [];
  const movementRecords: StockMovementRecord[] = [];
  const enrichedLines: EnrichedPurchaseLine[] = [];

  for (const rawLine of input.lines) {
    const item = await db.items.get(rawLine.itemId);
    if (!item) throw new Error('أحد الأصناف المحددة غير موجود.');

    const unit = await db.units.get(rawLine.unitId);
    if (!unit || unit.itemId !== item.id) {
      throw new Error(`وحدة التعبئة غير صالحة للصنف (${item.name}).`);
    }

    const quantity = Number(rawLine.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`الكمية غير صالحة للصنف (${item.name}).`);
    }

    const unitCostPiastres = assertPiastres(rawLine.unitCostPiastres, 'سعر الشراء');
    if (unitCostPiastres < 0) {
      throw new Error(`سعر الشراء غير صالح للصنف (${item.name}).`);
    }

    const baseQuantity = convertToBaseQuantity(quantity, unit.conversionFactor);
    const lineTotalPiastres = Math.round(quantity * unitCostPiastres);
    const unitCostBasePiastres = Math.round(lineTotalPiastres / baseQuantity);

    const currentStock = runningStockByItem.get(item.id) ?? 0;
    const currentAvgCost = runningAvgCostByItem.get(item.id) ?? item.costPricePiastres;
    const newAvgCost = computeWeightedAverageCost({
      currentStockQty: currentStock,
      currentAvgCostPiastres: currentAvgCost,
      incomingBaseQty: baseQuantity,
      incomingUnitCostBasePiastres: unitCostBasePiastres,
    });

    runningStockByItem.set(item.id, currentStock + baseQuantity);
    runningAvgCostByItem.set(item.id, newAvgCost);

    const lineRecord: PurchaseInvoiceLineRecord = {
      id: generateUUID(),
      invoiceId,
      itemId: item.id,
      unitId: unit.id,
      quantity,
      baseQuantity,
      unitCostPiastres,
      unitCostBasePiastres,
      previousAvgCostPiastres: currentAvgCost,
      returnedBaseQuantity: 0,
      lineTotalPiastres,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };

    const movRecord: StockMovementRecord = {
      id: generateUUID(),
      itemId: item.id,
      warehouseId: warehouse.id,
      movementType: 'purchase_in',
      quantityDelta: baseQuantity,
      unitCostPiastres: unitCostBasePiastres,
      referenceType: 'purchase_invoice',
      referenceId: invoiceId,
      notes: `شراء فاتورة ${invoiceNumber} (${quantity} ${unit.name})`,
      reversesId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };

    subtotalPiastres += lineTotalPiastres;
    lineRecords.push(lineRecord);
    movementRecords.push(movRecord);
    enrichedLines.push({
      line: lineRecord,
      itemName: item.name,
      itemSku: item.sku,
      unitName: unit.name,
      conversionFactor: unit.conversionFactor,
    });
  }

  if (discountPiastres > subtotalPiastres) {
    throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة.');
  }

  const totalPiastres = subtotalPiastres - discountPiastres;
  const paidPiastres = assertPiastres(input.paidPiastres ?? 0, 'المبلغ المدفوع');
  if (paidPiastres < 0 || paidPiastres > totalPiastres) {
    throw new Error('المبلغ المدفوع يجب أن يكون بين 0 وإجمالي الفاتورة.');
  }

  const remainingPiastres = totalPiastres - paidPiastres;

  let paymentMethodId = input.paymentMethodId ?? null;
  if (paidPiastres > 0 && !paymentMethodId) {
    const defPm = await db.payment_methods.filter((pm) => pm.isDefault).first();
    paymentMethodId = defPm?.id ?? (await db.payment_methods.toCollection().first())?.id ?? null;
  }

  const invoice: PurchaseInvoiceRecord = {
    id: invoiceId,
    invoiceNumber,
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    invoiceDate,
    subtotalPiastres,
    discountPiastres,
    totalPiastres,
    paidPiastres,
    remainingPiastres,
    status: 'posted',
    reversedById: null,
    reversesId: options?.reversesId ?? null,
    amendedFromId: options?.amendedFromId ?? null,
    returnedPiastres: 0,
    paymentMethodId,
    treasuryTransactionId: null,
    notes: (input.notes ?? '').trim(),
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };

  await db.purchase_invoices.add(invoice);
  await db.purchase_invoice_lines.bulkAdd(lineRecords);
  await db.stock_movements.bulkAdd(movementRecords);

  // Persist updated weighted average costs on items
  for (const [itemId, avgCost] of runningAvgCostByItem.entries()) {
    await db.items.update(itemId, {costPricePiastres: avgCost, updatedAt: now});
  }

  // Record initial payment voucher and treasury outflow if paid > 0
  if (paidPiastres > 0 && paymentMethodId) {
    const trx = await postTreasuryMovementTx({
      actor,
      paymentMethodId,
      direction: 'out',
      amountPiastres: paidPiastres,
      sourceType: 'purchase_cash',
      sourceId: invoice.id,
      transactionDate: invoiceDate,
      idempotencyKey: `purchase_cash:${invoice.id}`,
      notes: `مدفوع فاتورة شراء ${invoiceNumber} (${supplier.name})`,
    });
    invoice.treasuryTransactionId = trx.id;
    await db.purchase_invoices.update(invoice.id, {treasuryTransactionId: trx.id});

    const payCount = await db.payments.count();
    const payVoucher = `PAY-${String(payCount + 1).padStart(4, '0')}`;
    const payment: PaymentRecord = {
      id: generateUUID(),
      voucherNumber: payVoucher,
      supplierId: supplier.id,
      purchaseInvoiceId: invoice.id,
      paymentMethodId,
      amountPiastres: paidPiastres,
      paymentDate: invoiceDate,
      status: 'posted',
      reversedById: null,
      reversesId: null,
      isInvoiceInitialPayment: true,
      treasuryTransactionId: trx.id,
      notes: `سداد فوري مع فاتورة شراء ${invoiceNumber}`,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };
    await db.payments.add(payment);
  }

  // Update supplier owed balance
  await db.suppliers.update(supplier.id, {
    currentBalancePiastres: supplier.currentBalancePiastres + remainingPiastres,
    updatedAt: now,
  });

  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'create',
    entityType: 'purchase_invoices',
    entityId: invoice.id,
    summary: `اعتماد فاتورة شراء ${invoiceNumber} للمورد ${supplier.name}`,
    details: {totalPiastres, paidPiastres, remainingPiastres, linesCount: lineRecords.length},
  });

  return {
    invoice,
    supplierName: supplier.name,
    warehouseName: warehouse.name,
    lines: enrichedLines,
  };
}

async function reversePurchaseInternal(
  actor: UserRecord,
  invoiceId: UUID,
  reason = 'إلغاء فاتورة شراء بقيد عكسي',
  requiredPermission: 'invoice.cancel' | 'invoice.edit' = 'invoice.cancel'
): Promise<PurchaseInvoiceRecord> {
  await requirePermission(
    actor,
    requiredPermission,
    requiredPermission === 'invoice.cancel'
      ? 'ليس لديك صلاحية إلغاء فواتير المشتريات.'
      : 'ليس لديك صلاحية تعديل فواتير المشتريات.'
  );

  const invoice = await db.purchase_invoices.get(invoiceId);
  if (!invoice) throw new Error('فاتورة الشراء غير موجودة.');
  if (invoice.status === 'reversed') {
    throw new Error('هذه الفاتورة ملغاة/معكوسة بالفعل.');
  }

  const now = Date.now();
  const reversalMarkerId = generateUUID();

  const [lines, origMovements, allMovements, supplier, linkedPayments] = await Promise.all([
    db.purchase_invoice_lines.where('invoiceId').equals(invoiceId).toArray(),
    db.stock_movements.where('referenceId').equals(invoiceId).toArray(),
    db.stock_movements.toArray(),
    db.suppliers.get(invoice.supplierId),
    db.payments.where('purchaseInvoiceId').equals(invoiceId).toArray(),
  ]);

  const totalStockByItem = new Map<UUID, number>();
  for (const m of allMovements) {
    totalStockByItem.set(m.itemId, (totalStockByItem.get(m.itemId) ?? 0) + m.quantityDelta);
  }

  const runningAvgCostByItem = new Map<UUID, number>();
  const reversalMovements: StockMovementRecord[] = [];

  // Reverse lines in reverse creation order so weighted average cost unwinds cleanly
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const item = await db.items.get(line.itemId);
    if (!item) continue;

    const currentTotalStock = totalStockByItem.get(item.id) ?? 0;
    const currentAvgCost = runningAvgCostByItem.get(item.id) ?? item.costPricePiastres;

    const unwoundAvgCost = computeReversedWeightedAverageCost({
      stockAfterPurchaseQty: currentTotalStock,
      avgCostAfterPurchasePiastres: currentAvgCost,
      reversedBaseQty: line.baseQuantity,
      reversedUnitCostBasePiastres: line.unitCostBasePiastres,
      previousAvgCostPiastres: line.previousAvgCostPiastres,
    });

    totalStockByItem.set(item.id, currentTotalStock - line.baseQuantity);
    runningAvgCostByItem.set(item.id, unwoundAvgCost);

    const matchingOrigMov = origMovements.find(
      (m) => m.itemId === line.itemId && m.movementType === 'purchase_in'
    );

    reversalMovements.push({
      id: generateUUID(),
      itemId: line.itemId,
      warehouseId: invoice.warehouseId,
      movementType: 'reversal',
      quantityDelta: -line.baseQuantity,
      unitCostPiastres: line.unitCostBasePiastres,
      referenceType: 'purchase_invoice_reversal',
      referenceId: invoice.id,
      notes: `${reason} (${invoice.invoiceNumber})`,
      reversesId: matchingOrigMov?.id ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    });
  }

  if (reversalMovements.length > 0) {
    await db.stock_movements.bulkAdd(reversalMovements);
  }

  for (const [itemId, avgCost] of runningAvgCostByItem.entries()) {
    await db.items.update(itemId, {costPricePiastres: avgCost, updatedAt: now});
  }

  // Reverse initial payment(s) created directly by this invoice
  let reversedInitialPaid = 0;
  for (const pay of linkedPayments) {
    if (pay.isInvoiceInitialPayment && pay.status === 'posted') {
      reversedInitialPaid += pay.amountPiastres;
      await db.payments.update(pay.id, {
        status: 'reversed',
        reversedById: reversalMarkerId,
        updatedAt: now,
      });
    }
  }

  if (supplier) {
    // Reversing invoice credit (-totalPiastres) and reversing initial payment debit (+reversedInitialPaid)
    const netBalanceAdjustment = -invoice.totalPiastres + reversedInitialPaid;
    await db.suppliers.update(supplier.id, {
      currentBalancePiastres: supplier.currentBalancePiastres + netBalanceAdjustment,
      updatedAt: now,
    });
  }

  if (invoice.paidPiastres > 0) {
    await reverseTreasuryMovementBySourceTx({
      actor,
      sourceType: 'purchase_cash',
      sourceId: invoice.id,
      transactionDate: invoice.invoiceDate,
      notes: `${reason} (${invoice.invoiceNumber})`,
    });
  }

  await db.purchase_invoices.update(invoiceId, {
    status: 'reversed',
    reversedById: reversalMarkerId,
    updatedAt: now,
  });

  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'reverse',
    entityType: 'purchase_invoices',
    entityId: invoice.id,
    summary: `عكس وإلغاء فاتورة شراء ${invoice.invoiceNumber} (${reason})`,
    details: {totalPiastres: invoice.totalPiastres, reversedInitialPaid},
    before: {status: invoice.status, reversedById: invoice.reversedById},
    after: {status: 'reversed', reversedById: reversalMarkerId},
  });

  return {...invoice, status: 'reversed', reversedById: reversalMarkerId, updatedAt: now};
}

export const purchaseRepository = {
  async listPurchaseInvoices(filter?: {
    search?: string;
    status?: 'all' | 'posted' | 'reversed';
  }): Promise<PurchaseInvoiceWithDetails[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.suppliers,
        db.warehouses,
        db.items,
        db.units,
      ],
      async () => {
        const [invoices, lines, suppliers, warehouses, items, units] = await Promise.all([
          db.purchase_invoices.orderBy('createdAt').reverse().toArray(),
          db.purchase_invoice_lines.toArray(),
          db.suppliers.toArray(),
          db.warehouses.toArray(),
          db.items.toArray(),
          db.units.toArray(),
        ]);

        const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
        const whMap = new Map(warehouses.map((w) => [w.id, w]));
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const unitMap = new Map(units.map((u) => [u.id, u]));

        const linesByInv = new Map<UUID, EnrichedPurchaseLine[]>();
        for (const l of lines) {
          const item = itemMap.get(l.itemId);
          const unit = unitMap.get(l.unitId);
          const arr = linesByInv.get(l.invoiceId) ?? [];
          arr.push({
            line: l,
            itemName: item?.name ?? 'صنف محذوف',
            itemSku: item?.sku ?? '-',
            unitName: unit?.name ?? 'قطعة',
            conversionFactor: unit?.conversionFactor ?? 1,
          });
          linesByInv.set(l.invoiceId, arr);
        }

        const searchLower = filter?.search?.trim().toLowerCase() ?? '';
        const statusFilter = filter?.status ?? 'all';

        return invoices
          .filter((inv) => {
            if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
            if (searchLower) {
              const supName = supplierMap.get(inv.supplierId)?.name.toLowerCase() ?? '';
              const matchNo = inv.invoiceNumber.toLowerCase().includes(searchLower);
              const matchNotes = inv.notes.toLowerCase().includes(searchLower);
              if (!supName.includes(searchLower) && !matchNo && !matchNotes) return false;
            }
            return true;
          })
          .map((invoice) => ({
            invoice,
            supplierName: supplierMap.get(invoice.supplierId)?.name ?? 'مورد غير معروف',
            warehouseName: whMap.get(invoice.warehouseId)?.name ?? 'مخزن غير معروف',
            lines: linesByInv.get(invoice.id) ?? [],
          }));
      }
    );
  },

  async createPurchaseInvoice(
    actor: UserRecord,
    input: CreatePurchaseInvoiceInput
  ): Promise<PurchaseInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.suppliers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.payments,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => createPurchaseInternal(actor, input)
    );
  },

  async cancelPurchaseInvoice(
    actor: UserRecord,
    invoiceId: UUID,
    reason?: string
  ): Promise<PurchaseInvoiceRecord> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.suppliers,
        db.items,
        db.stock_movements,
        db.payments,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => reversePurchaseInternal(actor, invoiceId, reason, 'invoice.cancel')
    );
  },

  async amendPurchaseInvoice(
    actor: UserRecord,
    originalInvoiceId: UUID,
    newInput: CreatePurchaseInvoiceInput
  ): Promise<PurchaseInvoiceWithDetails> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.suppliers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.payments,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        await reversePurchaseInternal(
          actor,
          originalInvoiceId,
          'تعديل فاتورة شراء بقيد عكسي',
          'invoice.edit'
        );
        return createPurchaseInternal(actor, newInput, {
          amendedFromId: originalInvoiceId,
          reversesId: originalInvoiceId,
        });
      }
    );
  },
};
