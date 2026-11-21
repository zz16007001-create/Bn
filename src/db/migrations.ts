import type {
  ExpenseCategoryRecord,
  PaymentMethodRecord,
  PermissionKey,
  RoleRecord,
  WarehouseRecord,
} from '../types/domain';
import {generateUUID} from '../utils/crypto';
import {CURRENT_DB_VERSION, db} from './database';

export interface MigrationStep {
  version: number;
  name: string;
  up: () => Promise<void>;
}

const ALL_PERMISSIONS: PermissionKey[] = [
  'invoice.create',
  'invoice.edit',
  'invoice.cancel',
  'price.override',
  'discount.apply',
  'stock.override',
  'collections.manage',
  'expenses.manage',
  'treasury.withdraw',
  'reports.profit',
  'users.manage',
  'settings.manage',
  'backup.manage',
];

export const DEFAULT_ROLES_TEMPLATE: Array<{
  code: RoleRecord['code'];
  nameAr: string;
  descriptionAr: string;
  permissions: PermissionKey[];
}> = [
  {
    code: 'admin',
    nameAr: 'مدير النظام',
    descriptionAr: 'صلاحيات كاملة لإدارة الشركة والمستخدمين والتقارير والمخزون والخزنة.',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'sales',
    nameAr: 'موظف مبيعات',
    descriptionAr: 'إصدار فواتير البيع وتحصيل المستحقات وتطبيق الخصومات المسموح بها.',
    permissions: ['invoice.create', 'discount.apply', 'collections.manage'],
  },
  {
    code: 'warehouse',
    nameAr: 'مسؤول مخزن',
    descriptionAr: 'متابعة أرصدة المخازن وحركات الصرف والتوريد والتسويات المخزنية.',
    permissions: ['stock.override'],
  },
  {
    code: 'accountant',
    nameAr: 'محاسب',
    descriptionAr: 'مراجعة الفواتير والقيود العكسية والتحصيلات والمصروفات والخزنة وتقارير الأرباح.',
    permissions: [
      'invoice.create',
      'invoice.edit',
      'invoice.cancel',
      'collections.manage',
      'expenses.manage',
      'treasury.withdraw',
      'reports.profit',
    ],
  },
];

const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    name: 'initial_core_schema_and_reference_seed',
    up: async () => {
      const now = Date.now();
      const systemId = 'SYSTEM';

      const existingRolesCount = await db.roles.count();
      if (existingRolesCount === 0) {
        const roles: RoleRecord[] = DEFAULT_ROLES_TEMPLATE.map((tpl) => ({
          id: generateUUID(),
          code: tpl.code,
          nameAr: tpl.nameAr,
          descriptionAr: tpl.descriptionAr,
          permissions: [...tpl.permissions],
          isSystem: true,
          createdAt: now,
          updatedAt: now,
          createdBy: systemId,
        }));
        await db.roles.bulkAdd(roles);
      }

      const existingSettings = await db.company_settings.get('default');
      if (!existingSettings) {
        await db.company_settings.add({
          id: 'default',
          companyName: 'نُخبة البن للتوزيع',
          phone: '01000000000',
          address: 'القاهرة - جمهورية مصر العربية',
          logoDataUrl: null,
          invoiceFooter: 'شكراً لتعاملكم مع نُخبة البن للتوزيع - البضاعة المباعة ترد وتستبدل وفق سياسة الشركة.',
          taxNumber: '',
          currencySymbol: 'ج.م',
          allowNegativeStock: false,
          thermalPaperWidth: '80mm',
          autoPrintAfterSale: false,
          savedPrinterId: null,
          savedPrinterName: null,
          lastBackupAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: systemId,
        });
      }

      const warehouseCount = await db.warehouses.count();
      if (warehouseCount === 0) {
        const defaultWarehouse: WarehouseRecord = {
          id: generateUUID(),
          code: 'WH-01',
          name: 'المخزن الرئيسي',
          location: 'المقر الرئيسي',
          isDefault: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: systemId,
        };
        await db.warehouses.add(defaultWarehouse);
      }

      const paymentMethodsCount = await db.payment_methods.count();
      if (paymentMethodsCount === 0) {
        const defaultCashBox: PaymentMethodRecord = {
          id: generateUUID(),
          code: 'CASH-MAIN',
          name: 'الخزنة الرئيسية (نقدي)',
          type: 'cash_box',
          currentBalancePiastres: 0,
          isDefault: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: systemId,
        };
        await db.payment_methods.add(defaultCashBox);
      }

      const expenseCatCount = await db.expense_categories.count();
      if (expenseCatCount === 0) {
        const categories: ExpenseCategoryRecord[] = [
          {id: generateUUID(), code: 'EXP-TRANS', name: 'نقل وتوصيل ومشال', isActive: true, createdAt: now, updatedAt: now, createdBy: systemId},
          {id: generateUUID(), code: 'EXP-FUEL', name: 'وقود وصيانة سيارات', isActive: true, createdAt: now, updatedAt: now, createdBy: systemId},
          {id: generateUUID(), code: 'EXP-PACK', name: 'مستلزمات تعبئة وتغليف', isActive: true, createdAt: now, updatedAt: now, createdBy: systemId},
          {id: generateUUID(), code: 'EXP-UTIL', name: 'إيجار ومرافق واتصالات', isActive: true, createdAt: now, updatedAt: now, createdBy: systemId},
          {id: generateUUID(), code: 'EXP-OTHER', name: 'مصروفات تشغيلية أخرى', isActive: true, createdAt: now, updatedAt: now, createdBy: systemId},
        ];
        await db.expense_categories.bulkAdd(categories);
      }
    },
  },
  {
    version: 2,
    name: 'stage2_inventory_suppliers_purchases_fields',
    up: async () => {
      await db.items.toCollection().modify((item) => {
        if (item.imageDataUrl === undefined) {
          item.imageDataUrl = null;
        }
      });
      await db.suppliers.toCollection().modify((supplier) => {
        if (supplier.notes === undefined) {
          supplier.notes = '';
        }
      });
      await db.purchase_invoices.toCollection().modify((inv) => {
        if (inv.amendedFromId === undefined) inv.amendedFromId = null;
        if (inv.returnedPiastres === undefined) inv.returnedPiastres = 0;
        if (inv.paymentMethodId === undefined) inv.paymentMethodId = null;
        if (inv.treasuryTransactionId === undefined) inv.treasuryTransactionId = null;
      });
      await db.purchase_invoice_lines.toCollection().modify((line) => {
        if (line.unitCostBasePiastres === undefined) line.unitCostBasePiastres = line.unitCostPiastres;
        if (line.previousAvgCostPiastres === undefined) line.previousAvgCostPiastres = 0;
        if (line.returnedBaseQuantity === undefined) line.returnedBaseQuantity = 0;
      });
      await db.payments.toCollection().modify((payment) => {
        if (payment.reversedById === undefined) payment.reversedById = null;
        if (payment.isInvoiceInitialPayment === undefined) payment.isInvoiceInitialPayment = false;
        if (payment.treasuryTransactionId === undefined) payment.treasuryTransactionId = null;
      });
    },
  },
  {
    version: 3,
    name: 'stage3_sales_customers_collections_returns_fields',
    up: async () => {
      await db.customers.toCollection().modify((c) => {
        if (c.notes === undefined) c.notes = '';
      });
      await db.sales_invoices.toCollection().modify((inv) => {
        if (inv.discountType === undefined) inv.discountType = 'fixed';
        if (inv.discountValue === undefined) inv.discountValue = inv.discountPiastres ?? 0;
        if (inv.totalCostPiastres === undefined) inv.totalCostPiastres = 0;
        if (inv.returnedPiastres === undefined) inv.returnedPiastres = 0;
        if (inv.returnedCostPiastres === undefined) inv.returnedCostPiastres = 0;
        if (inv.profitPiastres === undefined) {
          inv.profitPiastres = (inv.totalPiastres ?? 0) - (inv.totalCostPiastres ?? 0);
        }
        if (inv.paymentMethodId === undefined) inv.paymentMethodId = null;
        if (inv.amendedFromId === undefined) inv.amendedFromId = null;
        if (inv.clientRequestId === undefined) inv.clientRequestId = null;
      });
      await db.sales_invoice_lines.toCollection().modify((line) => {
        if (line.unitConversionFactor === undefined) line.unitConversionFactor = 1;
        if (line.returnedBaseQuantity === undefined) line.returnedBaseQuantity = 0;
      });
      await db.returns.toCollection().modify((ret) => {
        if (ret.returnedCostPiastres === undefined) ret.returnedCostPiastres = 0;
        if (ret.refundMode === undefined) ret.refundMode = 'customer_credit';
        if (ret.reason === undefined) ret.reason = '';
      });
      await db.collections.toCollection().modify((col) => {
        if (col.reversedById === undefined) col.reversedById = null;
        if (col.isInvoiceInitialCollection === undefined) col.isInvoiceInitialCollection = false;
        if (col.creditExcessConfirmed === undefined) col.creditExcessConfirmed = false;
        if (col.clientRequestId === undefined) col.clientRequestId = null;
      });
    },
  },
  {
    version: 4,
    name: 'stage4_treasury_expenses_purchase_returns',
    up: async () => {
      const now = Date.now();
      const existingCats = await db.expense_categories.toArray();
      const renameMap = new Map<string, string>([
        ['نقل وتوصيل ومشال', 'النقل'],
        ['وقود وصيانة سيارات', 'الوقود'],
        ['مصروفات تشغيلية أخرى', 'أخرى'],
      ]);
      for (const cat of existingCats) {
        const nextName = renameMap.get(cat.name.trim());
        if (nextName && !existingCats.some((other) => other.name.trim() === nextName)) {
          await db.expense_categories.update(cat.id, {name: nextName, updatedAt: now});
          cat.name = nextName;
        }
      }

      const existingNames = new Set(existingCats.map((c) => c.name.trim()));
      const existingCodes = new Set(existingCats.map((c) => c.code));
      const requiredCats = [
        {code: 'EXP-TRANS', name: 'النقل'},
        {code: 'EXP-FUEL', name: 'الوقود'},
        {code: 'EXP-LABOR', name: 'العمالة'},
        {code: 'EXP-RENT', name: 'الإيجار'},
        {code: 'EXP-ELEC', name: 'الكهرباء'},
        {code: 'EXP-MAINT', name: 'الصيانة'},
        {code: 'EXP-OTHER', name: 'أخرى'},
      ];
      for (const rc of requiredCats) {
        if (!existingNames.has(rc.name)) {
          const finalCode = existingCodes.has(rc.code) ? `${rc.code}-S4` : rc.code;
          existingCodes.add(finalCode);
          await db.expense_categories.add({
            id: generateUUID(),
            code: finalCode,
            name: rc.name,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            createdBy: 'SYSTEM',
          });
        }
      }

      await db.return_lines.toCollection().modify((rl) => {
        if (rl.purchaseInvoiceLineId === undefined) rl.purchaseInvoiceLineId = null;
      });

      await db.expenses.toCollection().modify((exp) => {
        if (exp.reversedById === undefined) exp.reversedById = null;
        if (exp.amendedFromId === undefined) exp.amendedFromId = null;
        if (exp.treasuryTransactionId === undefined) exp.treasuryTransactionId = null;
        if (exp.clientRequestId === undefined) exp.clientRequestId = null;
      });

      await db.treasury_transactions.toCollection().modify((trx) => {
        if (trx.transactionDate === undefined) {
          trx.transactionDate = new Date(trx.createdAt).toISOString().slice(0, 10);
        }
        if (trx.idempotencyKey === undefined) {
          trx.idempotencyKey = `${trx.sourceType}:${trx.sourceId}:${trx.id}`;
        }
      });
    },
  },
  {
    version: 5,
    name: 'stage5_thermal_printing_and_backup_tracking',
    up: async () => {
      await db.company_settings.toCollection().modify((settings) => {
        if (settings.thermalPaperWidth === undefined) {
          settings.thermalPaperWidth = '80mm';
        }
        if (settings.autoPrintAfterSale === undefined) {
          settings.autoPrintAfterSale = false;
        }
        if (settings.savedPrinterId === undefined) {
          settings.savedPrinterId = null;
        }
        if (settings.savedPrinterName === undefined) {
          settings.savedPrinterName = null;
        }
        if (settings.lastBackupAt === undefined) {
          settings.lastBackupAt = null;
        }
      });
    },
  },
];

let migrationPromise: Promise<void> | null = null;

export function resetMigrationState(): void {
  migrationPromise = null;
}

export async function runDatabaseMigrations(): Promise<void> {
  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    await db.open();
    await db.transaction('rw', db.tables, async () => {
      const applied = await db.schema_migrations.toArray();
      const appliedVersions = new Set(applied.map((m) => m.version));

      const pending = MIGRATIONS.filter(
        (m) => m.version <= CURRENT_DB_VERSION && !appliedVersions.has(m.version)
      ).sort((a, b) => a.version - b.version);

      for (const step of pending) {
        await step.up();
        const now = Date.now();
        await db.schema_migrations.add({
          id: generateUUID(),
          version: step.version,
          name: step.name,
          appliedAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: 'SYSTEM',
        });
        await db.audit_log.add({
          id: generateUUID(),
          actorUserId: 'SYSTEM',
          actorName: 'النظام',
          action: 'migration',
          entityType: 'schema_migrations',
          entityId: String(step.version),
          summary: `تطبيق ترقية قاعدة البيانات رقم ${step.version}: ${step.name}`,
          detailsJson: JSON.stringify({version: step.version, name: step.name}),
          createdAt: now,
          updatedAt: now,
          createdBy: 'SYSTEM',
        });
      }
    });
  })();

  try {
    await migrationPromise;
  } catch (err) {
    migrationPromise = null;
    throw err;
  }
}
