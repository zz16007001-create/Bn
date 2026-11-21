import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  CollectionRecord,
  CustomerRecord,
  ReturnRecord,
  SalesInvoiceRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';

export interface CustomerWithTotals {
  customer: CustomerRecord;
  totalSalesPiastres: number;
  totalReturnsPiastres: number;
  totalPaidPiastres: number;
  invoicesCount: number;
}

export interface CustomerStatementEntry {
  id: string;
  date: string;
  timestamp: number;
  type:
    | 'sales_invoice'
    | 'sales_invoice_reversal'
    | 'collection'
    | 'collection_reversal'
    | 'sales_return';
  typeLabelAr: string;
  referenceNumber: string;
  debitPiastres: number; // مدين (يزيد مديونية العميل)
  creditPiastres: number; // دائن (يخفض مديونية العميل)
  runningBalancePiastres: number;
  notes: string;
}

export const customerRepository = {
  async listCustomers(search?: string): Promise<CustomerWithTotals[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.customers, db.sales_invoices, db.collections, db.returns],
      async () => {
        const [customers, invoices, collections, returns] = await Promise.all([
          db.customers.toArray(),
          db.sales_invoices.toArray(),
          db.collections.toArray(),
          db.returns.toArray(),
        ]);

        const searchLower = search?.trim().toLowerCase() ?? '';

        return customers
          .filter((c) => {
            if (!searchLower) return true;
            return (
              c.name.toLowerCase().includes(searchLower) ||
              c.code.toLowerCase().includes(searchLower) ||
              c.phone.toLowerCase().includes(searchLower) ||
              c.area.toLowerCase().includes(searchLower)
            );
          })
          .map((customer) => {
            const postedInvoices = invoices.filter(
              (inv) => inv.customerId === customer.id && inv.status === 'posted'
            );
            const postedCollections = collections.filter(
              (col) => col.customerId === customer.id && col.status === 'posted'
            );
            const postedCreditReturns = returns.filter(
              (ret) =>
                ret.returnType === 'sales_return' &&
                ret.partyId === customer.id &&
                ret.status === 'posted'
            );

            const totalSalesPiastres = postedInvoices.reduce(
              (sum, inv) => sum + inv.totalPiastres,
              0
            );
            const totalPaidPiastres = postedCollections.reduce(
              (sum, col) => sum + col.amountPiastres,
              0
            );
            const totalReturnsPiastres = postedCreditReturns.reduce(
              (sum, ret) => sum + ret.totalPiastres,
              0
            );

            return {
              customer,
              totalSalesPiastres,
              totalReturnsPiastres,
              totalPaidPiastres,
              invoicesCount: postedInvoices.length,
            };
          })
          .sort((a, b) => a.customer.name.localeCompare(b.customer.name, 'ar'));
      }
    );
  },

  async createCustomer(
    actor: UserRecord,
    input: {
      code?: string;
      name: string;
      phone?: string;
      address?: string;
      area?: string;
      notes?: string;
      creditLimitPiastres?: number;
    }
  ): Promise<CustomerRecord> {
    await runDatabaseMigrations();
    const name = input.name.trim();
    if (name.length < 2) {
      throw new Error('اسم العميل يجب أن لا يقل عن حرفين.');
    }
    const creditLimitPiastres = assertPiastres(
      input.creditLimitPiastres ?? 0,
      'حد الائتمان'
    );
    if (creditLimitPiastres < 0) {
      throw new Error('حد الائتمان لا يمكن أن يكون سالباً.');
    }

    return withWriteTx([db.customers, db.audit_log], async () => {
      const count = await db.customers.count();
      const code =
        (input.code ?? '').trim().toUpperCase() ||
        `CUS-${String(count + 1).padStart(4, '0')}`;

      const dup = await db.customers.where('code').equals(code).first();
      if (dup) throw new Error(`كود العميل (${code}) مسجل مسبقاً.`);

      const now = Date.now();
      const customer: CustomerRecord = {
        id: generateUUID(),
        code,
        name,
        phone: (input.phone ?? '').trim(),
        address: (input.address ?? '').trim(),
        area: (input.area ?? '').trim(),
        notes: (input.notes ?? '').trim(),
        creditLimitPiastres,
        currentBalancePiastres: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };
      await db.customers.add(customer);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'customers',
        entityId: customer.id,
        summary: `إضافة عميل جديد: ${customer.name} (${customer.code})`,
      });

      return customer;
    });
  },

  async updateCustomer(
    actor: UserRecord,
    customerId: UUID,
    patch: {
      name?: string;
      phone?: string;
      address?: string;
      area?: string;
      notes?: string;
      creditLimitPiastres?: number;
      isActive?: boolean;
    }
  ): Promise<void> {
    await runDatabaseMigrations();
    if (patch.creditLimitPiastres !== undefined) {
      const limit = assertPiastres(patch.creditLimitPiastres, 'حد الائتمان');
      if (limit < 0) throw new Error('حد الائتمان لا يمكن أن يكون سالباً.');
    }

    await withWriteTx([db.customers, db.audit_log], async () => {
      const existing = await db.customers.get(customerId);
      if (!existing) throw new Error('العميل غير موجود.');
      if (patch.name !== undefined && patch.name.trim().length < 2) {
        throw new Error('اسم العميل يجب أن لا يقل عن حرفين.');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
      const nextPhone = patch.phone !== undefined ? patch.phone.trim() : existing.phone;
      const nextArea = patch.area !== undefined ? patch.area.trim() : existing.area;
      const nextLimit =
        patch.creditLimitPiastres !== undefined
          ? patch.creditLimitPiastres
          : existing.creditLimitPiastres;
      const nextActive = patch.isActive !== undefined ? patch.isActive : existing.isActive;

      await db.customers.update(customerId, {
        ...(patch.name !== undefined ? {name: nextName} : {}),
        ...(patch.phone !== undefined ? {phone: nextPhone} : {}),
        ...(patch.address !== undefined ? {address: patch.address.trim()} : {}),
        ...(patch.area !== undefined ? {area: nextArea} : {}),
        ...(patch.notes !== undefined ? {notes: patch.notes.trim()} : {}),
        ...(patch.creditLimitPiastres !== undefined
          ? {creditLimitPiastres: nextLimit}
          : {}),
        ...(patch.isActive !== undefined ? {isActive: nextActive} : {}),
        updatedAt: Date.now(),
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'customers',
        entityId: customerId,
        summary: `تحديث بيانات العميل: ${nextName}`,
        before: {
          name: existing.name,
          phone: existing.phone,
          area: existing.area,
          creditLimitPiastres: existing.creditLimitPiastres,
          isActive: existing.isActive,
        },
        after: {
          name: nextName,
          phone: nextPhone,
          area: nextArea,
          creditLimitPiastres: nextLimit,
          isActive: nextActive,
        },
      });
    });
  },

  async getCustomerDetails(customerId: UUID): Promise<{
    customer: CustomerRecord;
    invoices: SalesInvoiceRecord[];
    collections: CollectionRecord[];
    returns: ReturnRecord[];
  }> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.customers, db.sales_invoices, db.collections, db.returns],
      async () => {
        const customer = await db.customers.get(customerId);
        if (!customer) throw new Error('العميل غير موجود.');

        const [invoices, collections, returns] = await Promise.all([
          db.sales_invoices.where('customerId').equals(customerId).toArray(),
          db.collections.where('customerId').equals(customerId).toArray(),
          db.returns.where('partyId').equals(customerId).toArray(),
        ]);

        return {
          customer,
          invoices: invoices
            .filter((i) => i.status !== 'draft')
            .sort((a, b) => b.createdAt - a.createdAt),
          collections: collections.sort((a, b) => b.createdAt - a.createdAt),
          returns: returns
            .filter((r) => r.returnType === 'sales_return')
            .sort((a, b) => b.createdAt - a.createdAt),
        };
      }
    );
  },

  async getCustomerStatement(customerId: UUID): Promise<{
    customer: CustomerRecord;
    entries: CustomerStatementEntry[];
    totalSalesPiastres: number;
    totalCollectionsPiastres: number;
    totalReturnsCreditPiastres: number;
    linkedInvoices: SalesInvoiceRecord[];
  }> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.customers, db.sales_invoices, db.collections, db.returns],
      async () => {
        const customer = await db.customers.get(customerId);
        if (!customer) throw new Error('العميل غير موجود.');

        const [invoices, collections, returns] = await Promise.all([
          db.sales_invoices.where('customerId').equals(customerId).toArray(),
          db.collections.where('customerId').equals(customerId).toArray(),
          db.returns.where('partyId').equals(customerId).toArray(),
        ]);

        const rawEvents: Array<Omit<CustomerStatementEntry, 'runningBalancePiastres'>> = [];

        for (const inv of invoices) {
          if (inv.status === 'draft') continue;
          rawEvents.push({
            id: `sale-${inv.id}`,
            date: inv.invoiceDate,
            timestamp: inv.createdAt,
            type: 'sales_invoice',
            typeLabelAr: 'فاتورة مبيعات',
            referenceNumber: inv.invoiceNumber,
            debitPiastres: inv.totalPiastres,
            creditPiastres: 0,
            notes: inv.notes || 'فاتورة مبيعات معتمدة',
          });

          if (inv.status === 'reversed') {
            rawEvents.push({
              id: `sale-rev-${inv.id}`,
              date: inv.invoiceDate,
              timestamp: inv.updatedAt,
              type: 'sales_invoice_reversal',
              typeLabelAr: 'قيد عكسي - إلغاء/تعديل فاتورة مبيعات',
              referenceNumber: `${inv.invoiceNumber}-REV`,
              debitPiastres: 0,
              creditPiastres: inv.totalPiastres,
              notes: `عكس فاتورة مبيعات ${inv.invoiceNumber}`,
            });
          }
        }

        for (const col of collections) {
          rawEvents.push({
            id: `col-${col.id}`,
            date: col.collectionDate,
            timestamp: col.createdAt,
            type: 'collection',
            typeLabelAr: col.isInvoiceInitialCollection
              ? 'سداد فوري مع الفاتورة'
              : 'سند تحصيل من العميل',
            referenceNumber: col.receiptNumber,
            debitPiastres: 0,
            creditPiastres: col.amountPiastres,
            notes: col.notes,
          });

          if (col.status === 'reversed') {
            rawEvents.push({
              id: `col-rev-${col.id}`,
              date: col.collectionDate,
              timestamp: col.updatedAt,
              type: 'collection_reversal',
              typeLabelAr: 'عكس تحصيل',
              referenceNumber: `${col.receiptNumber}-REV`,
              debitPiastres: col.amountPiastres,
              creditPiastres: 0,
              notes: `عكس سند التحصيل ${col.receiptNumber}`,
            });
          }
        }

        for (const ret of returns) {
          if (ret.returnType !== 'sales_return') continue;
          if (ret.status === 'posted') {
            rawEvents.push({
              id: `ret-${ret.id}`,
              date: ret.returnDate,
              timestamp: ret.createdAt,
              type: 'sales_return',
              typeLabelAr:
                ret.refundMode === 'customer_credit'
                  ? 'مرتجع مبيعات (خصم من الحساب)'
                  : 'مرتجع مبيعات (رد نقدي)',
              referenceNumber: ret.returnNumber,
              debitPiastres: 0,
              creditPiastres: ret.refundMode === 'customer_credit' ? ret.totalPiastres : 0,
              notes: ret.reason || ret.notes || 'مرتجع مبيعات',
            });
          }
        }

        rawEvents.sort((a, b) => a.timestamp - b.timestamp);

        let running = 0;
        const entries: CustomerStatementEntry[] = rawEvents.map((ev) => {
          running += ev.debitPiastres - ev.creditPiastres;
          return {
            ...ev,
            runningBalancePiastres: running,
          };
        });

        const totalSalesPiastres = invoices
          .filter((i) => i.status === 'posted')
          .reduce((s, i) => s + i.totalPiastres, 0);
        const totalCollectionsPiastres = collections
          .filter((c) => c.status === 'posted')
          .reduce((s, c) => s + c.amountPiastres, 0);
        const totalReturnsCreditPiastres = returns
          .filter(
            (r) =>
              r.returnType === 'sales_return' &&
              r.status === 'posted' &&
              r.refundMode === 'customer_credit'
          )
          .reduce((s, r) => s + r.totalPiastres, 0);

        return {
          customer,
          entries,
          totalSalesPiastres,
          totalCollectionsPiastres,
          totalReturnsCreditPiastres,
          linkedInvoices: invoices
            .filter((i) => i.status !== 'draft')
            .sort((a, b) => b.createdAt - a.createdAt),
        };
      }
    );
  },
};
