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
import {convertToBaseQuantity} from '../utils/inventoryMath';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {postTreasuryMovementTx} from './treasuryRepository';

export interface SalesReturnLineInput {
  salesInvoiceLineId: UUID;
  quantity: number;
  condition: 'good' | 'damaged';
}

export interface CreateSalesReturnInput {
  salesInvoiceId: UUID;
  returnDate?: string;
  refundMode: 'cash' | 'customer_credit';
  reason?: string;
  notes?: string;
  lines: SalesReturnLineInput[];
}

export interface EnrichedSalesReturnLine {
  line: ReturnLineRecord;
  itemName: string;
  itemSku: string;
  unitName: string;
}

export interface SalesReturnWithDetails {
  record: ReturnRecord;
  invoiceNumber: string;
  customerName: string;
  warehouseName: string;
  lines: EnrichedSalesReturnLine[];
}

export const salesReturnRepository = {
  async listSalesReturns(search?: string): Promise<SalesReturnWithDetails[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [
        db.returns,
        db.return_lines,
        db.sales_invoices,
        db.customers,
        db.warehouses,
        db.items,
        db.units,
      ],
      async () => {
        const [returns, returnLines, invoices, customers, warehouses, items, units] =
          await Promise.all([
            db.returns.orderBy('createdAt').reverse().toArray(),
            db.return_lines.toArray(),
            db.sales_invoices.toArray(),
            db.customers.toArray(),
            db.warehouses.toArray(),
            db.items.toArray(),
            db.units.toArray(),
          ]);

        const invMap = new Map(invoices.map((i) => [i.id, i]));
        const custMap = new Map(customers.map((c) => [c.id, c]));
        const whMap = new Map(warehouses.map((w) => [w.id, w]));
        const itemMap = new Map(items.map((i) => [i.id, i]));
        const unitMap = new Map(units.map((u) => [u.id, u]));

        const linesByReturn = new Map<UUID, EnrichedSalesReturnLine[]>();
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
          .filter((r) => r.returnType === 'sales_return')
          .map((record) => {
            const inv = invMap.get(record.referenceInvoiceId);
            const cust = record.partyId ? custMap.get(record.partyId) : undefined;
            return {
              record,
              invoiceNumber: inv?.invoiceNumber ?? '-',
              customerName: cust?.name ?? 'عميل نقدي مباشر',
              warehouseName: whMap.get(record.warehouseId)?.name ?? 'مخزن غير معروف',
              lines: linesByReturn.get(record.id) ?? [],
            };
          })
          .filter((entry) => {
            if (!searchLower) return true;
            return (
              entry.record.returnNumber.toLowerCase().includes(searchLower) ||
              entry.invoiceNumber.toLowerCase().includes(searchLower) ||
              entry.customerName.toLowerCase().includes(searchLower) ||
              entry.record.reason.toLowerCase().includes(searchLower)
            );
          });
      }
    );
  },

  async createSalesReturn(
    actor: UserRecord,
    input: CreateSalesReturnInput
  ): Promise<SalesReturnWithDetails> {
    await runDatabaseMigrations();
    if (!input.lines || input.lines.length === 0) {
      throw new Error('يجب تحديد صنف واحد على الأقل لإرجاعه.');
    }

    return withWriteTx(
      [
        db.returns,
        db.return_lines,
        db.sales_invoices,
        db.sales_invoice_lines,
        db.customers,
        db.warehouses,
        db.items,
        db.units,
        db.stock_movements,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        const invoice = await db.sales_invoices.get(input.salesInvoiceId);
        if (!invoice) throw new Error('فاتورة المبيعات المحددة غير موجودة.');
        if (invoice.status !== 'posted') {
          throw new Error('لا يمكن تسجيل مرتجع إلا على فاتورة مبيعات معتمدة.');
        }

        if (input.refundMode === 'customer_credit' && !invoice.customerId) {
          throw new Error('الفواتير بدون عميل يجب رد قيمة المرتجع فيها نقداً.');
        }

        const invLines = await db.sales_invoice_lines
          .where('invoiceId')
          .equals(invoice.id)
          .toArray();
        const invLineMap = new Map(invLines.map((l) => [l.id, l]));

        const now = Date.now();
        const returnId = generateUUID();
        const returnCount = await db.returns.count();
        const returnNumber = `RET-${String(returnCount + 1).padStart(4, '0')}`;
        const returnDate = input.returnDate ?? todayISODate();

        const warehouse = await db.warehouses.get(invoice.warehouseId);
        const customer = invoice.customerId
          ? await db.customers.get(invoice.customerId)
          : undefined;

        const discountRatio =
          invoice.subtotalPiastres > 0
            ? invoice.totalPiastres / invoice.subtotalPiastres
            : 1;

        let totalReturnPiastres = 0;
        let restockedCostPiastres = 0;
        const returnLineRecords: ReturnLineRecord[] = [];
        const movementRecords: StockMovementRecord[] = [];
        const enrichedLines: EnrichedSalesReturnLine[] = [];

        const lineReturnedTracker = new Map<UUID, number>();
        for (const l of invLines) {
          lineReturnedTracker.set(l.id, l.returnedBaseQuantity ?? 0);
        }

        for (const rawLine of input.lines) {
          const invLine = invLineMap.get(rawLine.salesInvoiceLineId);
          if (!invLine) {
            throw new Error('أحد البنود المحددة غير تابع لهذه الفاتورة.');
          }

          const item = await db.items.get(invLine.itemId);
          const unit = await db.units.get(invLine.unitId);
          const conversionFactor =
            invLine.unitConversionFactor || unit?.conversionFactor || 1;

          const quantity = Number(rawLine.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error(`الكمية المرتجعة غير صالحة للصنف (${item?.name ?? ''}).`);
          }

          const baseQuantity = convertToBaseQuantity(quantity, conversionFactor);
          const alreadyReturned = lineReturnedTracker.get(invLine.id) ?? 0;
          const remainingReturnable = invLine.baseQuantity - alreadyReturned;

          if (baseQuantity > remainingReturnable) {
            throw new Error(
              `الكمية المرتجعة للصنف (${item?.name ?? ''}) تتجاوز المتاح للإرجاع (${remainingReturnable} قطعة).`
            );
          }

          lineReturnedTracker.set(invLine.id, alreadyReturned + baseQuantity);

          const rawRatioOfLine = baseQuantity / invLine.baseQuantity;
          const lineTotalPiastres = Math.round(
            invLine.lineTotalPiastres * rawRatioOfLine * discountRatio
          );
          const lineCostPiastres = baseQuantity * invLine.costPricePiastres;

          const returnLine: ReturnLineRecord = {
            id: generateUUID(),
            returnId,
            salesInvoiceLineId: invLine.id,
            purchaseInvoiceLineId: null,
            itemId: invLine.itemId,
            unitId: invLine.unitId,
            quantity,
            baseQuantity,
            unitPricePiastres: invLine.unitPricePiastres,
            costPricePiastres: invLine.costPricePiastres,
            condition: rawLine.condition,
            lineTotalPiastres,
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
          };

          if (rawLine.condition === 'good') {
            movementRecords.push({
              id: generateUUID(),
              itemId: invLine.itemId,
              warehouseId: invoice.warehouseId,
              movementType: 'return_in',
              quantityDelta: baseQuantity,
              unitCostPiastres: invLine.costPricePiastres,
              referenceType: 'sales_return',
              referenceId: returnId,
              notes: `مرتجع مبيعات صالح (${returnNumber}) عن فاتورة ${invoice.invoiceNumber}`,
              reversesId: null,
              createdAt: now,
              updatedAt: now,
              createdBy: actor.id,
            });
            restockedCostPiastres += lineCostPiastres;
          }

          totalReturnPiastres += lineTotalPiastres;
          returnLineRecords.push(returnLine);
          enrichedLines.push({
            line: returnLine,
            itemName: item?.name ?? 'صنف محذوف',
            itemSku: item?.sku ?? '-',
            unitName: unit?.name ?? 'قطعة',
          });
        }

        const returnRecord: ReturnRecord = {
          id: returnId,
          returnNumber,
          returnType: 'sales_return',
          referenceInvoiceId: invoice.id,
          partyId: invoice.customerId,
          warehouseId: invoice.warehouseId,
          returnDate,
          totalPiastres: totalReturnPiastres,
          returnedCostPiastres: restockedCostPiastres,
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
        if (movementRecords.length > 0) {
          await db.stock_movements.bulkAdd(movementRecords);
        }

        // Persist updated returnedBaseQuantity on sales invoice lines
        for (const [lineId, newReturnedQty] of lineReturnedTracker.entries()) {
          await db.sales_invoice_lines.update(lineId, {
            returnedBaseQuantity: newReturnedQty,
            updatedAt: now,
          });
        }

        // Update invoice return totals and adjusted profit
        const updatedReturnedPiastres = invoice.returnedPiastres + totalReturnPiastres;
        const updatedReturnedCostPiastres =
          invoice.returnedCostPiastres + restockedCostPiastres;
        const updatedProfitPiastres =
          invoice.totalPiastres -
          updatedReturnedPiastres -
          (invoice.totalCostPiastres - updatedReturnedCostPiastres);

        await db.sales_invoices.update(invoice.id, {
          returnedPiastres: updatedReturnedPiastres,
          returnedCostPiastres: updatedReturnedCostPiastres,
          profitPiastres: updatedProfitPiastres,
          updatedAt: now,
        });

        // Update customer balance if refunded as credit on account, or deduct from treasury if cash refund
        if (input.refundMode === 'customer_credit' && customer) {
          await db.customers.update(customer.id, {
            currentBalancePiastres: customer.currentBalancePiastres - totalReturnPiastres,
            updatedAt: now,
          });
        } else if (input.refundMode === 'cash' && totalReturnPiastres > 0) {
          await postTreasuryMovementTx({
            actor,
            paymentMethodId: invoice.paymentMethodId,
            direction: 'out',
            amountPiastres: totalReturnPiastres,
            sourceType: 'sales_return_cash',
            sourceId: returnId,
            transactionDate: returnDate,
            idempotencyKey: `sales_return_cash:${returnId}`,
            notes: `رد نقدي لمرتجع مبيعات ${returnNumber} عن فاتورة ${invoice.invoiceNumber}`,
          });
        }

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'returns',
          entityId: returnRecord.id,
          summary: `تسجيل مرتجع مبيعات ${returnNumber} عن فاتورة ${invoice.invoiceNumber}`,
          details: {
            totalReturnPiastres,
            restockedCostPiastres,
            refundMode: input.refundMode,
            reason: returnRecord.reason,
          },
        });

        return {
          record: returnRecord,
          invoiceNumber: invoice.invoiceNumber,
          customerName: customer?.name ?? 'عميل نقدي مباشر',
          warehouseName: warehouse?.name ?? 'مخزن غير معروف',
          lines: enrichedLines,
        };
      }
    );
  },
};
