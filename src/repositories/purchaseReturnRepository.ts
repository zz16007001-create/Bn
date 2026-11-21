import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  ReturnLineRecord,
  ReturnRecord,
  StockMovementRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {
  computeReversedWeightedAverageCost,
  convertToBaseQuantity,
} from '../utils/inventoryMath';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {postTreasuryMovementTx} from './treasuryRepository';

export interface PurchaseReturnLineInput {
  purchaseInvoiceLineId: UUID;
  quantity: number;
}

export interface CreatePurchaseReturnInput {
  purchaseInvoiceId: UUID;
  returnDate?: string;
  refundMode: 'supplier_credit' | 'cash_refund';
  paymentMethodId?: UUID | null;
  reason?: string;
  notes?: string;
  lines: PurchaseReturnLineInput[];
}

export interface EnrichedPurchaseReturnLine {
  line: ReturnLineRecord;
  itemName: string;
  itemSku: string;
  unitName: string;
}

export interface PurchaseReturnWithDetails {
  record: ReturnRecord;
  invoiceNumber: string;
  supplierName: string;
  warehouseName: string;
  lines: EnrichedPurchaseReturnLine[];
}

export const purchaseReturnRepository = {
  async listPurchaseReturns(search?: string): Promise<PurchaseReturnWithDetails[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.returns,
        db.return_lines,
        db.purchase_invoices,
        db.suppliers,
        db.warehouses,
        db.items,
        db.units,
      ],
      async () => {
        const [returns, returnLines, invoices, suppliers, warehouses, items, units] =
          await Promise.all([
            db.returns.orderBy('createdAt').reverse().toArray(),
            db.return_lines.toArray(),
            db.purchase_invoices.toArray(),
            db.suppliers.toArray(),
            db.warehouses.toArray(),
            db.items.toArray(),
            db.units.toArray(),
          ]);

        const invMap = new Map(invoices.map((i) => [i.id, i]));
        const supMap = new Map(suppliers.map((s) => [s.id, s]));
        const whMap = new Map(warehouses.map((w) => [w.id, w]));
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const unitMap = new Map(units.map((u) => [u.id, u]));

        const linesByReturn = new Map<UUID, EnrichedPurchaseReturnLine[]>();
        for (const rl of returnLines) {
          const item = itemMap.get(rl.itemId);
          const unit = unitMap.get(rl.unitId);
          const arr = linesByReturn.get(rl.returnId) ?? [];
          arr.push({
            line: rl,
            itemName: item?.name ?? 'صنف محذوف',
            itemSku: item?.sku ?? '-',
            unitName: unit?.name ?? 'قطعة',
          });
          linesByReturn.set(rl.returnId, arr);
        }

        const searchLower = search?.trim().toLowerCase() ?? '';

        return returns
          .filter((r) => r.returnType === 'purchase_return')
          .map((record) => {
            const inv = invMap.get(record.referenceInvoiceId);
            const sup = record.partyId ? supMap.get(record.partyId) : undefined;
            return {
              record,
              invoiceNumber: inv?.invoiceNumber ?? '-',
              supplierName: sup?.name ?? 'مورد غير معروف',
              warehouseName: whMap.get(record.warehouseId)?.name ?? 'مخزن غير معروف',
              lines: linesByReturn.get(record.id) ?? [],
            };
          })
          .filter((entry) => {
            if (!searchLower) return true;
            return (
              entry.record.returnNumber.toLowerCase().includes(searchLower) ||
              entry.invoiceNumber.toLowerCase().includes(searchLower) ||
              entry.supplierName.toLowerCase().includes(searchLower) ||
              entry.record.reason.toLowerCase().includes(searchLower)
            );
          });
      }
    );
  },

  async createPurchaseReturn(
    actor: UserRecord,
    input: CreatePurchaseReturnInput
  ): Promise<PurchaseReturnWithDetails> {
    await runDatabaseMigrations();
    if (!input.lines || input.lines.length === 0) {
      throw new Error('يجب تحديد صنف واحد على الأقل لإرجاعه للمورد.');
    }

    return withWriteTx(
      [
        db.returns,
        db.return_lines,
        db.purchase_invoices,
        db.purchase_invoice_lines,
        db.suppliers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        const invoice = await db.purchase_invoices.get(input.purchaseInvoiceId);
        if (!invoice) throw new Error('فاتورة الشراء المحددة غير موجودة.');
        if (invoice.status !== 'posted') {
          throw new Error('لا يمكن تسجيل مرتجع شراء إلا على فاتورة شراء معتمدة.');
        }

        const invLines = await db.purchase_invoice_lines
          .where('invoiceId')
          .equals(invoice.id)
          .toArray();
        const invLineMap = new Map(invLines.map((l) => [l.id, l]));

        const [warehouse, supplier, allMovements] = await Promise.all([
          db.warehouses.get(invoice.warehouseId),
          db.suppliers.get(invoice.supplierId),
          db.stock_movements.toArray(),
        ]);

        const totalStockByItem = new Map<UUID, number>();
        const whStockByItem = new Map<UUID, number>();
        for (const m of allMovements) {
          totalStockByItem.set(
            m.itemId,
            (totalStockByItem.get(m.itemId) ?? 0) + m.quantityDelta
          );
          if (m.warehouseId === invoice.warehouseId) {
            whStockByItem.set(
              m.itemId,
              (whStockByItem.get(m.itemId) ?? 0) + m.quantityDelta
            );
          }
        }

        const now = Date.now();
        const returnId = generateUUID();
        const returnCount = await db.returns.count();
        const returnNumber = `PRET-${String(returnCount + 1).padStart(4, '0')}`;
        const returnDate = input.returnDate ?? todayISODate();

        const discountRatio =
          invoice.subtotalPiastres > 0
            ? invoice.totalPiastres / invoice.subtotalPiastres
            : 1;

        let totalReturnPiastres = 0;
        const returnLineRecords: ReturnLineRecord[] = [];
        const movementRecords: StockMovementRecord[] = [];
        const enrichedLines: EnrichedPurchaseReturnLine[] = [];
        const updatedAvgCostByItem = new Map<UUID, number>();

        const lineReturnedTracker = new Map<UUID, number>();
        for (const l of invLines) {
          lineReturnedTracker.set(l.id, l.returnedBaseQuantity ?? 0);
        }

        for (const rawLine of input.lines) {
          const invLine = invLineMap.get(rawLine.purchaseInvoiceLineId);
          if (!invLine) {
            throw new Error('أحد البنود المحددة غير تابع لفاتورة الشراء هذه.');
          }

          const item = await db.items.get(invLine.itemId);
          if (!item) throw new Error('الصنف غير موجود.');
          const unit = await db.units.get(invLine.unitId);
          const conversionFactor = unit?.conversionFactor ?? 1;

          const quantity = Number(rawLine.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error(`الكمية المرتجعة غير صالحة للصنف (${item.name}).`);
          }

          const baseQuantity = convertToBaseQuantity(quantity, conversionFactor);
          const alreadyReturned = lineReturnedTracker.get(invLine.id) ?? 0;
          const remainingReturnable = invLine.baseQuantity - alreadyReturned;

          if (baseQuantity > remainingReturnable) {
            throw new Error(
              `الكمية المرتجعة للصنف (${item.name}) تتجاوز الكمية المتاحة للإرجاع من الفاتورة (${remainingReturnable} قطعة).`
            );
          }

          const whAvailable = whStockByItem.get(item.id) ?? 0;
          if (baseQuantity > whAvailable) {
            throw new Error(
              `رصيد المخزن الحالي من (${item.name}) هو ${whAvailable} قطعة ولا يكفي لإرجاع ${baseQuantity} قطعة.`
            );
          }

          lineReturnedTracker.set(invLine.id, alreadyReturned + baseQuantity);
          whStockByItem.set(item.id, whAvailable - baseQuantity);

          const rawRatio = baseQuantity / invLine.baseQuantity;
          const lineTotalPiastres = Math.round(
            invLine.lineTotalPiastres * rawRatio * discountRatio
          );

          // Unwind weighted average cost
          const currentTotalStock = totalStockByItem.get(item.id) ?? 0;
          const currentAvgCost =
            updatedAvgCostByItem.get(item.id) ?? item.costPricePiastres;
          const nextAvgCost = computeReversedWeightedAverageCost({
            stockAfterPurchaseQty: currentTotalStock,
            avgCostAfterPurchasePiastres: currentAvgCost,
            reversedBaseQty: baseQuantity,
            reversedUnitCostBasePiastres: invLine.unitCostBasePiastres,
            previousAvgCostPiastres: invLine.previousAvgCostPiastres,
          });
          totalStockByItem.set(item.id, currentTotalStock - baseQuantity);
          updatedAvgCostByItem.set(item.id, nextAvgCost);

          const retLine: ReturnLineRecord = {
            id: generateUUID(),
            returnId,
            salesInvoiceLineId: null,
            purchaseInvoiceLineId: invLine.id,
            itemId: invLine.itemId,
            unitId: invLine.unitId,
            quantity,
            baseQuantity,
            unitPricePiastres: invLine.unitCostPiastres,
            costPricePiastres: invLine.unitCostBasePiastres,
            condition: 'good',
            lineTotalPiastres,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
          };

          movementRecords.push({
            id: generateUUID(),
            itemId: invLine.itemId,
            warehouseId: invoice.warehouseId,
            movementType: 'return_out',
            quantityDelta: -baseQuantity,
            unitCostPiastres: invLine.unitCostBasePiastres,
            referenceType: 'purchase_return',
            referenceId: returnId,
            notes: `مرتجع شراء (${returnNumber}) عن فاتورة ${invoice.invoiceNumber}`,
            reversesId: null,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
          });

          totalReturnPiastres += lineTotalPiastres;
          returnLineRecords.push(retLine);
          enrichedLines.push({
            line: retLine,
            itemName: item.name,
            itemSku: item.sku,
            unitName: unit?.name ?? 'قطعة',
          });
        }

        const returnRecord: ReturnRecord = {
          id: returnId,
          returnNumber,
          returnType: 'purchase_return',
          referenceInvoiceId: invoice.id,
          partyId: invoice.supplierId,
          warehouseId: invoice.warehouseId,
          returnDate,
          totalPiastres: totalReturnPiastres,
          returnedCostPiastres: totalReturnPiastres,
          refundMode: input.refundMode,
          reason: (input.reason ?? '').trim(),
          status: 'posted',
          reversesId: null,
          notes: (input.notes ?? '').trim(),
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.returns.add(returnRecord);
        await db.return_lines.bulkAdd(returnLineRecords);
        await db.stock_movements.bulkAdd(movementRecords);

        for (const [itemId, avgCost] of updatedAvgCostByItem.entries()) {
          await db.items.update(itemId, {costPricePiastres: avgCost, updatedAt: now});
        }

        for (const [lineId, newReturnedQty] of lineReturnedTracker.entries()) {
          await db.purchase_invoice_lines.update(lineId, {
            returnedBaseQuantity: newReturnedQty,
            updatedAt: now,
          });
        }

        await db.purchase_invoices.update(invoice.id, {
          returnedPiastres: (invoice.returnedPiastres ?? 0) + totalReturnPiastres,
          updatedAt: now,
        });

        if (input.refundMode === 'supplier_credit') {
          if (supplier) {
            await db.suppliers.update(supplier.id, {
              currentBalancePiastres: supplier.currentBalancePiastres - totalReturnPiastres,
              updatedAt: now,
            });
          }
        } else {
          // Refunded in cash -> credit treasury
          await postTreasuryMovementTx({
            actor,
            paymentMethodId: input.paymentMethodId ?? invoice.paymentMethodId,
            direction: 'in',
            amountPiastres: totalReturnPiastres,
            sourceType: 'purchase_return',
            sourceId: returnId,
            transactionDate: returnDate,
            idempotencyKey: `purchase_return:${returnId}`,
            notes: `مبلغ مسترد نقداً عن مرتجع شراء ${returnNumber} (${supplier?.name ?? ''})`,
          });
        }

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'returns',
          entityId: returnRecord.id,
          summary: `تسجيل مرتجع شراء ${returnNumber} عن فاتورة ${invoice.invoiceNumber}`,
          details: {
            totalReturnPiastres,
            refundMode: input.refundMode,
            reason: returnRecord.reason,
          },
        });

        return {
          record: returnRecord,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: supplier?.name ?? 'مورد غير معروف',
          warehouseName: warehouse?.name ?? 'مخزن غير معروف',
          lines: enrichedLines,
        };
      }
    );
  },
};
