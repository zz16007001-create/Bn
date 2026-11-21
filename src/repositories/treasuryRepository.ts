import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  PaymentMethodRecord,
  TreasuryClosingRecord,
  TreasurySourceType,
  TreasuryTransactionRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';

export const TREASURY_SOURCE_LABELS: Record<TreasurySourceType, string> = {
  opening: 'رصيد افتتاحي',
  collection: 'تحصيل عميل',
  payment: 'دفعة لمورد',
  expense: 'مصروف',
  sales_cash: 'مبيعات (مدفوع)',
  purchase_cash: 'مشتريات (مدفوع)',
  sales_return_cash: 'مرتجع مبيعات (رد نقدي)',
  purchase_return: 'مرتجع مشتريات (مسترد نقدي)',
  deposit: 'إيداع خزنة',
  withdrawal: 'سحب من الخزنة',
  transfer: 'تحويل بين الخزن',
  reversal: 'قيد عكسي',
};

async function computeNextTransactionNumber(): Promise<string> {
  const all = await db.treasury_transactions.toArray();
  let maxSeq = 0;
  for (const t of all) {
    if (t.transactionNumber.startsWith('TR-')) {
      const n = Number.parseInt(t.transactionNumber.slice(3), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `TR-${String(maxSeq + 1).padStart(4, '0')}`;
}

export async function postTreasuryMovementTx(params: {
  actor: UserRecord;
  paymentMethodId?: UUID | null;
  direction: 'in' | 'out';
  amountPiastres: number;
  sourceType: TreasurySourceType;
  sourceId: UUID;
  transactionDate?: string;
  idempotencyKey: string;
  notes: string;
  reversesId?: UUID | null;
}): Promise<TreasuryTransactionRecord> {
  const amountPiastres = assertPiastres(params.amountPiastres, 'مبلغ حركة الخزنة');
  if (amountPiastres <= 0) {
    throw new Error('مبلغ حركة الخزنة يجب أن يكون أكبر من صفر.');
  }
  if (!params.sourceId || !params.sourceId.trim()) {
    throw new Error('لا يمكن إنشاء حركة خزنة بدون مستند مصدر.');
  }
  const cleanKey = params.idempotencyKey.trim();
  if (!cleanKey) {
    throw new Error('معرّف منع التكرار لحركة الخزنة مطلوب.');
  }

  const existing = await db.treasury_transactions
    .where('idempotencyKey')
    .equals(cleanKey)
    .first();
  if (existing) {
    throw new Error('تم تسجيل حركة الخزنة لهذا المستند مسبقاً (منع التكرار).');
  }

  let method: PaymentMethodRecord | undefined;
  if (params.paymentMethodId) {
    method = await db.payment_methods.get(params.paymentMethodId);
  } else {
    method =
      (await db.payment_methods.filter((pm) => pm.isDefault && pm.isActive).first()) ??
      (await db.payment_methods.filter((pm) => pm.isActive).first()) ??
      (await db.payment_methods.toCollection().first());
  }

  if (!method) {
    throw new Error('لا توجد خزنة أو طريقة دفع نشطة.');
  }

  const balanceAfterPiastres =
    params.direction === 'in'
      ? method.currentBalancePiastres + amountPiastres
      : method.currentBalancePiastres - amountPiastres;

  const now = Date.now();
  const transactionNumber = await computeNextTransactionNumber();
  const record: TreasuryTransactionRecord = {
    id: generateUUID(),
    transactionNumber,
    paymentMethodId: method.id,
    direction: params.direction,
    amountPiastres,
    balanceAfterPiastres,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    transactionDate: params.transactionDate ?? todayISODate(),
    idempotencyKey: cleanKey,
    notes: params.notes.trim(),
    reversesId: params.reversesId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: params.actor.id,
  };

  await db.treasury_transactions.add(record);
  await db.payment_methods.update(method.id, {
    currentBalancePiastres: balanceAfterPiastres,
    updatedAt: now,
  });

  return record;
}

export async function reverseTreasuryMovementBySourceTx(params: {
  actor: UserRecord;
  sourceType: TreasurySourceType;
  sourceId: UUID;
  transactionDate?: string;
  notes: string;
}): Promise<TreasuryTransactionRecord | null> {
  const candidates = await db.treasury_transactions
    .where('sourceId')
    .equals(params.sourceId)
    .toArray();
  const orig = candidates.find((t) => t.sourceType === params.sourceType);
  if (!orig) return null;

  const alreadyReversed = candidates.some(
    (t) => t.sourceType === 'reversal' && t.reversesId === orig.id
  );
  if (alreadyReversed) return null;

  return postTreasuryMovementTx({
    actor: params.actor,
    paymentMethodId: orig.paymentMethodId,
    direction: orig.direction === 'in' ? 'out' : 'in',
    amountPiastres: orig.amountPiastres,
    sourceType: 'reversal',
    sourceId: params.sourceId,
    transactionDate: params.transactionDate ?? orig.transactionDate,
    idempotencyKey: `reversal:${orig.idempotencyKey}`,
    notes: params.notes,
    reversesId: orig.id,
  });
}

export interface EnrichedTreasuryTransaction {
  transaction: TreasuryTransactionRecord;
  paymentMethodName: string;
  sourceTypeLabelAr: string;
  actorName: string;
}

export interface TreasurySummary {
  paymentMethods: PaymentMethodRecord[];
  openingPiastres: number;
  totalInPiastres: number;
  totalOutPiastres: number;
  computedBalancePiastres: number;
  methodsBalancePiastres: number;
}

export const treasuryRepository = {
  async getSummary(paymentMethodId?: UUID): Promise<TreasurySummary> {
    await runDatabaseMigrations();
    return withReadTx([db.payment_methods, db.treasury_transactions], async () => {
      const [methods, allTx] = await Promise.all([
        db.payment_methods.toArray(),
        db.treasury_transactions.toArray(),
      ]);

      const scopedMethods = paymentMethodId
        ? methods.filter((m) => m.id === paymentMethodId)
        : methods.filter((m) => m.isActive);
      const scopedIds = new Set(scopedMethods.map((m) => m.id));

      let openingPiastres = 0;
      let totalInPiastres = 0;
      let totalOutPiastres = 0;

      for (const tx of allTx) {
        if (!scopedIds.has(tx.paymentMethodId)) continue;
        if (tx.sourceType === 'opening') {
          openingPiastres += tx.direction === 'in' ? tx.amountPiastres : -tx.amountPiastres;
        } else if (tx.direction === 'in') {
          totalInPiastres += tx.amountPiastres;
        } else {
          totalOutPiastres += tx.amountPiastres;
        }
      }

      const computedBalancePiastres = openingPiastres + totalInPiastres - totalOutPiastres;
      const methodsBalancePiastres = scopedMethods.reduce(
        (s, m) => s + m.currentBalancePiastres,
        0
      );

      return {
        paymentMethods: methods.filter((m) => m.isActive),
        openingPiastres,
        totalInPiastres,
        totalOutPiastres,
        computedBalancePiastres,
        methodsBalancePiastres,
      };
    });
  },

  async listTransactions(filter?: {
    paymentMethodId?: UUID;
    sourceType?: TreasurySourceType | 'all';
    direction?: 'in' | 'out' | 'all';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): Promise<EnrichedTreasuryTransaction[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.treasury_transactions, db.payment_methods, db.users],
      async () => {
        const [txs, methods, users] = await Promise.all([
          db.treasury_transactions.orderBy('createdAt').reverse().toArray(),
          db.payment_methods.toArray(),
          db.users.toArray(),
        ]);

        const methodMap = new Map(methods.map((m) => [m.id, m]));
        const userMap = new Map(users.map((u) => [u.id, u]));
        const searchLower = filter?.search?.trim().toLowerCase() ?? '';

        return txs
          .filter((t) => {
            if (filter?.paymentMethodId && t.paymentMethodId !== filter.paymentMethodId) {
              return false;
            }
            if (
              filter?.sourceType &&
              filter.sourceType !== 'all' &&
              t.sourceType !== filter.sourceType
            ) {
              return false;
            }
            if (
              filter?.direction &&
              filter.direction !== 'all' &&
              t.direction !== filter.direction
            ) {
              return false;
            }
            if (filter?.dateFrom && t.transactionDate < filter.dateFrom) return false;
            if (filter?.dateTo && t.transactionDate > filter.dateTo) return false;
            if (searchLower) {
              const label = (TREASURY_SOURCE_LABELS[t.sourceType] ?? '').toLowerCase();
              const pmName = (methodMap.get(t.paymentMethodId)?.name ?? '').toLowerCase();
              if (
                !t.transactionNumber.toLowerCase().includes(searchLower) &&
                !t.notes.toLowerCase().includes(searchLower) &&
                !t.sourceId.toLowerCase().includes(searchLower) &&
                !label.includes(searchLower) &&
                !pmName.includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .map((transaction) => ({
            transaction,
            paymentMethodName: methodMap.get(transaction.paymentMethodId)?.name ?? 'الخزنة',
            sourceTypeLabelAr:
              TREASURY_SOURCE_LABELS[transaction.sourceType] ?? transaction.sourceType,
            actorName: userMap.get(transaction.createdBy)?.name ?? 'النظام',
          }));
      }
    );
  },

  async recordOpeningBalance(
    actor: UserRecord,
    input: {
      paymentMethodId?: UUID;
      amountPiastres: number;
      transactionDate?: string;
      notes?: string;
      clientRequestId?: string | null;
    }
  ): Promise<TreasuryTransactionRecord> {
    await runDatabaseMigrations();
    return withWriteTx([db.treasury_transactions, db.payment_methods, db.audit_log], async () => {
      const sourceId = input.clientRequestId?.trim() || generateUUID();
      const tx = await postTreasuryMovementTx({
        actor,
        paymentMethodId: input.paymentMethodId,
        direction: 'in',
        amountPiastres: input.amountPiastres,
        sourceType: 'opening',
        sourceId,
        transactionDate: input.transactionDate ?? todayISODate(),
        idempotencyKey: `opening:${sourceId}`,
        notes: (input.notes ?? '').trim() || 'رصيد افتتاحي للخزنة',
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'treasury_transactions',
        entityId: tx.id,
        summary: `تسجيل رصيد افتتاحي للخزنة (${tx.transactionNumber})`,
        details: {amountPiastres: tx.amountPiastres},
      });
      return tx;
    });
  },

  async recordManualDeposit(
    actor: UserRecord,
    input: {
      paymentMethodId?: UUID;
      amountPiastres: number;
      transactionDate?: string;
      notes: string;
      clientRequestId?: string | null;
    }
  ): Promise<TreasuryTransactionRecord> {
    await runDatabaseMigrations();
    const notes = input.notes.trim();
    if (notes.length < 2) {
      throw new Error('يرجى كتابة سبب/مصدر الإيداع.');
    }
    return withWriteTx([db.treasury_transactions, db.payment_methods, db.audit_log], async () => {
      const sourceId = input.clientRequestId?.trim() || generateUUID();
      const tx = await postTreasuryMovementTx({
        actor,
        paymentMethodId: input.paymentMethodId,
        direction: 'in',
        amountPiastres: input.amountPiastres,
        sourceType: 'deposit',
        sourceId,
        transactionDate: input.transactionDate ?? todayISODate(),
        idempotencyKey: `deposit:${sourceId}`,
        notes,
      });

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'treasury_transactions',
        entityId: tx.id,
        summary: `إيداع في الخزنة (${tx.transactionNumber}): ${notes}`,
        details: {amountPiastres: tx.amountPiastres},
      });
      return tx;
    });
  },

  async recordManualWithdrawal(
    actor: UserRecord,
    input: {
      paymentMethodId?: UUID;
      amountPiastres: number;
      transactionDate?: string;
      notes: string;
      clientRequestId?: string | null;
    }
  ): Promise<TreasuryTransactionRecord> {
    await runDatabaseMigrations();
    const notes = input.notes.trim();
    if (notes.length < 2) {
      throw new Error('يرجى كتابة سبب/جهة السحب.');
    }
    return withWriteTx(
      [db.roles, db.treasury_transactions, db.payment_methods, db.audit_log],
      async () => {
        const role = await db.roles.get(actor.roleId);
        if (!role || !role.permissions.includes('treasury.withdraw')) {
          throw new Error('ليس لديك صلاحية السحب من الخزنة.');
        }

        const sourceId = input.clientRequestId?.trim() || generateUUID();
        const tx = await postTreasuryMovementTx({
          actor,
          paymentMethodId: input.paymentMethodId,
          direction: 'out',
          amountPiastres: input.amountPiastres,
          sourceType: 'withdrawal',
          sourceId,
          transactionDate: input.transactionDate ?? todayISODate(),
          idempotencyKey: `withdrawal:${sourceId}`,
          notes,
        });

        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'treasury_transactions',
          entityId: tx.id,
          summary: `سحب من الخزنة (${tx.transactionNumber}): ${notes}`,
          details: {amountPiastres: tx.amountPiastres},
        });
        return tx;
      }
    );
  },

  async listDailyClosings(): Promise<TreasuryClosingRecord[]> {
    await runDatabaseMigrations();
    return withReadTx([db.treasury_closings], async () => {
      return db.treasury_closings.orderBy('createdAt').reverse().toArray();
    });
  },

  async recordDailyClosing(
    actor: UserRecord,
    input: {
      paymentMethodId: UUID;
      closingDate: string;
      actualCountedPiastres: number;
      notes?: string;
    }
  ): Promise<TreasuryClosingRecord> {
    await runDatabaseMigrations();
    const actualCountedPiastres = assertPiastres(
      input.actualCountedPiastres,
      'الجرد الفعلي للخزنة'
    );
    if (actualCountedPiastres < 0) {
      throw new Error('الرصيد الفعلي لا يمكن أن يكون سالباً.');
    }

    return withWriteTx(
      [db.treasury_closings, db.treasury_transactions, db.payment_methods, db.audit_log],
      async () => {
        const method = await db.payment_methods.get(input.paymentMethodId);
        if (!method) throw new Error('الخزنة المحددة غير موجودة.');

        const allTx = await db.treasury_transactions
          .where('paymentMethodId')
          .equals(method.id)
          .toArray();

        let openingBalancePiastres = 0;
        let totalInPiastres = 0;
        let totalOutPiastres = 0;

        for (const tx of allTx) {
          const signed = tx.direction === 'in' ? tx.amountPiastres : -tx.amountPiastres;
          if (tx.transactionDate < input.closingDate) {
            openingBalancePiastres += signed;
          } else if (tx.transactionDate === input.closingDate) {
            if (tx.sourceType === 'opening') {
              openingBalancePiastres += signed;
            } else if (tx.direction === 'in') {
              totalInPiastres += tx.amountPiastres;
            } else {
              totalOutPiastres += tx.amountPiastres;
            }
          }
        }

        const expectedBalancePiastres =
          openingBalancePiastres + totalInPiastres - totalOutPiastres;
        const variancePiastres = actualCountedPiastres - expectedBalancePiastres;

        const count = await db.treasury_closings.count();
        const closingNumber = `CLS-${String(count + 1).padStart(4, '0')}`;
        const now = Date.now();

        const record: TreasuryClosingRecord = {
          id: generateUUID(),
          closingNumber,
          closingDate: input.closingDate,
          paymentMethodId: method.id,
          openingBalancePiastres,
          totalInPiastres,
          totalOutPiastres,
          expectedBalancePiastres,
          actualCountedPiastres,
          variancePiastres,
          closedByName: actor.name,
          notes: (input.notes ?? '').trim(),
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
        };

        await db.treasury_closings.add(record);
        await appendAuditLog({
          actorUserId: actor.id,
          actorName: actor.name,
          action: 'create',
          entityType: 'treasury_closings',
          entityId: record.id,
          summary: `إقفال يومي للخزنة (${method.name}) بتاريخ ${input.closingDate} - فرق: ${variancePiastres}`,
          details: {
            expectedBalancePiastres,
            actualCountedPiastres,
            variancePiastres,
          },
        });

        return record;
      }
    );
  },
};
