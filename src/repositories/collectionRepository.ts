import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {CollectionRecord, UserRecord, UUID} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {
  postTreasuryMovementTx,
  reverseTreasuryMovementBySourceTx,
} from './treasuryRepository';

export interface RecordCollectionInput {
  customerId: UUID;
  amountPiastres: number;
  paymentMethodId?: UUID | null;
  invoiceId?: UUID | null;
  collectionDate?: string;
  notes?: string;
  allowCreditExcess?: boolean;
  clientRequestId?: string | null;
}

export interface EnrichedCollection {
  collection: CollectionRecord;
  customerName: string;
  customerCode: string;
  paymentMethodName: string;
  invoiceNumber: string | null;
}

export const collectionRepository = {
  async listCollections(filter?: {
    search?: string;
    customerId?: UUID;
    status?: 'all' | 'posted' | 'reversed';
  }): Promise<EnrichedCollection[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.collections, db.customers, db.payment_methods, db.sales_invoices],
      async () => {
        const [collections, customers, methods, invoices] = await Promise.all([
          db.collections.orderBy('createdAt').reverse().toArray(),
          db.customers.toArray(),
          db.payment_methods.toArray(),
          db.sales_invoices.toArray(),
        ]);

        const customerMap = new Map(customers.map((c) => [c.id, c]));
        const methodMap = new Map(methods.map((m) => [m.id, m]));
        const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
        const searchLower = filter?.search?.trim().toLowerCase() ?? '';
        const statusFilter = filter?.status ?? 'all';

        return collections
          .filter((col) => {
            if (filter?.customerId && col.customerId !== filter.customerId) return false;
            if (statusFilter !== 'all' && col.status !== statusFilter) return false;
            if (searchLower) {
              const cust = customerMap.get(col.customerId);
              const inv = col.invoiceId ? invoiceMap.get(col.invoiceId) : undefined;
              const matchReceipt = col.receiptNumber.toLowerCase().includes(searchLower);
              const matchCust = cust?.name.toLowerCase().includes(searchLower) ?? false;
              const matchInv = inv?.invoiceNumber.toLowerCase().includes(searchLower) ?? false;
              const matchNotes = col.notes.toLowerCase().includes(searchLower);
              if (!matchReceipt && !matchCust && !matchInv && !matchNotes) return false;
            }
            return true;
          })
          .map((collection) => {
            const cust = customerMap.get(collection.customerId);
            const method = methodMap.get(collection.paymentMethodId);
            const inv = collection.invoiceId ? invoiceMap.get(collection.invoiceId) : undefined;
            return {
              collection,
              customerName: cust?.name ?? 'عميل غير معروف',
              customerCode: cust?.code ?? '-',
              paymentMethodName: method?.name ?? 'نقدي',
              invoiceNumber: inv?.invoiceNumber ?? null,
            };
          });
      }
    );
  },

  async recordCollection(
    actor: UserRecord,
    input: RecordCollectionInput
  ): Promise<CollectionRecord> {
    await runDatabaseMigrations();
    const amountPiastres = assertPiastres(input.amountPiastres, 'مبلغ التحصيل');
    if (amountPiastres <= 0) {
      throw new Error('مبلغ التحصيل يجب أن يكون أكبر من صفر.');
    }

    return withWriteTx(
      [
        db.roles,
        db.customers,
        db.collections,
        db.payment_methods,
        db.treasury_transactions,
        db.sales_invoices,
        db.audit_log,
      ],
      async () => {
        const actorRole = await db.roles.get(actor.roleId);
        if (!actorRole || !actorRole.permissions.includes('collections.manage')) {
          throw new Error('ليس لديك صلاحية تسجيل التحصيلات.');
        }

        const cleanClientReqId = input.clientRequestId?.trim() || null;
        if (cleanClientReqId) {
          const duplicate = await db.collections
            .where('clientRequestId')
            .equals(cleanClientReqId)
            .first();
          if (duplicate) {
            throw new Error('تم تسجيل سند التحصيل هذا مسبقاً (منع التكرار).');
          }
        }

        const customer = await db.customers.get(input.customerId);
        if (!customer) throw new Error('العميل المحدد غير موجود.');

        const currentDebt = Math.max(0, customer.currentBalancePiastres);
        const isExcessOverDebt = amountPiastres > currentDebt;
        if (isExcessOverDebt && !input.allowCreditExcess) {
          throw new Error(
            'مبلغ التحصيل أكبر من المديونية الحالية للعميل. يرجى التأكيد لتسجيل الفائض كرصيد دائن للعميل.'
          );
        }

        if (input.invoiceId) {
          const linkedInv = await db.sales_invoices.get(input.invoiceId);
          if (!linkedInv || linkedInv.customerId !== customer.id) {
            throw new Error('الفاتورة المرتبطة غير موجودة أو لا تخص هذا العميل.');
          }
        }

        let methodId = input.paymentMethodId ?? undefined;
        if (!methodId) {
          const defPm = await db.payment_methods.filter((pm) => pm.isDefault).first();
          methodId = defPm?.id ?? (await db.payment_methods.toCollection().first())?.id;
        }
        if (!methodId) {
          throw new Error('لم يتم العثور على طريقة دفع صالحة.');
        }

        const count = await db.collections.count();
        const receiptNumber = `COL-${String(count + 1).padStart(4, '0')}`;
        const now = Date.now();

        const record: CollectionRecord = {
          id: generateUUID(),
          receiptNumber,
          customerId: customer.id,
          invoiceId: input.invoiceId ?? null,
          paymentMethodId: methodId,
          amountPiastres,
          collectionDate: input.collectionDate ?? todayISODate(),
          status: 'posted',
          reversedById: null,
          reversesId: null,
          isInvoiceInitialCollection: false,
          creditExcessConfirmed: isExcessOverDebt,
          clientRequestId: cleanClientReqId,
          notes:
            (input.notes ?? '').trim() || `تحصيل من العميل ${customer.name}`,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.collections.add(record);
        await db.customers.update(customer.id, {
          currentBalancePiastres: customer.currentBalancePiastres - amountPiastres,
          updatedAt: now,
        });

        await postTreasuryMovementTx({
          actor,
          paymentMethodId: methodId,
          direction: 'in',
          amountPiastres,
          sourceType: 'collection',
          sourceId: record.id,
          transactionDate: record.collectionDate,
          idempotencyKey: `collection:${record.id}`,
          notes: `تحصيل عميل (${customer.name}) سند ${receiptNumber}`,
        });

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'collections',
          entityId: record.id,
          summary: `تسجيل تحصيل من العميل (${customer.name}) سند ${receiptNumber}`,
          details: {
            amountPiastres,
            invoiceId: record.invoiceId,
            creditExcessConfirmed: isExcessOverDebt,
          },
        });

        return record;
      }
    );
  },

  async reverseCollection(
    actor: UserRecord,
    collectionId: UUID,
    reason = 'عكس سند تحصيل'
  ): Promise<CollectionRecord> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.collections,
        db.customers,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        const actorRole = await db.roles.get(actor.roleId);
        if (!actorRole || !actorRole.permissions.includes('collections.manage')) {
          throw new Error('ليس لديك صلاحية عكس التحصيلات.');
        }

        const col = await db.collections.get(collectionId);
        if (!col) throw new Error('سند التحصيل غير موجود.');
        if (col.status === 'reversed') throw new Error('سند التحصيل معكوس بالفعل.');
        if (col.isInvoiceInitialCollection) {
          throw new Error('هذا التحصيل مرتبط بفاتورة مبيعات مباشرة؛ يُعكس بإلغاء الفاتورة.');
        }

        const now = Date.now();
        const markerId = generateUUID();
        const customer = await db.customers.get(col.customerId);

        await db.collections.update(collectionId, {
          status: 'reversed',
          reversedById: markerId,
          updatedAt: now,
        });

        if (customer) {
          await db.customers.update(customer.id, {
            currentBalancePiastres: customer.currentBalancePiastres + col.amountPiastres,
            updatedAt: now,
          });
        }

        await reverseTreasuryMovementBySourceTx({
          actor,
          sourceType: 'collection',
          sourceId: col.id,
          transactionDate: col.collectionDate,
          notes: `${reason} (${col.receiptNumber})`,
        });

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'reverse',
          entityType: 'collections',
          entityId: col.id,
          summary: `عكس سند التحصيل ${col.receiptNumber} (${reason})`,
          details: {amountPiastres: col.amountPiastres},
          before: {status: col.status, reversedById: col.reversedById},
          after: {status: 'reversed', reversedById: markerId},
        });

        return {
          ...col,
          status: 'reversed',
          reversedById: markerId,
          updatedAt: now,
        };
      }
    );
  },
};
