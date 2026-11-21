import {db} from '../db/database';
import {runDatabaseMigrations} from '../db/migrations';
import type {
  AuditAction,
  AuditDiffDetails,
  AuditLogRecord,
  UserRecord,
  UUID,
} from '../types/domain';
import {requirePermission, withReadTx} from './baseRepository';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'إنشاء',
  update: 'تعديل / تحديث',
  reverse: 'قيد عكسي / إلغاء',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  settings_update: 'تحديث الإعدادات',
  migration: 'ترقية قاعدة البيانات',
  backup_export: 'تصدير نسخة احتياطية',
  backup_import: 'استعادة نسخة احتياطية',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  users: 'المستخدمون',
  roles: 'الأدوار والصلاحيات',
  items: 'الأصناف',
  warehouses: 'المخازن',
  stock_movements: 'حركات المخزون',
  customers: 'العملاء',
  suppliers: 'الموردون',
  sales_invoices: 'فواتير المبيعات',
  purchase_invoices: 'فواتير المشتريات',
  returns: 'المرتجعات',
  collections: 'التحصيلات',
  payments: 'سندات الصرف',
  expense_categories: 'تصنيفات المصروفات',
  expenses: 'المصروفات',
  treasury_transactions: 'حركات الخزنة',
  treasury_closings: 'إقفالات الخزنة',
  company_settings: 'إعدادات الشركة',
  schema_migrations: 'الترقيات',
  system: 'النظام والنسخ الاحتياطي',
};

export interface AuditLogFilter {
  actorUserId?: UUID | 'all';
  action?: AuditAction | 'all';
  entityType?: string | 'all';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
}

export interface ParsedAuditEntry {
  record: AuditLogRecord;
  actionLabelAr: string;
  entityLabelAr: string;
  details: AuditDiffDetails;
}

export function parseAuditDetails(detailsJson: string): AuditDiffDetails {
  if (!detailsJson || !detailsJson.trim()) return {};
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as AuditDiffDetails;
    }
    return {};
  } catch {
    return {};
  }
}

export const auditRepository = {
  async listAuditLogs(
    actor: UserRecord,
    filter?: AuditLogFilter
  ): Promise<ParsedAuditEntry[]> {
    await runDatabaseMigrations();
    return withReadTx([db.roles, db.audit_log], async () => {
      await requirePermission(
        actor,
        'users.manage',
        'ليس لديك صلاحية الاطلاع على سجل المراجعة.'
      );

      const allLogs = await db.audit_log.orderBy('createdAt').reverse().toArray();

      const fromMs = filter?.dateFrom
        ? new Date(`${filter.dateFrom}T00:00:00`).getTime()
        : null;
      const toMs = filter?.dateTo
        ? new Date(`${filter.dateTo}T23:59:59.999`).getTime()
        : null;
      const searchLower = filter?.search?.trim().toLowerCase() ?? '';
      const limit = filter?.limit ?? 250;

      const filtered = allLogs.filter((entry) => {
        if (
          filter?.actorUserId &&
          filter.actorUserId !== 'all' &&
          entry.actorUserId !== filter.actorUserId
        ) {
          return false;
        }
        if (filter?.action && filter.action !== 'all' && entry.action !== filter.action) {
          return false;
        }
        if (
          filter?.entityType &&
          filter.entityType !== 'all' &&
          entry.entityType !== filter.entityType
        ) {
          return false;
        }
        if (fromMs !== null && entry.createdAt < fromMs) return false;
        if (toMs !== null && entry.createdAt > toMs) return false;

        if (searchLower) {
          const actionLabel = (AUDIT_ACTION_LABELS[entry.action] ?? entry.action).toLowerCase();
          const entityLabel = (
            ENTITY_TYPE_LABELS[entry.entityType] ?? entry.entityType
          ).toLowerCase();
          const matchSummary = entry.summary.toLowerCase().includes(searchLower);
          const matchActor = entry.actorName.toLowerCase().includes(searchLower);
          const matchEntityId = entry.entityId.toLowerCase().includes(searchLower);
          const matchDetails = entry.detailsJson.toLowerCase().includes(searchLower);
          if (
            !matchSummary &&
            !matchActor &&
            !matchEntityId &&
            !matchDetails &&
            !actionLabel.includes(searchLower) &&
            !entityLabel.includes(searchLower)
          ) {
            return false;
          }
        }
        return true;
      });

      return filtered.slice(0, limit).map((record) => ({
        record,
        actionLabelAr: AUDIT_ACTION_LABELS[record.action] ?? record.action,
        entityLabelAr: ENTITY_TYPE_LABELS[record.entityType] ?? record.entityType,
        details: parseAuditDetails(record.detailsJson),
      }));
    });
  },
};
