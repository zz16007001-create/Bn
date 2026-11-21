import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  ExpenseCategoryRecord,
  ExpenseRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {todayISODate} from '../utils/date';
import {assertPiastres} from '../utils/money';
import {appendAuditLog, withReadTx, withWriteTx} from './baseRepository';
import {
  postTreasuryMovementTx,
  reverseTreasuryMovementBySourceTx,
} from './treasuryRepository';

export interface CreateExpenseInput {
  categoryId: UUID;
  paymentMethodId?: UUID | null;
  amountPiastres: number;
  expenseDate?: string;
  description: string;
  clientRequestId?: string | null;
}

export interface EnrichedExpense {
  expense: ExpenseRecord;
  categoryName: string;
  paymentMethodName: string;
  actorName: string;
}

async function createExpenseInternal(
  actor: UserRecord,
  input: CreateExpenseInput,
  options?: {amendedFromId?: UUID | null; reversesId?: UUID | null}
): Promise<EnrichedExpense> {
  const role = await db.roles.get(actor.roleId);
  if (!role || !role.permissions.includes('expenses.manage')) {
    throw new Error('ليس لديك صلاحية تسجيل أو تعديل المصروفات.');
  }

  const cleanClientReqId = input.clientRequestId?.trim() || null;
  if (cleanClientReqId) {
    const dup = await db.expenses
      .where('clientRequestId')
      .equals(cleanClientReqId)
      .first();
    if (dup) {
      throw new Error('تم تسجيل هذا المصروف مسبقاً (منع التكرار).');
    }
  }

  const amountPiastres = assertPiastres(input.amountPiastres, 'مبلغ المصروف');
  if (amountPiastres <= 0) {
    throw new Error('مبلغ المصروف يجب أن يكون أكبر من صفر.');
  }

  const category = await db.expense_categories.get(input.categoryId);
  if (!category) throw new Error('تصنيف المصروف غير موجود.');

  const description = input.description.trim();
  if (description.length < 2) {
    throw new Error('يرجى إدخال بيان أو ملاحظات للمصروف.');
  }

  let methodId = input.paymentMethodId ?? undefined;
  if (!methodId) {
    const defPm = await db.payment_methods.filter((pm) => pm.isDefault && pm.isActive).first();
    methodId = defPm?.id ?? (await db.payment_methods.filter((pm) => pm.isActive).first())?.id;
  }
  if (!methodId) throw new Error('لم يتم العثور على طريقة دفع صالحة.');
  const method = await db.payment_methods.get(methodId);
  if (!method) throw new Error('طريقة الدفع المحددة غير موجودة.');

  const count = await db.expenses.count();
  const voucherNumber = `EXP-${String(count + 1).padStart(4, '0')}`;
  const expenseDate = input.expenseDate ?? todayISODate();
  const expenseId = generateUUID();
  const now = Date.now();

  const treasuryTx = await postTreasuryMovementTx({
    actor,
    paymentMethodId: method.id,
    direction: 'out',
    amountPiastres,
    sourceType: 'expense',
    sourceId: expenseId,
    transactionDate: expenseDate,
    idempotencyKey: `expense:${expenseId}`,
    notes: `مصروف (${category.name}): ${description} - سند ${voucherNumber}`,
  });

  const record: ExpenseRecord = {
    id: expenseId,
    voucherNumber,
    categoryId: category.id,
    paymentMethodId: method.id,
    amountPiastres,
    expenseDate,
    description,
    status: 'posted',
    reversedById: null,
    reversesId: options?.reversesId ?? null,
    amendedFromId: options?.amendedFromId ?? null,
    treasuryTransactionId: treasuryTx.id,
    clientRequestId: cleanClientReqId,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };

  await db.expenses.add(record);
  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'create',
    entityType: 'expenses',
    entityId: record.id,
    summary: `تسجيل مصروف ${voucherNumber} (${category.name}): ${description}`,
    details: {amountPiastres, categoryName: category.name},
  });

  return {
    expense: record,
    categoryName: category.name,
    paymentMethodName: method.name,
    actorName: actor.name,
  };
}

async function reverseExpenseInternal(
  actor: UserRecord,
  expenseId: UUID,
  reason = 'إلغاء مصروف بقيد عكسي'
): Promise<ExpenseRecord> {
  const role = await db.roles.get(actor.roleId);
  if (!role || !role.permissions.includes('expenses.manage')) {
    throw new Error('ليس لديك صلاحية إلغاء أو تعديل المصروفات.');
  }

  const existing = await db.expenses.get(expenseId);
  if (!existing) throw new Error('سند المصروف غير موجود.');
  if (existing.status === 'reversed') {
    throw new Error('هذا المصروف ملغى/معكوس بالفعل.');
  }

  const now = Date.now();
  const markerId = generateUUID();

  await reverseTreasuryMovementBySourceTx({
    actor,
    sourceType: 'expense',
    sourceId: existing.id,
    transactionDate: existing.expenseDate,
    notes: `${reason} (${existing.voucherNumber})`,
  });

  await db.expenses.update(existing.id, {
    status: 'reversed',
    reversedById: markerId,
    updatedAt: now,
  });

  await appendAuditLog({
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'reverse',
    entityType: 'expenses',
    entityId: existing.id,
    summary: `عكس مصروف ${existing.voucherNumber} (${reason})`,
    details: {amountPiastres: existing.amountPiastres},
    before: {status: existing.status, reversedById: existing.reversedById},
    after: {status: 'reversed', reversedById: markerId},
  });

  return {
    ...existing,
    status: 'reversed',
    reversedById: markerId,
    updatedAt: now,
  };
}

export const expenseRepository = {
  async listCategories(includeInactive = false): Promise<ExpenseCategoryRecord[]> {
    await runDatabaseMigrations();
    return withReadTx([db.expense_categories], async () => {
      const all = await db.expense_categories.toArray();
      return all
        .filter((c) => includeInactive || c.isActive)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    });
  },

  async createCategory(actor: UserRecord, name: string): Promise<ExpenseCategoryRecord> {
    await runDatabaseMigrations();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new Error('اسم التصنيف يجب أن لا يقل عن حرفين.');
    }

    return withWriteTx([db.roles, db.expense_categories, db.audit_log], async () => {
      const role = await db.roles.get(actor.roleId);
      if (!role || !role.permissions.includes('expenses.manage')) {
        throw new Error('ليس لديك صلاحية إدارة تصنيفات المصروفات.');
      }
      const all = await db.expense_categories.toArray();
      const dup = all.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
      if (dup) {
        throw new Error('هذا التصنيف موجود مسبقاً.');
      }

      const now = Date.now();
      const rec: ExpenseCategoryRecord = {
        id: generateUUID(),
        code: `EXP-CAT-${String(all.length + 1).padStart(3, '0')}`,
        name: trimmed,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.id,
      };
      await db.expense_categories.add(rec);
      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'create',
        entityType: 'expense_categories',
        entityId: rec.id,
        summary: `إضافة تصنيف مصروفات جديد: ${rec.name}`,
      });
      return rec;
    });
  },

  async listExpenses(filter?: {
    search?: string;
    categoryId?: UUID;
    status?: 'all' | 'posted' | 'reversed';
    dateFrom?: string;
    dateTo?: string;
  }): Promise<EnrichedExpense[]> {
    await runDatabaseMigrations();
    return withReadTx(
      [db.expenses, db.expense_categories, db.payment_methods, db.users],
      async () => {
        const [expenses, categories, methods, users] = await Promise.all([
          db.expenses.orderBy('createdAt').reverse().toArray(),
          db.expense_categories.toArray(),
          db.payment_methods.toArray(),
          db.users.toArray(),
        ]);

        const catMap = new Map(categories.map((c) => [c.id, c]));
        const methodMap = new Map(methods.map((m) => [m.id, m]));
        const userMap = new Map(users.map((u) => [u.id, u]));
        const searchLower = filter?.search?.trim().toLowerCase() ?? '';
        const statusFilter = filter?.status ?? 'all';

        return expenses
          .filter((e) => {
            if (statusFilter !== 'all' && e.status !== statusFilter) return false;
            if (filter?.categoryId && e.categoryId !== filter.categoryId) return false;
            if (filter?.dateFrom && e.expenseDate < filter.dateFrom) return false;
            if (filter?.dateTo && e.expenseDate > filter.dateTo) return false;
            if (searchLower) {
              const catName = (catMap.get(e.categoryId)?.name ?? '').toLowerCase();
              if (
                !e.voucherNumber.toLowerCase().includes(searchLower) &&
                !e.description.toLowerCase().includes(searchLower) &&
                !catName.includes(searchLower)
              ) {
                return false;
              }
            }
            return true;
          })
          .map((expense) => ({
            expense,
            categoryName: catMap.get(expense.categoryId)?.name ?? 'غير مصنف',
            paymentMethodName: methodMap.get(expense.paymentMethodId)?.name ?? 'نقدي',
            actorName: userMap.get(expense.createdBy)?.name ?? 'النظام',
          }));
      }
    );
  },

  async createExpense(
    actor: UserRecord,
    input: CreateExpenseInput
  ): Promise<EnrichedExpense> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.expenses,
        db.expense_categories,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => createExpenseInternal(actor, input)
    );
  },

  async cancelExpense(
    actor: UserRecord,
    expenseId: UUID,
    reason?: string
  ): Promise<ExpenseRecord> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.expenses,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => reverseExpenseInternal(actor, expenseId, reason)
    );
  },

  async amendExpense(
    actor: UserRecord,
    originalExpenseId: UUID,
    newInput: CreateExpenseInput
  ): Promise<EnrichedExpense> {
    await runDatabaseMigrations();
    return withWriteTx(
      [
        db.roles,
        db.expenses,
        db.expense_categories,
        db.payment_methods,
        db.treasury_transactions,
        db.audit_log,
      ],
      async () => {
        await reverseExpenseInternal(actor, originalExpenseId, 'تعديل مصروف بقيد عكسي');
        return createExpenseInternal(actor, newInput, {
          amendedFromId: originalExpenseId,
          reversesId: originalExpenseId,
        });
      }
    );
  },
};
