import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {PaymentRecord, SupplierRecord, UserRecord, UUID} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {postTreasuryMovementTx} from './treasuryRepository';

export interface SupplierWithTotals {
  supplier: SupplierRecord;
  totalPurchasesPiastres: number;
  totalPaidPiastres: number;
  invoicesCount: number;
}

export interface SupplierStatementEntry {
  id: string;
  date: string;
  timestamp: number;
  type: 'purchase' | 'purchase_reversal' | 'payment' | 'payment_reversal' | 'purchase_return';
  typeLabelAr: string;
  referenceNumber: string;
  debitPiastres: number; // مدين (يخفض المستحق للمورد)
  creditPiastres: number; // دائن (يزيد المستحق للمورد)
  runningBalancePiastres: number;
  notes: string;
}

export const supplierRepository = {
  async listSuppliers(search?: string): Promise<SupplierWithTotals[]> {
    await runDatabaseMigrations();
    return withReadTx([db.suppliers, db.purchase_invoices, db.payments], async () => {
      const [suppliers, invoices, payments] = await Promise.all([
        db.suppliers.toArray(),
        db.purchase_invoices.toArray(),
        db.payments.toArray(),
      ]);

      const searchLower = search?.trim().toLowerCase() ?? '';

      return suppliers
        .filter((s) => {
          if (!searchLower) return true;
          return (
            s.name.toLowerCase().includes(searchLower) ||
            s.code.toLowerCase().includes(searchLower) ||
            s.phone.toLowerCase().includes(searchLower)
          );
        })
        .map((supplier) => {
          const postedInvoices = invoices.filter(
            (inv) => inv.supplierId === supplier.id && inv.status === 'posted'
          );
          const postedPayments = payments.filter(
            (p) => p.supplierId === supplier.id && p.status === 'posted'
          );
          const totalPurchasesPiastres = postedInvoices.reduce(
            (sum, inv) => sum + inv.totalPiastres,
            0
          );
          const totalPaidPiastres = postedPayments.reduce(
            (sum, p) => sum + p.amountPiastres,
            0
          );
          return {
            supplier,
            totalPurchasesPiastres,
            totalPaidPiastres,
            invoicesCount: postedInvoices.length,
          };
        })
        .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'ar'));
    });
  },

  async createSupplier(
    actor: UserRecord,
    input: {code?: string; name: string; phone?: string; address?: string; notes?: string}
  ): Promise<SupplierRecord> {
    await runDatabaseMigrations();
    const name = input.name.trim();
    if (name.length < 2) {
      throw new Error('اسم المورد يجب أن لا يقل عن حرفين.');
    }

    return withWriteTx([db.suppliers, db.audit_log], async () => {
      const count = await db.suppliers.count();
      const code =
        (input.code ?? '').trim().toUpperCase() ||
        `SUP-${String(count + 1).padStart(4, '0')}`;

      const dup = await db.suppliers.where('code').equals(code).first();
      if (dup) throw new Error(`كود المورد (${code}) مسجل مسبقاً.`);

      const now = Date.now();
      const supplier: SupplierRecord = {
        id: generateUUID(),
        code,
        name,
        phone: (input.phone ?? '').trim(),
        address: (input.address ?? '').trim(),
        notes: (input.notes ?? '').trim(),
        currentBalancePiastres: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };
      await db.suppliers.add(supplier);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'suppliers',
        entityId: supplier.id,
        summary: `إضافة مورد جديد: ${supplier.name} (${supplier.code})`,
      });

      return supplier;
    });
  },

  async updateSupplier(
    actor: UserRecord,
    supplierId: UUID,
    patch: {
      name?: string;
      phone?: string;
      address?: string;
      notes?: string;
      isActive?: boolean;
    }
  ): Promise<void> {
    await runDatabaseMigrations();
    await withWriteTx([db.suppliers, db.audit_log], async () => {
      const existing = await db.suppliers.get(supplierId);
      if (!existing) throw new Error('المورد غير موجود.');
      if (patch.name !== undefined && patch.name.trim().length < 2) {
        throw new Error('اسم المورد يجب أن لا يقل عن حرفين.');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
      const nextPhone = patch.phone !== undefined ? patch.phone.trim() : existing.phone;
      const nextAddress = patch.address !== undefined ? patch.address.trim() : existing.address;
      const nextActive = patch.isActive !== undefined ? patch.isActive : existing.isActive;

      await db.suppliers.update(supplierId, {
        ...(patch.name !== undefined ? {name: nextName} : {}),
        ...(patch.phone !== undefined ? {phone: nextPhone} : {}),
        ...(patch.address !== undefined ? {address: nextAddress} : {}),
        ...(patch.notes !== undefined ? {notes: patch.notes.trim()} : {}),
        ...(patch.isActive !== undefined ? {isActive: nextActive} : {}),
        updatedAt: Date.now(),
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'suppliers',
        entityId: supplierId,
        summary: `تحديث بيانات المورد: ${nextName}`,
        before: {
          name: existing.name,
          phone: existing.phone,
          address: existing.address,
          isActive: existing.isActive,
        },
        after: {
          name: nextName,
          phone: nextPhone,
          address: nextAddress,
          isActive: nextActive,
        },
      });
    });
  },

  async recordSupplierPayment(
    actor: UserRecord,
    input: {
      supplierId: UUID;
      amountPiastres: number;
      paymentMethodId?: UUID;
      purchaseInvoiceId?: UUID | null;
      paymentDate?: string;
      notes?: string;
    }
  ): Promise<PaymentRecord> {
    await runDatabaseMigrations();
    const amountPiastres = assertPiastres(input.amountPiastres, 'مبلغ الدفعة');
    if (amountPiastres <= 0) {
      throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر.');
    }

    return withWriteTx(
      [
        db.suppliers,
        db.payments,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        const supplier = await db.suppliers.get(input.supplierId);
        if (!supplier) throw new Error('المورد غير موجود.');

        let methodId = input.paymentMethodId;
        if (!methodId) {
          const defPm = await db.payment_methods.filter((pm) => pm.isDefault).first();
          methodId = defPm?.id ?? (await db.payment_methods.toCollection().first())?.id;
        }
        if (!methodId) {
          throw new Error('لم يتم العثور على طريقة دفع صالحة.');
        }

        const count = await db.payments.count();
        const voucherNumber = `PAY-${String(count + 1).padStart(4, '0')}`;
        const now = Date.now();
        const paymentId = generateUUID();
        const paymentDate = input.paymentDate ?? todayISODate();

        const trx = await postTreasuryMovementTx({
          actor,
          paymentMethodId: methodId,
          direction: 'out',
          amountPiastres,
          sourceType: 'payment',
          sourceId: paymentId,
          transactionDate: paymentDate,
          idempotencyKey: `payment:${paymentId}`,
          notes: `دفعة للمورد (${supplier.name}) سند ${voucherNumber}`,
        });

        const payment: PaymentRecord = {
          id: paymentId,
          voucherNumber,
          supplierId: supplier.id,
          purchaseInvoiceId: input.purchaseInvoiceId ?? null,
          paymentMethodId: methodId,
          amountPiastres,
          paymentDate,
          status: 'posted',
          reversedById: null,
          reversesId: null,
          isInvoiceInitialPayment: false,
          treasuryTransactionId: trx.id,
          notes: (input.notes ?? '').trim() || `دفعة سداد للمورد ${supplier.name}`,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.payments.add(payment);
        await db.suppliers.update(supplier.id, {
          currentBalancePiastres: supplier.currentBalancePiastres - amountPiastres,
          updatedAt: now,
        });

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'payments',
          entityId: payment.id,
          summary: `تسجيل دفعة للمورد (${supplier.name}) سند ${voucherNumber}`,
          details: {amountPiastres},
        });

        return payment;
      }
    );
  },

  async getSupplierStatement(supplierId: UUID): Promise<{
    supplier: SupplierRecord;
    entries: SupplierStatementEntry[];
    totalPurchasesPiastres: number;
    totalPaymentsPiastres: number;
  }> {
    await runDatabaseMigrations();
    return withReadTx([db.suppliers, db.purchase_invoices, db.payments, db.returns], async () => {
      const supplier = await db.suppliers.get(supplierId);
      if (!supplier) throw new Error('المورد غير موجود.');

      const [invoices, payments, allReturns] = await Promise.all([
        db.purchase_invoices.where('supplierId').equals(supplierId).toArray(),
        db.payments.where('supplierId').equals(supplierId).toArray(),
        db.returns.where('partyId').equals(supplierId).toArray(),
      ]);

      const rawEvents: Array<Omit<SupplierStatementEntry, 'runningBalancePiastres'>> = [];

      for (const inv of invoices) {
        rawEvents.push({
          id: `inv-${inv.id}`,
          date: inv.invoiceDate,
          timestamp: inv.createdAt,
          type: 'purchase',
          typeLabelAr: 'فاتورة شراء',
          referenceNumber: inv.invoiceNumber,
          debitPiastres: 0,
          creditPiastres: inv.totalPiastres,
          notes: inv.notes || 'فاتورة مشتريات',
        });

        if (inv.status === 'reversed') {
          rawEvents.push({
            id: `inv-rev-${inv.id}`,
            date: inv.invoiceDate,
            timestamp: inv.updatedAt,
            type: 'purchase_reversal',
            typeLabelAr: 'قيد عكسي - إلغاء/تعديل شراء',
            referenceNumber: `${inv.invoiceNumber}-REV`,
            debitPiastres: inv.totalPiastres,
            creditPiastres: 0,
            notes: `عكس فاتورة شراء ${inv.invoiceNumber}`,
          });
        }
      }

      for (const pay of payments) {
        rawEvents.push({
          id: `pay-${pay.id}`,
          date: pay.paymentDate,
          timestamp: pay.createdAt,
          type: 'payment',
          typeLabelAr: pay.isInvoiceInitialPayment ? 'سداد مع فاتورة شراء' : 'سند دفع للمورد',
          referenceNumber: pay.voucherNumber,
          debitPiastres: pay.amountPiastres,
          creditPiastres: 0,
          notes: pay.notes,
        });

        if (pay.status === 'reversed') {
          rawEvents.push({
            id: `pay-rev-${pay.id}`,
            date: pay.paymentDate,
            timestamp: pay.updatedAt,
            type: 'payment_reversal',
            typeLabelAr: 'عكس سداد شراء',
            referenceNumber: `${pay.voucherNumber}-REV`,
            debitPiastres: 0,
            creditPiastres: pay.amountPiastres,
            notes: `عكس سند الدفع ${pay.voucherNumber}`,
          });
        }
      }

      for (const ret of allReturns) {
        if (ret.returnType === 'purchase_return' && ret.refundMode === 'supplier_credit') {
          rawEvents.push({
            id: `pret-${ret.id}`,
            date: ret.returnDate,
            timestamp: ret.createdAt,
            type: 'purchase_return',
            typeLabelAr: 'مرتجع مشتريات (تخفيض حساب)',
            referenceNumber: ret.returnNumber,
            debitPiastres: ret.totalPiastres,
            creditPiastres: 0,
            notes: ret.reason || ret.notes || 'مرتجع شراء',
          });
        }
      }

      rawEvents.sort((a, b) => a.timestamp - b.timestamp);

      let running = 0;
      const entries: SupplierStatementEntry[] = rawEvents.map((ev) => {
        running += ev.creditPiastres - ev.debitPiastres;
        return {
          ...ev,
          runningBalancePiastres: running,
        };
      });

      const totalPurchasesPiastres = invoices
        .filter((i) => i.status === 'posted')
        .reduce((s, i) => s + i.totalPiastres, 0);
      const totalPaymentsPiastres = payments
        .filter((p) => p.status === 'posted')
        .reduce((s, p) => s + p.amountPiastres, 0);

      return {
        supplier,
        entries,
        totalPurchasesPiastres,
        totalPaymentsPiastres,
      };
    });
  },
};
