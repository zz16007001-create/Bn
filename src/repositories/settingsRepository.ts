import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {CompanySettingsRecord, PaymentMethodRecord, UserRecord} from '../types/domain';
import {appendAuditLog, requirePermission, withReadTx, withWriteTx} from './baseRepository';

export type CompanySettingsUpdateInput = Partial<
  Pick<
    CompanySettingsRecord,
    | 'companyName'
    | 'phone'
    | 'address'
    | 'logoDataUrl'
    | 'invoiceFooter'
    | 'taxNumber'
    | 'allowNegativeStock'
    | 'thermalPaperWidth'
    | 'autoPrintAfterSale'
    | 'savedPrinterId'
    | 'savedPrinterName'
  >
>;

function summarizeSettingsForAudit(s: CompanySettingsRecord): Record<string, unknown> {
  return {
    companyName: s.companyName,
    phone: s.phone,
    address: s.address,
    taxNumber: s.taxNumber,
    invoiceFooter: s.invoiceFooter,
    hasLogo: Boolean(s.logoDataUrl),
    allowNegativeStock: s.allowNegativeStock,
    thermalPaperWidth: s.thermalPaperWidth,
    autoPrintAfterSale: s.autoPrintAfterSale,
    savedPrinterName: s.savedPrinterName,
  };
}

export const settingsRepository = {
  async getCompanySettings(): Promise<CompanySettingsRecord> {
    await runDatabaseMigrations();
    return withReadTx([db.company_settings], async () => {
      const record = await db.company_settings.get('default');
      if (!record) {
        throw new Error('تعذر قراءة إعدادات الشركة.');
      }
      return record;
    });
  },

  async listPaymentMethods(): Promise<PaymentMethodRecord[]> {
    await runDatabaseMigrations();
    return withReadTx([db.payment_methods], async () => {
      const all = await db.payment_methods.toArray();
      return all.filter((pm) => pm.isActive);
    });
  },

  async updateCompanySettings(
    actor: UserRecord,
    patch: CompanySettingsUpdateInput
  ): Promise<CompanySettingsRecord> {
    await runDatabaseMigrations();
    return withWriteTx([db.roles, db.company_settings, db.audit_log], async () => {
      await requirePermission(
        actor,
        'settings.manage',
        'ليس لديك صلاحية تعديل إعدادات الشركة.'
      );

      const current = await db.company_settings.get('default');
      if (!current) {
        throw new Error('سجل إعدادات الشركة غير موجود.');
      }
      const now = Date.now();
      const next: CompanySettingsRecord = {
        ...current,
        ...patch,
        companyName: (patch.companyName ?? current.companyName).trim() || current.companyName,
        phone: (patch.phone ?? current.phone).trim(),
        address: (patch.address ?? current.address).trim(),
        invoiceFooter: (patch.invoiceFooter ?? current.invoiceFooter).trim(),
        taxNumber: (patch.taxNumber ?? current.taxNumber).trim(),
        thermalPaperWidth: patch.thermalPaperWidth ?? current.thermalPaperWidth ?? '80mm',
        autoPrintAfterSale: patch.autoPrintAfterSale ?? current.autoPrintAfterSale ?? false,
        savedPrinterId:
          patch.savedPrinterId !== undefined ? patch.savedPrinterId : current.savedPrinterId,
        savedPrinterName:
          patch.savedPrinterName !== undefined ? patch.savedPrinterName : current.savedPrinterName,
        updatedAt: now,
      };
      await db.company_settings.put(next);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'settings_update',
        entityType: 'company_settings',
        entityId: 'default',
        summary: `تحديث إعدادات الشركة (${next.companyName})`,
        before: summarizeSettingsForAudit(current),
        after: summarizeSettingsForAudit(next),
      });

      return next;
    });
  },

  async savePrinterDevicePreference(
    actor: UserRecord,
    printer: {savedPrinterId: string | null; savedPrinterName: string | null}
  ): Promise<CompanySettingsRecord> {
    await runDatabaseMigrations();
    return withWriteTx([db.company_settings, db.audit_log], async () => {
      const current = await db.company_settings.get('default');
      if (!current) {
        throw new Error('سجل إعدادات الشركة غير موجود.');
      }
      const now = Date.now();
      const next: CompanySettingsRecord = {
        ...current,
        savedPrinterId: printer.savedPrinterId,
        savedPrinterName: printer.savedPrinterName,
        updatedAt: now,
      };
      await db.company_settings.put(next);

      await appendAuditLog({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'settings_update',
        entityType: 'company_settings',
        entityId: 'default',
        summary: printer.savedPrinterName
          ? `ربط طابعة بلوتوث: ${printer.savedPrinterName}`
          : 'إلغاء ربط طابعة البلوتوث المحفوظة',
        before: {
          savedPrinterId: current.savedPrinterId,
          savedPrinterName: current.savedPrinterName,
        },
        after: {
          savedPrinterId: next.savedPrinterId,
          savedPrinterName: next.savedPrinterName,
        },
      });

      return next;
    });
  },
};
